/**
 * Monetization migration: ensure every Household has a `plan` (default 'free')
 * and an empty `usage` map. New fields default at the schema level, but existing
 * documents predate them — this sets them explicitly. Safe to re-run; only
 * touches households missing the field. Also seeds the MonetizationConfig
 * singleton so the temp config page has data on first load.
 *
 *   node src/scripts/backfillHouseholdPlans.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const connectDB = require('../db');
const Household = require('../models/Household');
const MonetizationConfig = require('../models/MonetizationConfig');

async function run() {
  await connectDB();

  const res = await Household.updateMany(
    { plan: { $exists: false } },
    { $set: { plan: 'free', usage: {} } }
  );
  console.log(`Set plan/usage on ${res.modifiedCount} household(s).`);

  await MonetizationConfig.getSingleton();
  console.log('MonetizationConfig singleton ensured.');

  console.log('Done.');
  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
