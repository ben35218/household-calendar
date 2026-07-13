const express = require('express');
const crypto = require('crypto');
const CalendarEvent   = require('../models/CalendarEvent');
const EventInvitation = require('../models/EventInvitation');
const User            = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { buildEventICS }       = require('../services/ics');
const { sendEventInvitation } = require('../services/mailer');
const { pushToUser }          = require('../services/notify');
const { normalizePhone }      = require('../services/phone');

// Cross-household event invitations (models/EventInvitation.js). The sender
// invites by EMAIL or by PHONE. Email: if the address belongs to an account the
// invite also shows up in that user's in-app Invitations screen, otherwise it's
// email-only, and the email always carries an .ics attachment for Apple/Google/
// Outlook import. Phone: the server only records the invitation — the
// organizer's device sends the actual text (prefilled Messages composer) with
// the public .ics link below standing in for the email attachment.

const router = express.Router();

// Public (unauthenticated) .ics download, gated by the invitation's shareToken
// capability secret — this is the link an SMS invite carries, so recipients
// without an account can import the event. Registered before requireAuth.
router.get('/public/:id/ics', async (req, res) => {
  try {
    const invitation = await EventInvitation.findById(req.params.id).lean();
    const key = String(req.query.k || '');
    const ok =
      invitation?.shareToken &&
      key.length === invitation.shareToken.length &&
      crypto.timingSafeEqual(Buffer.from(key), Buffer.from(invitation.shareToken));
    if (!ok) return res.status(404).json({ error: 'Invitation not found' });

    res.set('Content-Type', 'text/calendar; charset=utf-8');
    res.set('Content-Disposition', 'attachment; filename="invite.ics"');
    res.send(buildEventICS({ uid: invitation._id, event: invitation.event }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.use(requireAuth);

// An invitation addressed to this user — matched by resolved id or by email,
// so invites sent before the recipient registered still reach them.
function addressedToMe(user) {
  return { $or: [{ toUserId: user._id }, { toEmail: user.email }] };
}

// Push "Ben accepted/declined «Lake day»" to the sender's devices. Fire-and-
// forget: a reply must land even if the sender has no push subscriptions.
function notifySender(invitation, responder, action) {
  (async () => {
    const sender = await User.findById(invitation.fromUserId);
    if (!sender) return;
    const name = [responder.firstName, responder.lastName].filter(Boolean).join(' ') || responder.email;
    await pushToUser(sender, {
      title: `Invitation ${action}`,
      body: `${name} ${action} “${invitation.event.title}”`,
      tag: `invitation-reply-${invitation._id}`,
    });
  })().catch(() => {});
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

// Send an invitation: { eventId, email | phone, event: {snapshot} }.
router.post('/', async (req, res) => {
  try {
    const { eventId, email, phone } = req.body;

    let toEmail = null;
    let toPhone = null;
    if (phone !== undefined) {
      toPhone = normalizePhone(phone);
      if (!toPhone) return res.status(400).json({ error: 'A valid phone number is required' });
    } else {
      toEmail = String(email || '').trim().toLowerCase();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
        return res.status(400).json({ error: 'A valid email address is required' });
      }
      if (toEmail === req.user.email) {
        return res.status(400).json({ error: "You can't invite yourself" });
      }
    }

    const source = await CalendarEvent.findOne({ _id: eventId, userId: { $in: req.scopeIds } }).lean();
    if (!source) return res.status(404).json({ error: 'Event not found' });

    // Prefer the client's decrypted snapshot; fall back to the source's
    // plaintext while dual-write still carries it.
    const snapshot = pickSnapshot(req.body.event) || pickSnapshot(source);
    if (!snapshot) return res.status(400).json({ error: 'Event content is required' });

    // Accounts are keyed by email, so only email invites resolve a recipient.
    const recipient = toEmail ? await User.findOne({ email: toEmail }).select('_id householdId').lean() : null;
    if (recipient && req.user.householdId && String(recipient.householdId) === String(req.user.householdId)) {
      return res.status(400).json({ error: 'That person is in your household and already sees this event' });
    }

    // Re-inviting the same address/number for the same event refreshes the
    // pending invite (and resends) instead of stacking duplicates.
    let invitation = await EventInvitation.findOne({
      eventId,
      ...(toEmail ? { toEmail } : { toPhone }),
      status: 'pending',
    });
    if (invitation) {
      invitation.event = snapshot;
      await invitation.save();
    } else {
      invitation = await EventInvitation.create({
        fromUserId: req.user._id,
        fromName:   [req.user.firstName, req.user.lastName].filter(Boolean).join(' '),
        fromEmail:  req.user.email,
        toEmail:    toEmail || undefined,
        toPhone:    toPhone || undefined,
        toUserId:   recipient?._id,
        eventId,
        event: snapshot,
      });
    }

    // Phone invites are texted from the organizer's device — nothing to send
    // here; the response carries the shareToken the client's SMS link needs.
    if (toEmail) {
      await sendEventInvitation({
        toEmail,
        fromName: invitation.fromName,
        event: snapshot,
        hasAccount: !!recipient,
        ics: buildEventICS({ uid: invitation._id, event: snapshot }),
      });
    }

    res.status(201).json({ invitation, userExists: !!recipient });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The organizer's invitee list for one of their events. Gated on the event
// being in the caller's household scope, so a recipient (who only holds a
// copy) never sees who else was invited.
router.get('/sent', async (req, res) => {
  try {
    const event = await CalendarEvent.findOne({ _id: req.query.eventId, userId: { $in: req.scopeIds } })
      .select('_id').lean();
    if (!event) return res.status(404).json({ error: 'Event not found' });
    const invitations = await EventInvitation.find({ eventId: event._id }).sort({ createdAt: -1 }).lean();
    res.json(invitations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The guest list as seen by a RECIPIENT of one invitation: who else the
// organizer invited, gated on the source event's guestListVisible flag (a
// plaintext scope field the organizer toggles on the event form). Missing flag
// means visible — events predate the setting; a deleted source event hides the
// list. The explicit select keeps shareToken and other internals out of the
// response.
router.get('/:id/guests', async (req, res) => {
  try {
    const invitation = await EventInvitation
      .findOne({ _id: req.params.id, ...addressedToMe(req.user) }).lean();
    if (!invitation) return res.status(404).json({ error: 'Invitation not found' });

    const event = invitation.eventId
      ? await CalendarEvent.findById(invitation.eventId).select('guestListVisible').lean()
      : null;
    if (!event || event.guestListVisible === false) {
      return res.json({ visible: false, guests: [] });
    }

    const guests = await EventInvitation.find({ eventId: invitation.eventId })
      .select('toEmail toPhone status').sort({ createdAt: 1 }).lean();
    res.json({
      visible: true,
      organizer: { name: invitation.fromName, email: invitation.fromEmail },
      guests,
    });
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
      invitationId: invitation._id,
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
    invitation.acceptedEventId = event._id;
    await invitation.save();

    notifySender(invitation, req.user, 'accepted');
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

    notifySender(invitation, req.user, 'declined');
    res.json({ invitation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Leave an event the recipient previously accepted: deletes their copy and
// retires the invitation to 'left' (still visible in the organizer's list).
router.post('/:id/leave', async (req, res) => {
  try {
    const invitation = await EventInvitation.findOne({ _id: req.params.id, ...addressedToMe(req.user) });
    if (!invitation) return res.status(404).json({ error: 'Invitation not found' });
    if (invitation.status !== 'accepted') return res.status(400).json({ error: 'Not attending this event' });

    if (invitation.acceptedEventId) {
      await CalendarEvent.deleteOne({ _id: invitation.acceptedEventId, userId: { $in: req.scopeIds } });
    }
    invitation.status = 'left';
    invitation.respondedAt = new Date();
    await invitation.save();

    res.json({ invitation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The organizer removes an invitee (or cancels a pending invite): deletes the
// invitation and, if it was accepted, the recipient's copy of the event.
router.delete('/:id', async (req, res) => {
  try {
    const invitation = await EventInvitation.findOne({ _id: req.params.id, fromUserId: { $in: req.scopeIds } });
    if (!invitation) return res.status(404).json({ error: 'Invitation not found' });

    if (invitation.status === 'accepted' && invitation.acceptedEventId) {
      await CalendarEvent.deleteOne({ _id: invitation.acceptedEventId, userId: invitation.toUserId });
    }
    await invitation.deleteOne();

    res.json({ success: true });
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
