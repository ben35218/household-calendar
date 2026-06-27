const express = require('express');
const path = require('path');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

router.get('/', (req, res) => {
  try {
    const templates = require(path.resolve(__dirname, '../../../shared/seed/taskTemplates.json'));
    const { category } = req.query;
    const filtered = category ? templates.filter(t => t.defaultCategoryName === category) : templates;
    res.json(filtered);
  } catch {
    res.json([]);
  }
});

router.get('/:id', (req, res) => {
  try {
    const templates = require(path.resolve(__dirname, '../../../shared/seed/taskTemplates.json'));
    const tpl = templates.find(t => t.id === req.params.id);
    if (!tpl) return res.status(404).json({ error: 'Not found' });
    res.json(tpl);
  } catch {
    res.status(500).json({ error: 'Failed to load templates' });
  }
});

module.exports = router;
