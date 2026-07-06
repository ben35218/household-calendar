const express = require('express');
const CalendarEvent    = require('../models/CalendarEvent');
const { requireAuth }  = require('../middleware/auth');
const Person           = require('../models/Person');
const { collectCalendarRecords, fetchCalendarSources } = require('../services/calendarData');
const { isObjectId, pickRecordEnc } = require('../services/householdKey');

const router = express.Router();
router.use(requireAuth);

function buildReminderAt(startDate, reminderMinutes) {
  if (reminderMinutes == null || !startDate) return undefined;
  return new Date(new Date(startDate).getTime() - reminderMinutes * 60000);
}

function buildRecurrence(rec) {
  if (!rec?.freq) return undefined;
  return {
    freq:     rec.freq,
    interval: rec.interval || 1,
    until:    rec.until ? new Date(rec.until) : undefined,
  };
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
    const sources = await fetchCalendarSources({ scopeIds: req.scopeIds, fromDate, toDate });

    res.json({
      ...sources,
      selfId: String(req.user._id),
      groceryShoppingDay: (req.household || req.user)?.groceryShoppingDay ?? 6,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/events/:id', async (req, res) => {
  try {
    const event = await CalendarEvent.findOne({ _id: req.params.id, userId: { $in: req.scopeIds } });
    if (!event) return res.status(404).json({ error: 'Not found' });
    res.json(event);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/events', async (req, res) => {
  try {
    const {
      calendarType, title, description, location, placeId, url,
      allDay, startDate, endDate, phone,
      travelMinutes, travelDistanceKm,
      reminderMinutes, alert2Minutes, alertAudience,
      recurrence,
    } = req.body;

    let encFields;
    try { encFields = pickRecordEnc(req.body); }
    catch (msg) { return res.status(400).json({ error: msg }); }

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
    const {
      title, description, location, placeId, url,
      allDay, startDate, endDate, calendarType, phone,
      travelMinutes, travelDistanceKm,
      reminderMinutes, alert2Minutes, alertAudience,
      recurrence,
    } = req.body;

    const updates = {};
    if (alertAudience !== undefined)    updates.alertAudience    = alertAudience;
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
      const existing = await CalendarEvent
        .findOne({ _id: req.params.id, userId: { $in: req.scopeIds } }, 'startDate reminderMinutes alert2Minutes')
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
      { _id: req.params.id, userId: { $in: req.scopeIds } },
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
    const result = await CalendarEvent.deleteOne({ _id: req.params.id, userId: { $in: req.scopeIds } });
    if (result.deletedCount === 0) return res.status(404).json({ error: 'Event not found' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
