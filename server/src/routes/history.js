const express = require('express');
const TaskCompletion = require('../models/TaskCompletion');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const { taskId, from, to, limit = 50 } = req.query;
    const filter = { ...req.scopeFilter };
    if (taskId) filter.taskId = taskId;
    if (from || to) {
      filter.completedDate = {};
      if (from) filter.completedDate.$gte = new Date(from);
      if (to) filter.completedDate.$lte = new Date(to);
    }
    // C3b: raw rows only — the task title is sealed (in the unified store), so the
    // client joins it from its replica by `taskId` rather than a server populate.
    const history = await TaskCompletion.find(filter)
      .sort('-completedDate')
      .limit(Number(limit));
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
