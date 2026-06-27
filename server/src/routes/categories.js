const express = require('express');
const Category = require('../models/Category');
const Item = require('../models/Item');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  const { parent, topLevel } = req.query;
  const filter = { userId: { $in: req.scopeIds } };
  if (parent)            filter.parentId = parent;
  else if (topLevel === 'true') filter.parentId = null;
  const cats = await Category.find(filter).sort('sortOrder name');
  res.json(cats);
});

router.post('/', async (req, res) => {
  try {
    const { name, icon, color, sortOrder } = req.body;
    const cat = await Category.create({ userId: req.user._id, name, icon, color, sortOrder });
    res.status(201).json(cat);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const cat = await Category.findOneAndUpdate(
      { _id: req.params.id, userId: { $in: req.scopeIds } },
      req.body,
      { new: true, runValidators: true }
    );
    if (!cat) return res.status(404).json({ error: 'Not found' });
    res.json(cat);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const cat = await Category.findOneAndDelete({ _id: req.params.id, userId: { $in: req.scopeIds } });
    if (!cat) return res.status(404).json({ error: 'Not found' });
    const { reassignTo } = req.body;
    if (reassignTo) {
      await Item.updateMany({ categoryId: req.params.id }, { categoryId: reassignTo });
    } else {
      await Item.updateMany({ categoryId: req.params.id }, { $unset: { categoryId: '' } });
    }
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
