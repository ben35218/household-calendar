const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const RecipeSchedule = require('../models/RecipeSchedule');
const ShoppingSession = require('../models/ShoppingSession');
const { requireAuth } = require('../middleware/auth');
const { meter } = require('../middleware/usageMeter');

const client = new Anthropic();

const router = express.Router();
router.use(requireAuth);

router.get('/', async (req, res) => {
  try {
    const { start, end } = req.query;
    const filter = { userId: { $in: req.scopeIds } };
    if (start || end) {
      filter.scheduledDate = {};
      if (start) filter.scheduledDate.$gte = new Date(start);
      if (end)   filter.scheduledDate.$lte = new Date(end);
    }
    const schedules = await RecipeSchedule.find(filter)
      .populate('recipeId')
      .sort('scheduledDate')
      .lean();
    res.json(schedules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Grocery list for a week — aggregate ingredients from all scheduled recipes
router.get('/grocery-list', async (req, res) => {
  try {
    const { weekStart } = req.query;
    if (!weekStart) return res.status(400).json({ error: 'weekStart required (YYYY-MM-DD)' });

    const start = new Date(weekStart);
    start.setHours(0, 0, 0, 0);
    const end = new Date(start);
    // A biweekly shopper's list covers the full two weeks until the next trip.
    const biweekly = ((req.household || req.user).groceryFrequency ?? 'weekly') === 'biweekly';
    end.setDate(end.getDate() + (biweekly ? 13 : 6));
    end.setHours(23, 59, 59, 999);

    const schedules = await RecipeSchedule.find({
      userId: { $in: req.scopeIds },
      scheduledDate: { $gte: start, $lte: end },
    }).populate('recipeId').sort('scheduledDate').lean();

    // Aggregate ingredients across all recipes for the week
    const ingredientMap = {};
    for (const s of schedules) {
      const recipe = s.recipeId;
      if (!recipe?.ingredients) continue;
      const multiplier = (s.servings && recipe.servings) ? s.servings / recipe.servings : 1;
      for (const ing of recipe.ingredients) {
        const key = ing.name.toLowerCase().trim();
        if (!ingredientMap[key]) {
          ingredientMap[key] = { name: ing.name, entries: [] };
        }
        ingredientMap[key].entries.push({
          recipeTitle: recipe.title,
          amount: ing.amount || '',
          unit: ing.unit || '',
          multiplier,
        });
      }
    }

    const groceryList = Object.values(ingredientMap)
      .sort((a, b) => a.name.localeCompare(b.name));

    const recipes = schedules.map(s => ({
      scheduleId: s._id,
      scheduledDate: s.scheduledDate,
      notes: s.notes,
      servings: s.servings,
      recipe: s.recipeId
        ? { _id: s.recipeId._id, title: s.recipeId.title, servings: s.recipeId.servings }
        : null,
    }));

    res.json({ weekStart: start, weekEnd: end, groceryList, recipes });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/session', async (req, res) => {
  const { weekStart } = req.query;
  if (!weekStart) return res.status(400).json({ error: 'weekStart required' });
  try {
    const session = await ShoppingSession.findOne({ userId: { $in: req.scopeIds }, weekStart }).lean();
    res.json(session?.state ?? {});
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/session', async (req, res) => {
  const { weekStart, state } = req.body;
  if (!weekStart) return res.status(400).json({ error: 'weekStart required' });
  try {
    await ShoppingSession.findOneAndUpdate(
      { userId: { $in: req.scopeIds }, weekStart },
      { $set: { state }, $setOnInsert: { userId: req.user._id } },  // $in can't seed userId on insert
      { upsert: true, new: true }
    );
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/organize-grocery-list', meter('aiHelper'), async (req, res) => {
  try {
    const { items, store, sectionOrder } = req.body; // items: [{ name, entries: [{ amount, unit, recipeTitle }] }]
    if (!items?.length) return res.status(400).json({ error: 'items required' });

    const rawList = items.map(item => {
      const amounts = item.entries
        .map(e => [e.amount, e.unit].filter(Boolean).join(' '))
        .filter(Boolean)
        .join(', ');
      return amounts ? `${item.name}: ${amounts}` : item.name;
    }).join('\n');

    const sectionConstraint = sectionOrder?.length
      ? `You MUST use exactly these section names in exactly this order: ${sectionOrder.map((s, i) => `${i + 1}. ${s}`).join(', ')}. Every item must be placed into one of these sections — use the closest match. Do not create new sections.`
      : `Use standard supermarket sections (Produce, Deli, Bakery, Meat & Seafood, Dairy, Frozen, Pantry, Other).`;

    const storeContext = store
      ? `The shopper is going to ${store}. Set "store_known" to true ONLY if you have reliable knowledge of this specific store chain's typical aisle layout. If you do, include the aisle number or name for each section. If you do NOT have reliable knowledge, set "store_known" to false and leave all aisle fields as empty strings. Do NOT guess or invent aisle numbers.`
      : `Set "store_known" to false. Leave all aisle fields as empty strings.`;

    const message = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{
        role: 'user',
        content: `Organize this grocery list. Consolidate duplicate ingredients and combine amounts where possible. ${sectionConstraint} ${storeContext} Clean up verbose descriptions.

Raw list:
${rawList}

Respond with ONLY valid JSON (no markdown):
{
  "store_known": true,
  "categories": [
    { "name": "section name", "aisle": "aisle number/name or empty string", "items": [{ "name": "ingredient", "amount": "consolidated amount or empty string" }] }
  ]
}`,
      }],
    });

    const raw = message.content[0].text;
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error('[organize-grocery-list] No JSON found in AI response:', raw);
      throw new SyntaxError('No JSON object in response');
    }
    let organized;
    try {
      organized = JSON.parse(jsonMatch[0]);
    } catch (parseErr) {
      console.error('[organize-grocery-list] JSON parse failed. stop_reason:', message.stop_reason, '\nRaw response:', raw);
      throw parseErr;
    }
    res.json(organized);
  } catch (err) {
    if (err instanceof SyntaxError) {
      return res.status(422).json({ error: 'Could not organize the list. Try again.' });
    }
    res.status(500).json({ error: err.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { recipeId, scheduledDate, servings, notes } = req.body;
    const schedule = await RecipeSchedule.create({
      userId: req.user._id,
      recipeId,
      scheduledDate: new Date(scheduledDate),
      servings,
      notes,
    });
    const populated = await RecipeSchedule.findById(schedule._id).populate('recipeId').lean();
    res.status(201).json(populated);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.get('/for-recipe/:recipeId', async (req, res) => {
  try {
    const schedules = await RecipeSchedule.find({
      userId: { $in: req.scopeIds },
      recipeId: req.params.recipeId,
    }).sort('scheduledDate').lean();
    res.json(schedules);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.put('/:id', async (req, res) => {
  try {
    const { scheduledDate, servings, notes } = req.body;
    const schedule = await RecipeSchedule.findOne({ _id: req.params.id, userId: { $in: req.scopeIds } });
    if (!schedule) return res.status(404).json({ error: 'Not found' });

    const oldDate = new Date(schedule.scheduledDate);
    const newDate = new Date(scheduledDate);
    const hh = req.household || req.user;
    const groceryShoppingDay = hh.groceryShoppingDay ?? 6;
    const biweekly = (hh.groceryFrequency ?? 'weekly') === 'biweekly';

    // Start of the shopping period containing `date` — weekly this is the most
    // recent shopping day; biweekly it also snaps to the anchor's parity so
    // both weeks of a period share one session key.
    function weekStartFor(date) {
      const d = new Date(date);
      d.setHours(0, 0, 0, 0);
      const diff = (d.getDay() - groceryShoppingDay + 7) % 7;
      d.setDate(d.getDate() - diff);
      if (biweekly && hh.groceryAnchor) {
        const a = new Date(hh.groceryAnchor);
        a.setHours(0, 0, 0, 0);
        a.setDate(a.getDate() - ((a.getDay() - groceryShoppingDay + 7) % 7));
        const weeks = Math.round((d - a) / 604800000);
        if (((weeks % 2) + 2) % 2 === 1) d.setDate(d.getDate() - 7);
      }
      return d.toISOString().slice(0, 10);
    }

    const oldWeekStart = weekStartFor(oldDate);
    const newWeekStart = weekStartFor(newDate);

    schedule.scheduledDate = newDate;
    if (servings !== undefined) schedule.servings = servings || null;
    if (notes !== undefined) schedule.notes = notes;
    await schedule.save();

    const weekChanged = oldWeekStart !== newWeekStart;
    if (weekChanged) {
      const updates = [
        ShoppingSession.updateOne(
          { userId: { $in: req.scopeIds }, weekStart: newWeekStart },
          { $unset: { 'state.organizedList': 1 } }
        ),
      ];
      // Only invalidate the old week's grocery list if the shopping day hasn't passed yet
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      if (new Date(oldWeekStart) >= today) {
        updates.push(
          ShoppingSession.updateOne(
            { userId: { $in: req.scopeIds }, weekStart: oldWeekStart },
            { $unset: { 'state.organizedList': 1 } }
          )
        );
      }
      await Promise.all(updates);
    }

    const populated = await RecipeSchedule.findById(schedule._id).populate('recipeId').lean();
    res.json({ schedule: populated, weekChanged, oldWeekStart, newWeekStart });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const schedule = await RecipeSchedule.findOneAndDelete({ _id: req.params.id, userId: { $in: req.scopeIds } });
    if (!schedule) return res.status(404).json({ error: 'Not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
