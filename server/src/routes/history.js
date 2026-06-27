const express = require('express');
const TaskCompletion = require('../models/TaskCompletion');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const { taskId, from, to, limit = 50 } = req.query;
    const filter = { userId: { $in: req.scopeIds } };
    if (taskId) filter.taskId = taskId;
    if (from || to) {
      filter.completedDate = {};
      if (from) filter.completedDate.$gte = new Date(from);
      if (to) filter.completedDate.$lte = new Date(to);
    }
    const history = await TaskCompletion.find(filter)
      .populate('taskId', 'title')
      .sort('-completedDate')
      .limit(Number(limit));
    res.json(history);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
