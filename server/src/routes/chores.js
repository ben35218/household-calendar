const express = require('express');
const { startOfDay, addDays } = require('date-fns');
const Chore = require('../models/Chore');
const { requireAuth } = require('../middleware/auth');
const { activity } = require('../middleware/activity');
const { computeNextDueDate } = require('../services/recurrence');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const { status } = req.query;
    const today = startOfDay(new Date());
    const leadDays = (req.household || req.user).reminderLeadDays || 7;
    const filter = { userId: { $in: req.scopeIds } };

    if (status === 'overdue')  { filter.nextDueDate = { $lt: today }; filter.active = true; }
    if (status === 'due-soon') { filter.nextDueDate = { $gte: today, $lte: addDays(today, leadDays) }; filter.active = true; }
    if (status === 'upcoming') { filter.nextDueDate = { $gt: addDays(today, leadDays) }; filter.active = true; }
    if (status === 'paused')   filter.active = false;

    const chores = await Chore.find(filter).populate('assignedTo', 'name accountId type').sort('nextDueDate');
    res.json(chores);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', activity('choreCreated'), async (req, res) => {
  try {
    const data = { ...req.body, userId: { $in: req.scopeIds } };
    if (!data.nextDueDate && data.recurrence) {
      data.nextDueDate = computeNextDueDate({ recurrence: data.recurrence }, new Date());
    }
    const chore = await Chore.create(data);
    res.status(201).json(chore);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  const chore = await Chore.findOne({ _id: req.params.id, userId: { $in: req.scopeIds } })
    .populate('assignedTo', 'name accountId type');
  if (!chore) return res.status(404).json({ error: 'Not found' });
  res.json(chore);
});

router.put('/:id', async (req, res) => {
  try {
    const chore = await Chore.findOneAndUpdate(
      { _id: req.params.id, userId: { $in: req.scopeIds } },
      req.body,
      { new: true, runValidators: true }
    );
    if (!chore) return res.status(404).json({ error: 'Not found' });
    res.json(chore);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const chore = await Chore.findOneAndDelete({ _id: req.params.id, userId: { $in: req.scopeIds } });
    if (!chore) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/:id/pause', async (req, res) => {
  const chore = await Chore.findOneAndUpdate(
    { _id: req.params.id, userId: { $in: req.scopeIds } },
    { active: false },
    { new: true }
  );
  if (!chore) return res.status(404).json({ error: 'Not found' });
  res.json(chore);
});

router.post('/:id/resume', async (req, res) => {
  const chore = await Chore.findOneAndUpdate(
    { _id: req.params.id, userId: { $in: req.scopeIds } },
    { active: true },
    { new: true }
  );
  if (!chore) return res.status(404).json({ error: 'Not found' });
  res.json(chore);
});

router.post('/from-template', async (req, res) => {
  try {
    const templates = require('../../../shared/seed/choreTemplates.json');
    const { templateIds } = req.body;
    const toCreate = templates.filter(t => templateIds.includes(t.id));
    const created = [];
    for (const tpl of toCreate) {
      const data = {
        userId: req.user._id,
        title: tpl.title,
        instructions: tpl.description,
        icon: tpl.icon || 'mdi-broom',
        recurrence: tpl.recurrence,
        templateId: tpl.id,
      };
      data.nextDueDate = computeNextDueDate({ recurrence: data.recurrence }, new Date());
      created.push(await Chore.create(data));
    }
    res.status(201).json(created);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
