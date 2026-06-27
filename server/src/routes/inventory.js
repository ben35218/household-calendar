const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const FoodInventory = require('../models/FoodInventory');
const { requireAuth } = require('../middleware/auth');
const { meter } = require('../middleware/usageMeter');

const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads', 'receipts');
fs.mkdirSync(uploadDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || '.jpg';
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Only image files are allowed'));
  },
});

const router = express.Router();
router.use(requireAuth);

const client = new Anthropic();
const MODEL = 'claude-haiku-4-5-20251001';

function stripJsonFences(text) {
  return text.trim()
    .replace(/^```json?\s*/i, '')
    .replace(/\s*```$/i, '');
}

async function estimateExpiryDays(name, category) {
  const message = await client.messages.create({
    model: MODEL,
    max_tokens: 256,
    messages: [{
      role: 'user',
      content: `Given the food item named "${name}" in category "${category}", how many days from purchase until it typically expires under normal refrigerator or pantry storage? Return ONLY valid JSON with no markdown: { "days": N, "confidence": "high"|"medium"|"low" }`,
    }],
  });
  const parsed = JSON.parse(stripJsonFences(message.content[0].text));
  return parsed;
}

const VALID_CATEGORIES = new Set(['produce', 'dairy', 'meat', 'seafood', 'deli', 'bakery', 'frozen', 'pantry', 'beverages', 'other']);
function normalizeCategory(cat) {
  return VALID_CATEGORIES.has(cat) ? cat : 'other';
}

const RECEIPT_PROMPT = `Extract all food/grocery items from this store receipt. For each item, provide: name (clean product name, no SKU/brand clutter), quantity (amount + unit if visible, else empty string), and estimated_days_until_expiry (integer, based on typical shelf life for this product type). Return ONLY valid JSON:
{ "storeName": "store name or empty string", "purchaseDate": "YYYY-MM-DD or empty string", "items": [{ "name": "...", "quantity": "...", "category": "produce|dairy|meat|seafood|deli|bakery|frozen|pantry|beverages|other", "estimated_days_until_expiry": N }] }`;

// GET / — list items
router.get('/', async (req, res) => {
  try {
    const { status = 'active', category } = req.query;
    const query = { userId: { $in: req.scopeIds }, status };
    if (category) query.category = category;

    if (status === 'active') {
      // Auto-expire items whose expiration date has passed
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      await FoodInventory.updateMany(
        { userId: { $in: req.scopeIds }, status: 'active', expirationDate: { $lt: today } },
        { $set: { status: 'used', statusDate: new Date() } }
      );
    }

    let items;
    if (status === 'active') {
      // Sort by expirationDate asc, nulls last
      items = await FoodInventory.find(query).lean();
      items.sort((a, b) => {
        if (!a.expirationDate && !b.expirationDate) return 0;
        if (!a.expirationDate) return 1;
        if (!b.expirationDate) return -1;
        return new Date(a.expirationDate) - new Date(b.expirationDate);
      });
    } else {
      items = await FoodInventory.find(query).sort({ statusDate: -1 }).lean();
    }
    res.json(items);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST / — create item manually
router.post('/', async (req, res) => {
  try {
    const { name, quantity, category, purchaseDate, expirationDate, notes } = req.body;
    if (!name) return res.status(400).json({ error: 'name is required' });

    const purchase = purchaseDate ? new Date(purchaseDate) : new Date();
    let expiry = expirationDate ? new Date(expirationDate) : null;

    if (!expiry) {
      try {
        const estimate = await estimateExpiryDays(name, category || 'other');
        if (estimate.days && estimate.days > 0) {
          expiry = new Date(purchase.getTime() + estimate.days * 24 * 60 * 60 * 1000);
        }
      } catch (e) {
        // If AI estimate fails, continue without expiry
      }
    }

    const item = await FoodInventory.create({
      userId: req.user._id,
      name,
      quantity: quantity || '',
      category: normalizeCategory(category || 'other'),
      purchaseDate: purchase,
      expirationDate: expiry || undefined,
      notes: notes || '',
      source: 'manual',
    });
    res.status(201).json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// PUT /:id — update item
router.put('/:id', async (req, res) => {
  try {
    const { name, quantity, category, purchaseDate, expirationDate, notes } = req.body;
    const update = {};
    if (name !== undefined) update.name = name;
    if (quantity !== undefined) update.quantity = quantity;
    if (category !== undefined) update.category = category;
    if (purchaseDate !== undefined) update.purchaseDate = new Date(purchaseDate);
    if (expirationDate !== undefined) update.expirationDate = expirationDate ? new Date(expirationDate) : null;
    if (notes !== undefined) update.notes = notes;

    // If a history item's expiration date is updated to a non-expired date, restore it to active
    if (expirationDate !== undefined) {
      const current = await FoodInventory.findOne({ _id: req.params.id, userId: { $in: req.scopeIds } }).lean();
      if (current && (current.status === 'used' || current.status === 'thrown_out')) {
        const today = new Date();
        today.setUTCHours(0, 0, 0, 0);
        const newExpiry = expirationDate ? new Date(expirationDate) : null;
        if (!newExpiry || newExpiry >= today) {
          update.status = 'active';
          update.statusDate = null;
          update.wasteReason = '';
        }
      }
    }

    const item = await FoodInventory.findOneAndUpdate(
      { _id: req.params.id, userId: { $in: req.scopeIds } },
      update,
      { new: true, runValidators: true }
    );
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /:id/consume — mark used or thrown out
router.post('/:id/consume', async (req, res) => {
  try {
    const { action, wasteReason } = req.body;
    if (!['used', 'thrown_out'].includes(action)) {
      return res.status(400).json({ error: 'action must be "used" or "thrown_out"' });
    }
    const update = {
      status: action,
      statusDate: new Date(),
    };
    if (action === 'thrown_out' && wasteReason) {
      update.wasteReason = wasteReason;
    }
    const item = await FoodInventory.findOneAndUpdate(
      { _id: req.params.id, userId: { $in: req.scopeIds } },
      update,
      { new: true }
    );
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /:id
router.delete('/:id', async (req, res) => {
  try {
    const item = await FoodInventory.findOneAndDelete({ _id: req.params.id, userId: { $in: req.scopeIds } });
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /from-receipt-photo — vision extraction (no save)
router.post('/from-receipt-photo', meter('scan'), upload.single('photo'), async (req, res) => {
  const file = req.file;
  if (!file) return res.status(400).json({ error: 'photo is required' });
  try {
    const base64Image = fs.readFileSync(file.path).toString('base64');
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: [
          {
            type: 'image',
            source: { type: 'base64', media_type: file.mimetype, data: base64Image },
          },
          {
            type: 'text',
            text: RECEIPT_PROMPT,
          },
        ],
      }],
    });
    const parsed = JSON.parse(stripJsonFences(message.content[0].text));
    res.json(parsed);
  } catch (err) {
    fs.unlink(file.path, () => {});
    if (err instanceof SyntaxError) {
      return res.status(422).json({ error: 'Could not extract items from that receipt photo.' });
    }
    res.status(500).json({ error: err.message });
  } finally {
    if (file) fs.unlink(file.path, () => {});
  }
});

// POST /from-receipt-text — text extraction (no save)
router.post('/from-receipt-text', meter('scan'), async (req, res) => {
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({ error: 'text is required' });

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `${RECEIPT_PROMPT}\n\nReceipt text:\n${text}`,
      }],
    });
    const parsed = JSON.parse(stripJsonFences(message.content[0].text));
    res.json(parsed);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return res.status(422).json({ error: 'Could not extract items from that receipt text.' });
    }
    res.status(500).json({ error: err.message });
  }
});

// POST /batch — bulk create
router.post('/batch', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'items array is required' });
    }

    const docs = items.map(item => {
      const purchase = item.purchaseDate ? new Date(item.purchaseDate) : new Date();
      let expiry = null;
      if (item.estimated_days_until_expiry && item.estimated_days_until_expiry > 0) {
        expiry = new Date(purchase.getTime() + item.estimated_days_until_expiry * 24 * 60 * 60 * 1000);
      }
      return {
        userId: req.user._id,
        name: item.name,
        quantity: item.quantity || '',
        category: normalizeCategory(item.category || 'other'),
        purchaseDate: purchase,
        expirationDate: expiry || undefined,
        notes: '',
        source: item.source || 'manual',
      };
    });

    const created = await FoodInventory.insertMany(docs);
    res.status(201).json(created);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

// POST /suggest-recipes
router.post('/suggest-recipes', meter('generation'), async (req, res) => {
  try {
    const { itemNames, ingredientMode } = req.body;
    if (!Array.isArray(itemNames) || itemNames.length === 0) {
      return res.status(400).json({ error: 'itemNames array is required' });
    }

    const ingredientList = itemNames.map(n => `- ${n}`).join('\n');

    const CONSTRAINTS = {
      focus: `CONSTRAINT: Each recipe MUST prominently feature at least 2–3 ingredients from the list above as its main components. Common pantry staples (salt, pepper, cooking oil, basic spices, water) are permitted in addition to the listed ingredients, but they must not be the focus — the listed ingredients must be. Do not suggest recipes where the listed ingredients are only minor additions.`,
      included: `CONSTRAINT: Suggest a variety of recipes where at least one or two of the listed ingredients appear as meaningful supporting components — but the listed ingredients do NOT need to be the star or focus of the dish. They can play a secondary or background role (e.g. a vegetable side, a flavouring agent, an extra topping). The recipes should be diverse in style and centred on other main proteins or bases. Do not suggest recipes where the listed ingredients are entirely absent.`,
      strict: `STRICT CONSTRAINT: Every recipe you suggest MUST use ONLY ingredients from the list above. Do not include any ingredient not on this list — not even salt, oil, or spices unless they are explicitly on the list. If a recipe would require anything outside the list, do not suggest it.`,
    };
    const constraint = CONSTRAINTS[ingredientMode] ?? CONSTRAINTS.focus;

    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 2048,
      messages: [{
        role: 'user',
        content: `I have the following ingredients available:\n${ingredientList}\n\n${constraint}\n\nSuggest exactly 5 recipes. For each recipe:\n- "title": recipe name\n- "description": one sentence describing the dish\n- "time": estimated total time (e.g. "30 min")\n- "usedIngredients": array of ingredients FROM MY LIST that this recipe uses (use the exact names I provided)\n- "needsOther": array of any additional ingredients needed beyond my list (empty array if inventoryOnly)\n\nReturn ONLY valid JSON with no markdown:\n{ "recipes": [{ "title": "...", "description": "...", "time": "...", "usedIngredients": ["..."], "needsOther": ["..."] }] }`,
      }],
    });
    const parsed = JSON.parse(stripJsonFences(message.content[0].text));
    res.json(parsed);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return res.status(422).json({ error: 'Could not generate recipe suggestions.' });
    }
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
