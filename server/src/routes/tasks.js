const express = require('express');
const { startOfDay, isBefore, addDays } = require('date-fns');
const MaintenanceTask = require('../models/MaintenanceTask');
const TaskCompletion = require('../models/TaskCompletion');
const { requireAuth } = require('../middleware/auth');
const { computeNextDueDate, computeNextDueKm, estimateDateFromKm, avgKmPerDay } = require('../services/recurrence');
const OdometerLog = require('../models/OdometerLog');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const { status, category, item } = req.query;
    const today = startOfDay(new Date());
    const leadDays = (req.household || req.user).reminderLeadDays || 7;
    const filter = { userId: { $in: req.scopeIds } };
    if (category) {
      filter.categoryId = Array.isArray(category) ? { $in: category } : category;
    }
    if (item) filter.itemId = item;

    if (status === 'overdue')   { filter.nextDueDate = { $lt: today }; filter.active = true; }
    if (status === 'due-soon')  { filter.nextDueDate = { $gte: today, $lte: addDays(today, leadDays) }; filter.active = true; }
    if (status === 'upcoming')  { filter.nextDueDate = { $gt: addDays(today, leadDays) }; filter.active = true; }
    if (status === 'paused')    filter.active = false;
    if (status === 'completed') { filter.nextDueDate = null; filter.lastCompletedAt = { $exists: true }; }

    const tasks = await MaintenanceTask.find(filter)
      .populate('itemId', 'name')
      .populate('categoryId', 'name icon color')
      .populate('subcategoryId', 'name icon color')
      .sort('nextDueDate');
    res.json(tasks);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const data = { ...req.body, userId: { $in: req.scopeIds } };
    if (!data.nextDueDate && data.recurrence) {
      data.nextDueDate = computeNextDueDate({ recurrence: data.recurrence }, data.lastCompletedAt || new Date());
    }
    const task = await MaintenanceTask.create(data);
    res.status(201).json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/completions', async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter = { userId: { $in: req.scopeIds } };
    if (from || to) {
      filter.completedDate = {};
      if (from) filter.completedDate.$gte = new Date(from);
      if (to)   filter.completedDate.$lte = new Date(to);
    }
    const completions = await TaskCompletion.find(filter)
      .populate({ path: 'taskId', select: 'title categoryId itemId', populate: { path: 'categoryId', select: 'name color icon' } })
      .sort('-completedDate')
      .lean();
    res.json(completions);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  const task = await MaintenanceTask.findOne({ _id: req.params.id, userId: { $in: req.scopeIds } })
    .populate('itemId', 'name')
    .populate('categoryId', 'name icon color')
    .populate('subcategoryId', 'name icon color');
  if (!task) return res.status(404).json({ error: 'Not found' });
  res.json(task);
});

router.put('/:id', async (req, res) => {
  try {
    const task = await MaintenanceTask.findOneAndUpdate(
      { _id: req.params.id, userId: { $in: req.scopeIds } },
      req.body,
      { new: true, runValidators: true }
    );
    if (!task) return res.status(404).json({ error: 'Not found' });
    res.json(task);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const task = await MaintenanceTask.findOneAndDelete({ _id: req.params.id, userId: { $in: req.scopeIds } });
    if (!task) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/complete', async (req, res) => {
  try {
    const task = await MaintenanceTask.findOne({ _id: req.params.id, userId: { $in: req.scopeIds } });
    if (!task) return res.status(404).json({ error: 'Not found' });

    const completedDate = req.body.completedDate ? new Date(req.body.completedDate) : new Date();
    const odometerReading = req.body.odometerReading != null ? Number(req.body.odometerReading) : null;

    // Time-based next due date
    const nextDueDate = task.recurrence?.type !== 'one-time'
      ? computeNextDueDate(task, completedDate)
      : null;

    // Mileage-based next due km
    let nextDueKm = task.nextDueKm;
    if (task.intervalKm && odometerReading != null) {
      nextDueKm = computeNextDueKm(task, odometerReading);

      // If we also have odometer history, update the estimated date
      const logs = await OdometerLog.find({ itemId: task.itemId, userId: { $in: req.scopeIds } }).lean();
      const kmPerDay = avgKmPerDay([...logs, { reading: odometerReading, recordedAt: new Date() }]);
      if (kmPerDay && nextDueKm) {
        task.nextDueDate = estimateDateFromKm(nextDueKm, odometerReading, kmPerDay) || nextDueDate;
      }
    }

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

    task.lastCompletedAt = completedDate;
    if (!task.intervalKm) task.nextDueDate = nextDueDate;
    if (task.intervalKm && odometerReading != null) {
      task.lastServiceKm = odometerReading;
      task.nextDueKm = nextDueKm;
    }
    await task.save();

    res.json({ task, completion });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/pause', async (req, res) => {
  const task = await MaintenanceTask.findOneAndUpdate(
    { _id: req.params.id, userId: { $in: req.scopeIds } },
    { active: false },
    { new: true }
  );
  if (!task) return res.status(404).json({ error: 'Not found' });
  res.json(task);
});

router.post('/:id/resume', async (req, res) => {
  const task = await MaintenanceTask.findOneAndUpdate(
    { _id: req.params.id, userId: { $in: req.scopeIds } },
    { active: true },
    { new: true }
  );
  if (!task) return res.status(404).json({ error: 'Not found' });
  res.json(task);
});

router.post('/from-template', async (req, res) => {
  try {
    const templates = require('../../../shared/seed/taskTemplates.json');
    const { templateIds, categoryId } = req.body;
    const toCreate = templates.filter(t => templateIds.includes(t.id));
    const created = [];
    for (const tpl of toCreate) {
      const data = {
        userId: req.user._id,
        title: tpl.title,
        description: tpl.description,
        recurrence: tpl.recurrence,
        priority: tpl.priority || 'medium',
        estimatedDurationMins: tpl.estimatedDurationMins,
        estimatedCost: tpl.estimatedCost,
        intervalKm: tpl.intervalKm,
        templateId: tpl.id,
      };
      if (categoryId) data.categoryId = categoryId;
      else if (tpl.defaultCategoryName) {
        const Category = require('../models/Category');
        const cat = await Category.findOne({ userId: { $in: req.scopeIds }, name: tpl.defaultCategoryName });
        if (cat) data.categoryId = cat._id;
      }
      data.nextDueDate = computeNextDueDate({ recurrence: data.recurrence }, new Date());
      created.push(await MaintenanceTask.create(data));
    }
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
