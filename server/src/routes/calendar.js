const express = require('express');
const CalendarEvent    = require('../models/CalendarEvent');
const CustomCalendar   = require('../models/CustomCalendar');
const { requireAuth }  = require('../middleware/auth');
const { activity }     = require('../middleware/activity');
const Person           = require('../models/Person');
const { collectCalendarRecords, fetchCalendarSources } = require('../services/calendarData');
const { effectiveCalendarAccess } = require('../services/calendarSharing');
const { isObjectId, pickRecordEnc } = require('../services/householdKey');

const router = express.Router();
router.use(requireAuth);

function buildReminderAt(startDate, reminderMinutes) {
  if (reminderMinutes == null || !startDate) return undefined;
  return new Date(new Date(startDate).getTime() - reminderMinutes * 60000);
}

function buildRecurrence(rec) {
  if (!rec?.freq) return undefined;
  const numArray = (a, min, max) => {
    if (!Array.isArray(a)) return undefined;
    const nums = [...new Set(a.map(Number).filter(n => Number.isInteger(n) && n >= min && n <= max))];
    return nums.length ? nums.sort((x, y) => x - y) : undefined;
  };
  const out = {
    freq:     rec.freq,
    interval: rec.interval || 1,
    until:    rec.until ? new Date(rec.until) : undefined,
  };
  // Weekly weekday pattern / monthly date or ordinal pattern — see the model.
  if (rec.freq === 'weekly') {
    out.daysOfWeek = numArray(rec.daysOfWeek, 0, 6);
  } else if (rec.freq === 'monthly') {
    out.daysOfMonth = numArray(rec.daysOfMonth, 1, 31);
    if (!out.daysOfMonth && rec.weekOfMonth != null && rec.weekdayKind) {
      out.weekOfMonth = rec.weekOfMonth;
      out.weekdayKind = rec.weekdayKind;
    }
  } else if (rec.freq === 'yearly') {
    out.months = numArray(rec.months, 1, 12);
    if (out.months && rec.weekOfMonth != null && rec.weekdayKind) {
      out.weekOfMonth = rec.weekOfMonth;
      out.weekdayKind = rec.weekdayKind;
    }
  }
  return out;
}

router.get('/', async (req, res) => {
  try {
    const { from, to } = req.query;
    const fromDate = from ? new Date(from) : new Date(0);
    const toDate   = to   ? new Date(to)   : new Date('2099-12-31');

    const data = await collectCalendarRecords({
      scopeIds: req.scopeIds,
      fromDate,
      toDate,
      user: req.user,
      household: req.household,
    });

    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Raw source records for CLIENT-side expansion (§9.1 P2). Returns the same
// records collectCalendarRecords fetches, but unexpanded and with their enc
// blobs intact, so the client runs the shared @household/calendar engine over
// the decrypted records (offline via the replica, and post-§9-drop when the
// server can no longer expand). Dual-write: plaintext is still included today.
router.get('/raw', async (req, res) => {
  try {
    const { from, to } = req.query;
    const fromDate = from ? new Date(from) : new Date(0);
    const toDate   = to   ? new Date(to)   : new Date('2099-12-31');

    if (req.user) await Person.ensureSelf(req.user);
    // Post-drop the server can't filter on the encrypted date/birthday fields,
    // so it returns everything and the client filters (§9.1 P6).
    const sources = await fetchCalendarSources({
      scopeIds: req.scopeIds, requesterId: req.user._id, fromDate, toDate,
      allDates: !!req.household?.e2eeActive,
    });

    res.json({
      ...sources,
      selfId: String(req.user._id),
      groceryShoppingDay: (req.household || req.user)?.groceryShoppingDay ?? 6,
      groceryFrequency: (req.household || req.user)?.groceryFrequency ?? 'weekly',
      groceryAnchor: (req.household || req.user)?.groceryAnchor ?? null,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// The requester's authorization on an event row: 'write' (may edit/delete),
// 'read', or null (no access — respond 404, don't leak existence). Built-ins
// stay household-scoped; custom keys follow the calendar's per-person access
// (View Only / Full Access), which also lets full-access outside collaborators
// write (§9.5).
async function eventAuthz(req, target) {
  const inScope = req.scopeIds.some((id) => String(id) === String(target.userId));
  const type = target.calendarType;
  if (!type || !String(type).startsWith('custom-')) return inScope ? 'write' : null;
  const cal = await CustomCalendar.findOne({ key: type }).lean();
  if (!cal) return inScope ? 'write' : null; // stale key — legacy household event
  // Subscribed (feed) and holiday calendars are always read-only — their
  // events are computed/fetched client-side, never CalendarEvent rows; nobody
  // may write, owner included.
  if (cal.feedUrl || cal.holiday) {
    return (effectiveCalendarAccess(cal, req.user._id, req.scopeIds) || inScope) ? 'read' : null;
  }
  const access = effectiveCalendarAccess(cal, req.user._id, req.scopeIds);
  if (access === 'full') return 'write';
  if (access === 'view') return 'read';
  // A housemate the calendar isn't shared with still reads household data
  // (the client hides it); they just can't write to the calendar.
  return inScope ? 'read' : null;
}

// Custom-calendar keys where the requester is a seated outside collaborator
// (either access level). Covers legacy plain-id rows too.
function collaboratorKeys(req) {
  return CustomCalendar.find({
    $or: [{ 'collaborators.userId': req.user._id }, { collaborators: req.user._id }],
  }).distinct('key');
}

router.get('/events/:id', async (req, res) => {
  try {
    let event = await CalendarEvent.findOne({ _id: req.params.id, userId: { $in: req.scopeIds } }).lean();
    if (!event) {
      // Outside collaborator on the event's custom calendar (§9.5).
      const keys = await collaboratorKeys(req);
      if (keys.length) {
        event = await CalendarEvent.findOne({ _id: req.params.id, calendarType: { $in: keys } }).lean();
      }
    }
    if (!event) return res.status(404).json({ error: 'Not found' });
    const authz = await eventAuthz(req, event);
    if (!authz) return res.status(404).json({ error: 'Not found' });
    // `readOnly` is response-only and drives the client's read-only view.
    res.json(authz === 'read' ? { ...event, readOnly: true } : event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/events', activity('eventCreated'), async (req, res) => {
  try {
    const {
      calendarType, title, description, location, placeId, url,
      allDay, startDate, endDate, phone,
      travelMinutes, travelDistanceKm,
      reminderMinutes, alert2Minutes, alertAudience, guestListVisible,
      recurrence,
    } = req.body;

    let encFields;
    try { encFields = pickRecordEnc(req.body); }
    catch (msg) { return res.status(400).json({ error: msg }); }

    // Custom calendars gate creation by access: View Only can't add events.
    // (Built-ins create under the requester's own userId — always allowed.)
    const authz = await eventAuthz(req, { userId: req.user._id, calendarType });
    if (authz !== 'write') {
      return res.status(403).json({ error: 'You have view-only access to this calendar' });
    }

    const event = await CalendarEvent.create({
      // Honor a client-minted _id (present when the client encrypted the record,
      // so the AAD binds to this id); otherwise let Mongo assign one.
      ...(isObjectId(req.body._id) ? { _id: req.body._id } : {}),
      userId: req.user._id,
      calendarType, title, description, location, placeId, url,
      allDay:      allDay !== false,
      startDate:   new Date(startDate),
      endDate:     endDate ? new Date(endDate) : undefined,
      phone,
      travelMinutes, travelDistanceKm,
      reminderMinutes,
      reminderAt:  buildReminderAt(startDate, reminderMinutes),
      alert2Minutes,
      alert2At:    buildReminderAt(startDate, alert2Minutes),
      alertAudience: alertAudience || 'everyone',
      guestListVisible: guestListVisible !== false,
      recurrence:  buildRecurrence(recurrence),
      ...encFields,
    });
    res.status(201).json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/events/:id', async (req, res) => {
  try {
    // An invited copy (accepted from a cross-household invitation) is read-only
    // for its recipient household — the invitee can only leave the event.
    // Otherwise writes follow eventAuthz: household scoping for built-ins,
    // per-calendar access for custom keys (full-access collaborators included).
    const target = await CalendarEvent
      .findOne({ _id: req.params.id }, 'invitationId userId calendarType').lean();
    const targetAuthz = target && (await eventAuthz(req, target));
    if (!target || !targetAuthz) return res.status(404).json({ error: 'Event not found' });
    if (target.invitationId) {
      return res.status(403).json({ error: 'Invited events can’t be edited — you can leave the event instead' });
    }
    if (targetAuthz !== 'write') {
      return res.status(403).json({ error: 'You have view-only access to this calendar' });
    }
    // Moving the event to another calendar needs write access there too.
    if (req.body.calendarType && req.body.calendarType !== target.calendarType) {
      const destAuthz = await eventAuthz(req, { userId: target.userId, calendarType: req.body.calendarType });
      if (destAuthz !== 'write') {
        return res.status(403).json({ error: 'You have view-only access to that calendar' });
      }
    }

    const {
      title, description, location, placeId, url,
      allDay, startDate, endDate, calendarType, phone,
      travelMinutes, travelDistanceKm,
      reminderMinutes, alert2Minutes, alertAudience, guestListVisible,
      recurrence,
    } = req.body;

    const updates = {};
    if (alertAudience !== undefined)    updates.alertAudience    = alertAudience;
    if (guestListVisible !== undefined) updates.guestListVisible = !!guestListVisible;
    if (title !== undefined)            updates.title            = title;
    if (description !== undefined)      updates.description      = description;
    if (location !== undefined)         updates.location         = location;
    if (placeId !== undefined)          updates.placeId          = placeId;
    if (url !== undefined)              updates.url              = url;
    if (allDay !== undefined)           updates.allDay           = allDay;
    if (calendarType)                   updates.calendarType     = calendarType;
    if (startDate)                      updates.startDate        = new Date(startDate);
    if (endDate)                        updates.endDate          = new Date(endDate);
    if (phone !== undefined)            updates.phone            = phone;
    if (travelMinutes !== undefined)    updates.travelMinutes    = travelMinutes;
    if (travelDistanceKm !== undefined) updates.travelDistanceKm = travelDistanceKm;
    if (reminderMinutes !== undefined)  updates.reminderMinutes  = reminderMinutes;
    if (alert2Minutes !== undefined)    updates.alert2Minutes    = alert2Minutes;
    if (recurrence !== undefined)       updates.recurrence       = buildRecurrence(recurrence);

    // Re-encrypted content from the client (dual-write). Overwrites the prior
    // ciphertext at the current key version.
    try { Object.assign(updates, pickRecordEnc(req.body)); }
    catch (msg) { return res.status(400).json({ error: msg }); }

    // Recompute alert times when startDate or alert minutes change
    if (startDate !== undefined || reminderMinutes !== undefined || alert2Minutes !== undefined) {
      // Authorization happened above (eventAuthz) — fetch by id so full-access
      // collaborators' edits recompute alerts too.
      const existing = await CalendarEvent
        .findOne({ _id: req.params.id }, 'startDate reminderMinutes alert2Minutes')
        .lean();
      const base  = updates.startDate ?? existing?.startDate;
      const mins1 = reminderMinutes !== undefined ? reminderMinutes : existing?.reminderMinutes;
      const mins2 = alert2Minutes   !== undefined ? alert2Minutes   : existing?.alert2Minutes;
      updates.reminderAt   = buildReminderAt(base, mins1);
      updates.reminderSentAt = null;
      updates.alert2At     = buildReminderAt(base, mins2);
      updates.alert2SentAt = null;
    }

    const event = await CalendarEvent.findOneAndUpdate(
      { _id: req.params.id },
      updates,
      { new: true },
    );
    if (!event) return res.status(404).json({ error: 'Event not found' });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/events/:id', async (req, res) => {
  try {
    // Invited copies go through leave (retires the invitation), not delete —
    // see routes/invitations.js. Otherwise deletes follow eventAuthz like PUT.
    const target = await CalendarEvent
      .findOne({ _id: req.params.id }, 'invitationId userId calendarType').lean();
    const authz = target && (await eventAuthz(req, target));
    if (!target || !authz) return res.status(404).json({ error: 'Event not found' });
    if (target.invitationId) {
      return res.status(403).json({ error: 'Invited events can’t be deleted — leave the event instead' });
    }
    if (authz !== 'write') {
      return res.status(403).json({ error: 'You have view-only access to this calendar' });
    }
    await CalendarEvent.deleteOne({ _id: req.params.id });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
