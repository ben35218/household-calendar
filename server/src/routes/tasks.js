const express = require('express');
const Record = require('../models/Record');
const TaskCompletion = require('../models/TaskCompletion');
const { requireAuth } = require('../middleware/auth');
const { activity } = require('../middleware/activity');
const { pickRecordEnc } = require('../services/householdKey');

const router = express.Router();
router.use(requireAuth);

// Signal-parity C3b: task CONTENT (create/read/update/delete, and the pause/resume
// `active` toggle) moved to the unified opaque store — the client reads its tasks
// from the replica (populated by /records/sync) and writes them through /records,
// so the server never sees the collection type. What stays here is the completion
// LEDGER (TaskCompletion is its own model, keyed to a task by id) and the
// content-blind complete action, which records the completion facts and applies
// the client-re-sealed task ciphertext to the task's Record row.

// The completion history for the maintenance dashboard. Raw rows only — the task
// title/category is decrypted client-side from the replica by `taskId` (the server
// can't populate a sealed task).
router.get('/completions', async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = { ...req.scopeFilter };
    if (from || to) {
      filter.completedDate = {};
      if (from) filter.completedDate.$gte = new Date(from);
      if (to)   filter.completedDate.$lte = new Date(to);
    }
    const completions = await TaskCompletion.find(filter).sort('-completedDate').lean();
    res.json(completions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Content-blind completion (Signal-parity D4 + C3b): the CLIENT computes the next
// due date (shared computeNextDueDate) + the mileage rollover and sends the
// results — plus the task's re-sealed `enc` carrying the new nextDueDate — with the
// completion facts. The server records the completion and applies the re-sealed
// ciphertext to the task's `Record` row; it never computes or reads content.
router.post('/:id/complete', activity('taskCompleted'), async (req, res) => {
  try {
    // The task now lives in the unified store; verify it's in scope by its Record.
    const task = await Record.findOne({ _id: req.params.id, ...req.scopeFilter }).lean();
    if (!task) return res.status(404).json({ error: 'Not found' });

    // Validate the re-sealed envelope BEFORE recording anything: a malformed
    // envelope must not leave an orphaned ledger row behind a 400 (the client
    // retries and would double-log the completion).
    let enc;
    try { enc = pickRecordEnc(req.body); }
    catch (msg) { return res.status(400).json({ error: String(msg) }); }

    const completedDate = req.body.completedDate ? new Date(req.body.completedDate) : new Date();
    const odometerReading = req.body.odometerReading != null ? Number(req.body.odometerReading) : null;
    const nextDueDate = req.body.nextDueDate ? new Date(req.body.nextDueDate) : null;

    const completion = await TaskCompletion.create({
      userId: req.user._id,
      taskId: task._id,
      completedDate,
      cost: req.body.cost,
      notes: req.body.notes,
      performedBy: req.body.performedBy || 'self',
      odometerReading,
      nextDueDateAfter: nextDueDate,
    });

    // Apply the re-sealed ciphertext (the enc blob now carries the new nextDueDate /
    // lastServiceKm / nextDueKm) to the task's Record row. Opaque-only — no
    // plaintext content is stored.
    if (enc.enc) await Record.updateOne({ _id: task._id, ...req.scopeFilter }, { $set: enc });

    res.json({ task: { _id: task._id }, completion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET / POST / GET :id / PUT :id / DELETE :id / pause / resume were RETIRED
// (Signal-parity C3b): task content CRUD is the unified /records API now, and
// pause/resume flip the (sealed) `active` field, so the client re-seals + PUTs
// /records/:id. POST /from-template was already removed in D4.

module.exports = router;
