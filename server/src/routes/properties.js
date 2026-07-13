const express = require('express');
const Property = require('../models/Property');
const Item = require('../models/Item');
const MaintenanceTask = require('../models/MaintenanceTask');
const TaskCompletion = require('../models/TaskCompletion');
const OdometerLog = require('../models/OdometerLog');
const Manual = require('../models/Manual');
const Receipt = require('../models/Receipt');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  let props = await Property.find({ userId: { $in: req.scopeIds } }).sort('sortOrder name');
  // Lazy seed: every household starts with a default "Home".
  if (props.length === 0) {
    const home = await Property.create({ userId: req.user._id, name: 'Home' });
    props = [home];
  }
  res.json(props);
});

router.post('/', async (req, res) => {
  try {
    const { name, icon, color, sortOrder } = req.body;
    const prop = await Property.create({ userId: req.user._id, name, icon, color, sortOrder });
    res.status(201).json(prop);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const prop = await Property.findOneAndUpdate(
      { _id: req.params.id, userId: { $in: req.scopeIds } },
      req.body,
      { new: true, runValidators: true }
    );
    if (!prop) return res.status(404).json({ error: 'Not found' });
    res.json(prop);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const prop = await Property.findOne({ _id: req.params.id, userId: { $in: req.scopeIds } });
    if (!prop) return res.status(404).json({ error: 'Not found' });

    const { reassignTo } = req.body;
    if (reassignTo) {
      // Explicit reassignment: move this property's items elsewhere, keep them.
      await Item.updateMany({ propertyId: req.params.id }, { propertyId: reassignTo });
      await prop.deleteOne();
      return res.json({ message: 'Deleted' });
    }

    // Otherwise cascade: delete the property's items and everything hanging off
    // them (tasks + their completions, odometer logs, manuals, receipts).
    const items = await Item.find({ propertyId: req.params.id }).select('_id');
    const itemIds = items.map((i) => i._id);
    if (itemIds.length) {
      const tasks = await MaintenanceTask.find({ itemId: { $in: itemIds } }).select('_id');
      const taskIds = tasks.map((t) => t._id);
      await Promise.all([
        taskIds.length ? TaskCompletion.deleteMany({ taskId: { $in: taskIds } }) : null,
        MaintenanceTask.deleteMany({ itemId: { $in: itemIds } }),
        OdometerLog.deleteMany({ itemId: { $in: itemIds } }),
        Manual.deleteMany({ itemId: { $in: itemIds } }),
        Receipt.deleteMany({ itemId: { $in: itemIds } }),
        Item.deleteMany({ _id: { $in: itemIds } }),
      ]);
    }
    await prop.deleteOne();
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
