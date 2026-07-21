const express = require('express');
const OdometerLog = require('../models/OdometerLog');
const Item = require('../models/Item');
const MaintenanceTask = require('../models/MaintenanceTask');
const { requireAuth } = require('../middleware/auth');
const { isObjectId, pickRecordEnc } = require('../services/householdKey');
const { plaintextCreateBlocked, E2EE_REQUIRED_MESSAGE, stripSealedContent } = require('../services/e2eePolicy');

const router = express.Router({ mergeParams: true });
router.use(requireAuth);

// Mileage scheduling is CLIENT-side (Signal-parity D5): readings are content
// (sealed into `enc`), so the server no longer validates monotonicity, averages
// km/day, or estimates due dates — the app does all of that over its decrypted
// logs (shared avgKmPerDay/estimateDateFromKm) and writes the results back
// through the ordinary task update path.

// GET /api/vehicles/:itemId/odometer — raw rows only; the client decrypts and
// derives currentKm / kmPerDay / remaining-km enrichment itself.
router.get('/', async (req, res) => {
  try {
    const item = await Item.findOne({ _id: req.params.itemId, ...req.scopeFilter });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    const logs = await OdometerLog.find({ itemId: item._id, ...req.scopeFilter })
      .sort({ recordedAt: -1 })
      .limit(50)
      .lean();

    const mileageTasks = await MaintenanceTask.find({
      itemId: item._id,
      ...req.scopeFilter,
      intervalKm: { $exists: true, $ne: null },
    }).lean();

    res.json({ logs, mileageTasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/vehicles/:itemId/odometer — log a new reading (content-blind).
router.post('/', async (req, res) => {
  try {
    const item = await Item.findOne({ _id: req.params.itemId, ...req.scopeFilter });
    if (!item) return res.status(404).json({ error: 'Item not found' });

    let enc;
    try { enc = pickRecordEnc(req.body); }
    catch (msg) { return res.status(400).json({ error: String(msg) }); }
    if (plaintextCreateBlocked(req.household, enc.enc)) {
      return res.status(400).json({ error: E2EE_REQUIRED_MESSAGE });
    }

    const { reading, recordedAt, notes } = req.body;
    const data = {
      ...(isObjectId(req.body._id) ? { _id: req.body._id } : {}),
      userId: req.user._id,
      itemId: item._id,
      reading: reading != null && !isNaN(reading) ? Number(reading) : undefined,
      recordedAt: recordedAt ? new Date(recordedAt) : new Date(),
      notes,
      ...enc,
    };
    // Steady-state write rule: a sealed odometer log stores no plaintext reading/
    // notes (recordedAt/itemId stay plaintext routing).
    stripSealedContent('OdometerLog', req.household, data);
    const log = await OdometerLog.create(data);

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
      ...req.scopeFilter,
    });
    if (!log) return res.status(404).json({ error: 'Log entry not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
