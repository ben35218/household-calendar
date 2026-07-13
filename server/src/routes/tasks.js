const express = require('express');
const { startOfDay, isBefore, addDays } = require('date-fns');
const MaintenanceTask = require('../models/MaintenanceTask');
const TaskCompletion = require('../models/TaskCompletion');
const { requireAuth } = require('../middleware/auth');
const { activity } = require('../middleware/activity');
const { computeNextDueDate, anchorRecurrence, computeNextDueKm, estimateDateFromKm, avgKmPerDay } = require('../services/recurrence');
const OdometerLog = require('../models/OdometerLog');

const router = express.Router();
router.use(requireAuth);

// Seed the first due date for a task created from a template. Interval templates
// can carry an ideal `months` anchor (e.g. flush the water heater in September);
// the calendar engine only honors that anchor for 'years', so here we start any
// month-anchored interval on the next occurrence of that month. Cadence after
// completion is unchanged — completions run back through computeNextDueDate, so a
// "every 3 months" task still repeats quarterly from when it was last done.
function seedDueDate(recurrence, fromDate) {
  const r = recurrence;
  if (r && r.type === 'interval' && Array.isArray(r.months) && r.months.length) {
    const today = startOfDay(fromDate);
    const day = r.dayOfMonth || 1;
    const m = r.months[0] - 1; // stored 1-based
    let d = new Date(today.getFullYear(), m, day);
    if (d.getTime() <= today.getTime()) d = new Date(today.getFullYear() + 1, m, day);
    return d;
  }
  return computeNextDueDate({ recurrence: r }, fromDate);
}

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
      .populate('itemId', 'name type')
      .populate('categoryId', 'name icon color')
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
    .populate('itemId', 'name type')
    .populate('categoryId', 'name icon color');
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

router.post('/:id/complete', activity('taskCompleted'), async (req, res) => {
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
    const Category = require('../models/Category');
    // Two payload shapes:
    //  - selections: [{ templateId, itemId?, categoryId? }] — bulk flow that links
    //    each task to a specific item (and optionally a resolved category).
    //  - templateIds: string[] (+ optional shared categoryId) — legacy single path.
    const { selections, templateIds, categoryId } = req.body;
    const requests = Array.isArray(selections)
      ? selections
      : (templateIds || []).map(id => ({ templateId: id, categoryId }));

    // Cache category lookups by name so we don't re-query per template.
    const catByName = new Map();
    const resolveCategoryByName = async (name) => {
      if (!name) return null;
      if (catByName.has(name)) return catByName.get(name);
      const cat = await Category.findOne({ userId: { $in: req.scopeIds }, name });
      catByName.set(name, cat ? cat._id : null);
      return cat ? cat._id : null;
    };

    const created = [];
    for (const sel of requests) {
      const tpl = templates.find(t => t.id === sel.templateId);
      if (!tpl) continue;
      const data = {
        userId: req.user._id,
        title: tpl.title,
        description: tpl.description,
        recurrence: anchorRecurrence(tpl.recurrence),
        priority: tpl.priority || 'medium',
        estimatedDurationMins: tpl.estimatedDurationMins,
        estimatedCost: tpl.estimatedCost,
        intervalKm: tpl.intervalKm,
        templateId: tpl.id,
      };
      if (sel.itemId) data.itemId = sel.itemId;
      const cat = sel.categoryId || (await resolveCategoryByName(tpl.defaultCategoryName));
      if (cat) data.categoryId = cat;
      data.nextDueDate = seedDueDate(data.recurrence, new Date());
      created.push(await MaintenanceTask.create(data));
    }
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
