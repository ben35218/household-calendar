const express = require('express');
const CalendarEvent   = require('../models/CalendarEvent');
const EventInvitation = require('../models/EventInvitation');
const User            = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { buildEventICS }       = require('../services/ics');
const { sendEventInvitation } = require('../services/mailer');

// Cross-household event invitations (models/EventInvitation.js). The sender
// invites by EMAIL; if the address belongs to an account the invite also shows
// up in that user's in-app Invitations screen, otherwise it's email-only. The
// email always carries an .ics attachment for Apple/Google/Outlook import.

const router = express.Router();
router.use(requireAuth);

// An invitation addressed to this user — matched by resolved id or by email,
// so invites sent before the recipient registered still reach them.
function addressedToMe(user) {
  return { $or: [{ toUserId: user._id }, { toEmail: user.email }] };
}

// Snapshot fields the client supplies (decrypted on-device — post-drop the
// server can't read the event's own plaintext, mirroring shared trips).
function pickSnapshot(src) {
  if (!src) return null;
  const { title, description, location, url, phone, startDate, endDate, allDay, calendarType } = src;
  if (!title || !startDate) return null;
  return {
    title, description, location, url, phone,
    startDate: new Date(startDate),
    endDate:   endDate ? new Date(endDate) : undefined,
    allDay:    allDay !== false,
    calendarType: calendarType === 'appointments' ? 'appointments' : 'activities',
  };
}

// Send an invitation: { eventId, email, event: {snapshot} }.
router.post('/', async (req, res) => {
  try {
    const { eventId, email } = req.body;
    const toEmail = String(email || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
      return res.status(400).json({ error: 'A valid email address is required' });
    }
    if (toEmail === req.user.email) {
      return res.status(400).json({ error: "You can't invite yourself" });
    }

    const source = await CalendarEvent.findOne({ _id: eventId, userId: { $in: req.scopeIds } }).lean();
    if (!source) return res.status(404).json({ error: 'Event not found' });

    // Prefer the client's decrypted snapshot; fall back to the source's
    // plaintext while dual-write still carries it.
    const snapshot = pickSnapshot(req.body.event) || pickSnapshot(source);
    if (!snapshot) return res.status(400).json({ error: 'Event content is required' });

    const recipient = await User.findOne({ email: toEmail }).select('_id householdId').lean();
    if (recipient && req.user.householdId && String(recipient.householdId) === String(req.user.householdId)) {
      return res.status(400).json({ error: 'That person is in your household and already sees this event' });
    }

    // Re-inviting the same address to the same event refreshes the pending
    // invite (and resends the email) instead of stacking duplicates.
    let invitation = await EventInvitation.findOne({ eventId, toEmail, status: 'pending' });
    if (invitation) {
      invitation.event = snapshot;
      await invitation.save();
    } else {
      invitation = await EventInvitation.create({
        fromUserId: req.user._id,
        fromName:   [req.user.firstName, req.user.lastName].filter(Boolean).join(' '),
        fromEmail:  req.user.email,
        toEmail,
        toUserId:   recipient?._id,
        eventId,
        event: snapshot,
      });
    }

    await sendEventInvitation({
      toEmail,
      fromName: invitation.fromName,
      event: snapshot,
      hasAccount: !!recipient,
      ics: buildEventICS({ uid: invitation._id, event: snapshot }),
    });

    res.status(201).json({ invitation, userExists: !!recipient });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Invitations addressed to me, newest first. The client splits them into the
// New (pending) and Replied (accepted/declined) tabs.
router.get('/', async (req, res) => {
  try {
    // Claim email-only invites for accounts created after the invite was sent.
    await EventInvitation.updateMany(
      { toEmail: req.user.email, toUserId: null },
      { $set: { toUserId: req.user._id } },
    );
    const invitations = await EventInvitation.find(addressedToMe(req.user)).sort({ createdAt: -1 }).lean();
    res.json(invitations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Accept: copy the snapshot into a CalendarEvent the recipient owns. The copy
// is independent of the sender's original (edits don't sync), and is created
// plaintext like any server-side write in the dual-write phase — the client's
// lazy re-encrypt pass seals it on its next edit.
router.post('/:id/accept', async (req, res) => {
  try {
    const invitation = await EventInvitation.findOne({ _id: req.params.id, ...addressedToMe(req.user) });
    if (!invitation) return res.status(404).json({ error: 'Invitation not found' });
    if (invitation.status !== 'pending') return res.status(400).json({ error: 'Already replied' });

    const s = invitation.event;
    const event = await CalendarEvent.create({
      userId: req.user._id,
      calendarType: s.calendarType || 'activities',
      title: s.title,
      description: s.description,
      location: s.location,
      url: s.url,
      phone: s.phone,
      startDate: s.startDate,
      endDate: s.endDate,
      allDay: s.allDay !== false,
    });

    invitation.status = 'accepted';
    invitation.respondedAt = new Date();
    invitation.toUserId = req.user._id;
    await invitation.save();

    res.json({ invitation, event });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/decline', async (req, res) => {
  try {
    const invitation = await EventInvitation.findOne({ _id: req.params.id, ...addressedToMe(req.user) });
    if (!invitation) return res.status(404).json({ error: 'Invitation not found' });
    if (invitation.status !== 'pending') return res.status(400).json({ error: 'Already replied' });

    invitation.status = 'declined';
    invitation.respondedAt = new Date();
    invitation.toUserId = req.user._id;
    await invitation.save();

    res.json({ invitation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The invitation's .ics, for re-download / manual import (auth also accepts a
// ?token= query param, so this works as a plain download link).
router.get('/:id/ics', async (req, res) => {
  try {
    const invitation = await EventInvitation.findOne({
      _id: req.params.id,
      $or: [{ toUserId: req.user._id }, { toEmail: req.user.email }, { fromUserId: req.user._id }],
    }).lean();
    if (!invitation) return res.status(404).json({ error: 'Invitation not found' });

    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="invite.ics"');
    res.send(buildEventICS({ uid: invitation._id, event: invitation.event }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
