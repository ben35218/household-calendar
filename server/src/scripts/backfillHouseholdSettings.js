/**
 * Phase 3 migration: copy each household owner's shared settings (timezone,
 * home address, grocery day, etc.) onto the Household. Safe to re-run.
 *
 *   node src/scripts/backfillHouseholdSettings.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const connectDB = require('../db');
const User = require('../models/User');
const Household = require('../models/Household');

const SHARED = ['timezone', 'homeAddress', 'lat', 'lon', 'groceryShoppingDay', 'grocerySections', 'reminderLeadDays'];

async function run() {
  await connectDB();
  const households = await Household.find();
  console.log(`Backfilling settings for ${households.length} household(s)…`);
  for (const hh of households) {
    // Prefer the owner's settings; fall back to any member's.
    const owner = await User.findById(hh.ownerId).lean()
      || await User.findOne({ householdId: hh._id }).lean();
    if (!owner) { console.log(`  – ${hh._id}: no member, skipped`); continue; }
    const update = {};
    for (const f of SHARED) if (owner[f] !== undefined) update[f] = owner[f];
    await Household.updateOne({ _id: hh._id }, { $set: update });
    console.log(`  ✓ ${hh.name} ← ${owner.email}`);
  }
  console.log('Done.');
  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
