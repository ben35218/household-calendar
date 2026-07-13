const express = require('express');
const CustomCalendar = require('../models/CustomCalendar');
const CalendarInvitation = require('../models/CalendarInvitation');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { sendCalendarInvitation } = require('../services/mailer');
const { normalizePhone } = require('../services/phone');
const {
  normalizeMemberEntry,
  normalizeOutsideEntry,
  normalizeCollaboratorEntry,
  effectiveCalendarAccess,
} = require('../services/calendarSharing');

const router = express.Router();
router.use(requireAuth);

// Canonical key for an outside-share entry (email or phone).
const outsideKey = (e) => e?.email || e?.phone || '';

// Invitations addressed to a user: to their account, or (before claiming) to
// their email or saved phone.
function addressedToUser(user) {
  const or = [{ toUserId: user._id }];
  if (user.email) or.push({ toEmail: user.email.toLowerCase() });
  if (user.phone) or.push({ toPhone: user.phone });
  return or;
}

// Normalize a client outside-share list to `{ email|phone, access }` entries,
// applying loose phone normalization and dropping invalid/duplicate addresses.
function normalizeOutsideList(list) {
  const seen = new Set();
  const out = [];
  for (const raw of Array.isArray(list) ? list : []) {
    const e = normalizeOutsideEntry(raw);
    if (e.phone) {
      const phone = normalizePhone(e.phone);
      if (!phone || seen.has(phone)) continue;
      seen.add(phone);
      out.push({ phone, access: e.access });
    } else {
      if (!e.email || seen.has(e.email)) continue;
      seen.add(e.email);
      out.push({ email: e.email, access: e.access });
    }
  }
  return out;
}

// Calendars this user can see: their own; a housemate's when shared with the
// household or with them specifically; and an outsider's once they accepted a
// calendar invitation (collaborators). The $in arms cover the legacy plain-id
// rows alongside the current subdoc shape.
function accessFilter(req) {
  return {
    $or: [
      { userId: req.user._id },
      { userId: { $in: req.scopeIds }, sharedWithHousehold: true },
      { userId: { $in: req.scopeIds }, 'sharedWith.userId': req.user._id },
      { userId: { $in: req.scopeIds }, sharedWith: req.user._id },
      { 'collaborators.userId': req.user._id },
      { collaborators: req.user._id },
    ],
  };
}

// Client payloads and legacy rows both normalize to the subdoc shapes.
function normalizeShared(cal) {
  return {
    ...cal,
    sharedWith: (cal.sharedWith || []).map(normalizeMemberEntry),
    sharedWithOutside: (cal.sharedWithOutside || []).map(normalizeOutsideEntry),
    collaborators: (cal.collaborators || []).map(normalizeCollaboratorEntry),
    householdAccess: cal.householdAccess === 'view' ? 'view' : 'full',
  };
}

// `mine` = editable (creator-only); `access` = the requester's effective event
// permission on it (View Only / Full Access). Sharing details are the owner's
// business: housemates don't see the outside emails, and outside collaborators
// don't see household member ids either (mirrors event invitations, where a
// recipient never sees other invitees).
function serialize(cal, req) {
  const obj = normalizeShared(cal.toObject ? cal.toObject() : cal);
  const mine = String(obj.userId) === String(req.user._id);
  const access = mine ? 'full' : effectiveCalendarAccess(obj, req.user._id, req.scopeIds) || 'view';
  if (!mine) {
    obj.sharedWithOutside = [];
    const sameHousehold = req.scopeIds.some((id) => String(id) === String(obj.userId));
    if (!sameHousehold) {
      obj.sharedWith = [];
      obj.sharedWithHousehold = false;
    }
  }
  delete obj.collaborators;
  return { ...obj, mine, access };
}

// Reconcile `sharedWithOutside` edits with their invitations: new emails get a
// pending CalendarInvitation + email; removed emails are revoked (invitation
// deleted, accepted collaborator unseated); access changes flow onto the
// invitation and any seated collaborator. Never throws — sharing bookkeeping
// must not fail the save that triggered it.
async function syncOutsideInvitations(cal, prevEntries, req) {
  const prev = new Map((prevEntries || []).map((e) => [outsideKey(e), e]));
  const next = new Map((cal.sharedWithOutside || []).map((e) => [outsideKey(e), e]));
  const fromName = [req.user.firstName, req.user.lastName].filter(Boolean).join(' ');

  for (const [key, entry] of next) {
    const access = entry.access === 'full' ? 'full' : 'view';
    // Match a prior invitation by whichever address this entry carries.
    const addrMatch = entry.phone
      ? { calendarKey: cal.key, toPhone: entry.phone }
      : { calendarKey: cal.key, toEmail: entry.email };
    if (!prev.has(key)) {
      try {
        const recipient = entry.phone
          ? await User.findOne({ phone: entry.phone }).select('_id').lean()
          : await User.findOne({ email: entry.email }).select('_id').lean();
        await CalendarInvitation.create({
          fromUserId: req.user._id,
          fromName,
          fromEmail: req.user.email,
          toEmail: entry.email || undefined,
          toPhone: entry.phone || undefined,
          toUserId: recipient?._id,
          calendarKey: cal.key,
          calendarName: cal.name,
          color: cal.color,
          access,
        });
        // Phone invites carry no email — the owner's device texts them.
        if (entry.email) {
          sendCalendarInvitation({ toEmail: entry.email, fromName, calendarName: cal.name, hasAccount: !!recipient });
        }
      } catch (err) {
        console.error('[calendars] invitation create failed:', err.message);
      }
    } else if ((prev.get(key).access === 'full' ? 'full' : 'view') !== access) {
      // Access changed: update the invitation and any seated collaborator.
      try {
        const inv = await CalendarInvitation.findOneAndUpdate(addrMatch, { access }, { new: true });
        if (inv?.toUserId) {
          await CustomCalendar.updateOne(
            { _id: cal._id, 'collaborators.userId': inv.toUserId },
            { $set: { 'collaborators.$.access': access } },
          );
        }
      } catch (err) {
        console.error('[calendars] invitation access update failed:', err.message);
      }
    }
  }

  for (const [key, entry] of prev) {
    if (next.has(key)) continue;
    try {
      const inv = await CalendarInvitation.findOneAndDelete(
        entry.phone
          ? { calendarKey: cal.key, toPhone: entry.phone }
          : { calendarKey: cal.key, toEmail: entry.email },
      );
      if (inv?.toUserId) {
        await CustomCalendar.updateOne(
          { _id: cal._id },
          { $pull: { collaborators: { userId: inv.toUserId } } },
        );
      }
    } catch (err) {
      console.error('[calendars] invitation revoke failed:', err.message);
    }
  }
}

// Post-drop, events on an outside-shared calendar must be plaintext for the
// collaborator (§9.5, same lane as shared trips). The decrypt-on-share client
// step isn't built, so on an E2EE-active household adding outside emails fails
// safe rather than sharing unreadable events.
function outsideShareBlocked(req, prevEntries, nextEntries) {
  if (!req.household?.e2eeActive) return false;
  const prev = new Set((prevEntries || []).map((e) => outsideKey(e)));
  return (nextEntries || []).some((e) => !prev.has(outsideKey(e)));
}

// ── Invitations addressed to me (registered before /:key routes) ────────────

router.get('/invitations', async (req, res) => {
  try {
    const email = (req.user.email || '').toLowerCase();
    const phone = req.user.phone || '';
    const invitations = await CalendarInvitation
      .find({ $or: addressedToUser(req.user) })
      .sort('-createdAt');
    // Lazily claim email/phone-only invitations sent before this account existed.
    const unclaimed = invitations.filter(
      (i) => !i.toUserId && ((i.toEmail && i.toEmail === email) || (i.toPhone && i.toPhone === phone)),
    );
    if (unclaimed.length) {
      await CalendarInvitation.updateMany(
        { _id: { $in: unclaimed.map((i) => i._id) } },
        { toUserId: req.user._id },
      );
    }
    res.json(invitations);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/invitations/:id/accept', async (req, res) => {
  try {
    const invitation = await CalendarInvitation.findOne({
      _id: req.params.id,
      $or: addressedToUser(req.user),
    });
    if (!invitation) return res.status(404).json({ error: 'Invitation not found' });

    invitation.toUserId = invitation.toUserId || req.user._id;
    invitation.status = 'accepted';
    invitation.respondedAt = new Date();
    await invitation.save();
    // Re-seat the collaborator at the invitation's current access level.
    await CustomCalendar.updateOne(
      { key: invitation.calendarKey },
      { $pull: { collaborators: { userId: req.user._id } } },
    );
    const cal = await CustomCalendar.findOneAndUpdate(
      { key: invitation.calendarKey },
      { $push: { collaborators: { userId: req.user._id, access: invitation.access === 'full' ? 'full' : 'view' } } },
      { new: true },
    ).lean();
    if (!cal) return res.status(404).json({ error: 'Calendar no longer exists' });
    res.json({ invitation, calendar: serialize(cal, req) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/invitations/:id/decline', async (req, res) => {
  try {
    const invitation = await CalendarInvitation.findOne({
      _id: req.params.id,
      $or: addressedToUser(req.user),
    });
    if (!invitation) return res.status(404).json({ error: 'Invitation not found' });

    // Declining after accepting also gives up access.
    if (invitation.status === 'accepted' && invitation.toUserId) {
      await CustomCalendar.updateOne(
        { key: invitation.calendarKey },
        { $pull: { collaborators: { userId: invitation.toUserId } } },
      );
    }
    invitation.toUserId = invitation.toUserId || req.user._id;
    invitation.status = 'declined';
    invitation.respondedAt = new Date();
    await invitation.save();
    res.json({ invitation });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Calendar CRUD ────────────────────────────────────────────────────────────

router.get('/', async (req, res) => {
  try {
    const cals = await CustomCalendar.find(accessFilter(req)).sort('createdAt').lean();
    res.json(cals.map((c) => serialize(c, req)));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A subscription's source URL. Clients send webcal:// links as pasted; both
// sides normalize (defense in depth). Anything not http(s) after that is
// rejected — the URL is fetched by member devices, never by this server.
function normalizeFeedUrl(raw) {
  const url = String(raw).trim().replace(/^webcal:\/\//i, 'https://');
  return /^https?:\/\//i.test(url) ? url : null;
}

// Sanitize a holiday-calendar config to its known fields (client-computed;
// the server only stores + relays it). Returns undefined when there's no valid
// country.
function normalizeHoliday(raw) {
  if (!raw || typeof raw !== 'object' || !raw.country) return undefined;
  const strs = (a) => (Array.isArray(a) ? a.filter((s) => typeof s === 'string') : []);
  return {
    country: String(raw.country),
    selectedRegions: strs(raw.selectedRegions),
    disabledIds: strs(raw.disabledIds),
  };
}

router.post('/', async (req, res) => {
  try {
    const { key, name, color, alertsEnabled, sharedWithHousehold, householdAccess, sharedWith, sharedWithOutside, feedUrl, holiday } = req.body;
    const outside = normalizeOutsideList(sharedWithOutside);
    if (outsideShareBlocked(req, [], outside)) {
      return res.status(409).json({ error: 'decrypt_required' });
    }
    let feed;
    if (feedUrl) {
      feed = normalizeFeedUrl(feedUrl);
      if (!feed) return res.status(400).json({ error: 'invalid_feed_url' });
    }
    const hol = normalizeHoliday(holiday);
    const cal = await CustomCalendar.create({
      userId: req.user._id,
      key,
      name,
      color,
      alertsEnabled: alertsEnabled !== false,
      sharedWithHousehold: !!sharedWithHousehold,
      householdAccess: householdAccess === 'view' ? 'view' : 'full',
      sharedWith: (sharedWith || []).map(normalizeMemberEntry),
      sharedWithOutside: outside,
      ...(feed ? { feedUrl: feed } : {}),
      ...(hol ? { holiday: hol } : {}),
    });
    await syncOutsideInvitations(cal, [], req);
    res.status(201).json(serialize(cal, req));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// Only the creator edits or deletes; housemates and collaborators read via GET.
router.put('/:key', async (req, res) => {
  try {
    const { name, color, alertsEnabled, sharedWithHousehold, householdAccess, sharedWith, sharedWithOutside, holiday } = req.body;
    const existing = await CustomCalendar.findOne({ key: req.params.key, userId: req.user._id }).lean();
    if (!existing) return res.status(404).json({ error: 'Calendar not found' });

    const prevOutside = (existing.sharedWithOutside || []).map(normalizeOutsideEntry);
    const nextOutside = sharedWithOutside !== undefined
      ? normalizeOutsideList(sharedWithOutside)
      : prevOutside;
    if (outsideShareBlocked(req, prevOutside, nextOutside)) {
      return res.status(409).json({ error: 'decrypt_required' });
    }

    const updates = {};
    if (name !== undefined)                updates.name                = name;
    if (color !== undefined)               updates.color               = color;
    if (alertsEnabled !== undefined)       updates.alertsEnabled       = alertsEnabled;
    if (sharedWithHousehold !== undefined) updates.sharedWithHousehold = sharedWithHousehold;
    if (householdAccess !== undefined)     updates.householdAccess     = householdAccess === 'view' ? 'view' : 'full';
    if (sharedWith !== undefined)          updates.sharedWith          = (sharedWith || []).map(normalizeMemberEntry);
    if (sharedWithOutside !== undefined)   updates.sharedWithOutside   = nextOutside;
    // Holiday config is editable (regions/disabled change on HolidaysScreen),
    // but only on a calendar that already is one.
    if (holiday !== undefined && existing.holiday) {
      const hol = normalizeHoliday({ country: existing.holiday.country, ...holiday });
      if (hol) updates.holiday = hol;
    }

    const cal = await CustomCalendar.findOneAndUpdate(
      { key: req.params.key, userId: req.user._id },
      updates,
      { new: true },
    ).lean();
    if (!cal) return res.status(404).json({ error: 'Calendar not found' });

    await syncOutsideInvitations(cal, prevOutside, req);
    res.json(serialize(cal, req));
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:key', async (req, res) => {
  try {
    const cal = await CustomCalendar.findOneAndDelete({ key: req.params.key, userId: req.user._id });
    if (!cal) return res.status(404).json({ error: 'Calendar not found' });
    await CalendarInvitation.deleteMany({ calendarKey: cal.key }).catch(() => {});
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
