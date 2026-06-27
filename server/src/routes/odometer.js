const express = require('express');
const OdometerLog = require('../models/OdometerLog');
const Item = require('../models/Item');
const MaintenanceTask = require('../models/MaintenanceTask');
const { requireAuth } = require('../middleware/auth');
const { avgKmPerDay, estimateDateFromKm } = require('../services/recurrence');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

// GET /api/vehicles/:itemId/odometer
// Returns log entries, current reading, avg km/day, and enriched mileage tasks
router.get('/', async (req, res) => {
  try {
    const item = await Item.findOne({ _id: req.params.itemId, userId: { $in: req.scopeIds } });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const logs = await OdometerLog.find({ itemId: item._id, userId: { $in: req.scopeIds } })
      .sort({ recordedAt: -1 })
      .limit(50)
      .lean();

    const kmPerDay = avgKmPerDay(logs);
    const currentKm = logs[0]?.reading ?? null;

    // Enrich mileage-based tasks with remaining km + estimated date
    const mileageTasks = await MaintenanceTask.find({
      itemId: item._id,
      userId: { $in: req.scopeIds },
      intervalKm: { $exists: true, $ne: null },
    }).lean();

    const enriched = mileageTasks.map(t => {
      // If nextDueKm has never been set (task never completed), estimate it as
      // the next interval boundary above the current odometer reading.
      let nextDueKm = t.nextDueKm;
      let lastServiceKm = t.lastServiceKm;
      if (nextDueKm == null && t.intervalKm && currentKm != null) {
        const intervals = Math.ceil(currentKm / t.intervalKm);
        nextDueKm = intervals * t.intervalKm;
        // Implied last service at the previous boundary
        lastServiceKm = nextDueKm - t.intervalKm;
      }

      const remainingKm = nextDueKm != null && currentKm != null
        ? nextDueKm - currentKm
        : null;
      const estimatedDate = nextDueKm != null && currentKm != null && kmPerDay
        ? estimateDateFromKm(nextDueKm, currentKm, kmPerDay)
        : null;

      return {
        _id: t._id,
        title: t.title,
        intervalKm: t.intervalKm,
        lastServiceKm,
        nextDueKm,
        remainingKm,
        estimatedDate,
        priority: t.priority,
      };
    }).sort((a, b) => (a.remainingKm ?? Infinity) - (b.remainingKm ?? Infinity));

    res.json({ logs, currentKm, kmPerDay: kmPerDay ? Math.round(kmPerDay) : null, mileageTasks: enriched });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vehicles/:itemId/odometer
// Log a new odometer reading
router.post('/', async (req, res) => {
  try {
    const item = await Item.findOne({ _id: req.params.itemId, userId: { $in: req.scopeIds } });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const { reading, recordedAt, notes } = req.body;
    if (reading == null || isNaN(reading)) {
      return res.status(400).json({ error: 'reading (km) is required' });
    }

    // Reject if lower than the most recent reading
    const latest = await OdometerLog.findOne({ itemId: item._id }).sort({ recordedAt: -1 });
    if (latest && reading < latest.reading) {
      return res.status(400).json({
        error: `Reading must be greater than the last recorded value (${latest.reading.toLocaleString()} km)`,
      });
    }

    const log = await OdometerLog.create({
      userId: req.user._id,
      itemId: item._id,
      reading: Number(reading),
      recordedAt: recordedAt ? new Date(recordedAt) : new Date(),
      notes,
    });

    // Recalculate estimated due dates on mileage tasks if we have enough history
    const allLogs = await OdometerLog.find({ itemId: item._id, userId: { $in: req.scopeIds } }).lean();
    const allWithNew = [...allLogs, { reading: Number(reading), recordedAt: log.recordedAt }];
    const kmPerDay = avgKmPerDay(allWithNew);
    if (kmPerDay) {
      const mileageTasks = await MaintenanceTask.find({
        itemId: item._id,
        userId: { $in: req.scopeIds },
        intervalKm: { $exists: true, $ne: null },
        nextDueKm: { $exists: true, $ne: null },
      });
      for (const t of mileageTasks) {
        const est = estimateDateFromKm(t.nextDueKm, Number(reading), kmPerDay);
        if (est) { t.nextDueDate = est; await t.save(); }
      }
    }

    // Also update the odometer custom field on the item so the detail card stays in sync
    const odomField = item.customFields?.find(f => f.key === 'Odometer (km)');
    if (odomField) {
      odomField.value = String(Math.round(reading));
    } else {
      item.customFields = item.customFields || [];
      item.customFields.push({ key: 'Odometer (km)', value: String(Math.round(reading)) });
    }
    await item.save();

    res.status(201).json(log);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/vehicles/:itemId/odometer/:logId
router.delete('/:logId', async (req, res) => {
  try {
    const log = await OdometerLog.findOneAndDelete({
      _id: req.params.logId,
      itemId: req.params.itemId,
      userId: { $in: req.scopeIds },
    });
    if (!log) return res.status(404).json({ error: 'Log entry not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
