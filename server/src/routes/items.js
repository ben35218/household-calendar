const express = require('express');
const multer = require('multer');
const Anthropic = require('@anthropic-ai/sdk');
const Item = require('../models/Item');
const Manual = require('../models/Manual');
const Receipt = require('../models/Receipt');
const { requireAuth } = require('../middleware/auth');
const { meter } = require('../middleware/usageMeter');
const { activity } = require('../middleware/activity');

const router = express.Router();
router.use(requireAuth);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith('image/')),
});

const ITEM_SCHEMA = `{
  "name": "descriptive name e.g. '2019 Honda CR-V' or 'Samsung Refrigerator Model RF28R7351SR'",
  "type": "vehicle | appliance | system | structure | equipment | other",
  "manufacturer": "brand/manufacturer name or null",
  "modelNumber": "model number or model name or null",
  "serialNumber": "VIN, serial number, or null",
  "location": "where the item is located or null",
  "notes": "any other relevant details or null",
  "customFields": [{ "key": "string", "value": "string" }]
}

Type definitions:
- vehicle: cars, trucks, tractors, ATVs, snowblowers, motorcycles, riding mowers
- appliance: fridge, washer, dryer, oven, dishwasher, microwave, water heater
- system: furnace, heat pump, A/C, septic, well, electrical panel, generator, boiler
- structure: roof, deck, barn, shed, fence, foundation, driveway, retaining wall
- equipment: chainsaw, pump, welder, pressure washer, power tools, hand tools
- other: anything else

For vehicles include relevant customFields: Year, Vehicle Type, Colour, Fuel Type, Transmission, Drive Type.
For appliances/equipment include any specs visible on labels (capacity, voltage, wattage, etc.).
Only include fields that are clearly visible or identifiable from the photo. Always provide a name.`;

router.post('/from-photo', meter('scan'), upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'photo is required' });
  try {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured' });

    const client = new Anthropic({ apiKey });
    const base64 = req.file.buffer.toString('base64');

    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      messages: [{
        role: 'user',
        content: [
          { type: 'image', source: { type: 'base64', media_type: req.file.mimetype, data: base64 } },
          {
            type: 'text',
            text: `Look at this photo and extract item details for a home maintenance tracking app.\nReturn ONLY valid JSON matching this schema (no markdown, no explanation):\n${ITEM_SCHEMA}`,
          },
        ],
      }],
    });

    const raw = response.content[0].text.trim()
      .replace(/^```json?\s*/i, '').replace(/\s*```$/i, '');
    res.json(JSON.parse(raw));
  } catch (err) {
    if (err instanceof SyntaxError) {
      return res.status(422).json({ error: 'Could not extract item details from that photo. Try adding the item manually.' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.get('/', async (req, res) => {
  try {
    const { category, search, type } = req.query;
    const filter = { userId: { $in: req.scopeIds } };
    if (category) filter.categoryId = category;
    if (type) filter.type = type;
    if (search) filter.$text = { $search: search };

    const items = await Item.find(filter)
      .populate('categoryId', 'name icon color')
      .populate('propertyId', 'name icon color')
      .sort('name');
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/', activity('itemAdded'), async (req, res) => {
  try {
    const item = await Item.create({ ...req.body, userId: req.user._id });
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/:id', async (req, res) => {
  const item = await Item.findOne({ _id: req.params.id, userId: { $in: req.scopeIds } })
    .populate('categoryId', 'name icon color')
    .populate('propertyId', 'name icon color');
  if (!item) return res.status(404).json({ error: 'Not found' });
  const [manuals, receipts] = await Promise.all([
    Manual.find({ itemId: item._id }),
    Receipt.find({ itemId: item._id }).sort('-createdAt'),
  ]);
  res.json({ ...item.toObject(), manuals, receipts });
});

router.put('/:id', async (req, res) => {
  try {
    const item = await Item.findOneAndUpdate(
      { _id: req.params.id, userId: { $in: req.scopeIds } },
      req.body,
      { new: true, runValidators: true }
    ).populate('categoryId', 'name icon color');
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const item = await Item.findOneAndDelete({ _id: req.params.id, userId: { $in: req.scopeIds } });
    if (!item) return res.status(404).json({ error: 'Not found' });
    await Promise.all([
      Manual.deleteMany({ itemId: item._id }),
      Receipt.deleteMany({ itemId: item._id }),
    ]);
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
