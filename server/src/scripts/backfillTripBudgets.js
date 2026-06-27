/**
 * Migrate legacy single Trip.budget → per-family householdBudgets[ownerFamily].
 * Safe to re-run (skips trips that already have an entry for the owner family).
 *
 *   node src/scripts/backfillTripBudgets.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const connectDB = require('../db');
const Trip = require('../models/Trip');
const User = require('../models/User');

async function run() {
  await connectDB();
  const trips = await Trip.find({ budget: { $ne: null } });
  console.log(`Migrating budgets for ${trips.length} trip(s)…`);
  for (const trip of trips) {
    const owner = await User.findById(trip.userId, 'householdId').lean();
    if (!owner?.householdId) { console.log(`  – ${trip.name}: no owner household, skipped`); continue; }
    const exists = (trip.householdBudgets || []).some(b => String(b.householdId) === String(owner.householdId));
    if (exists) { console.log(`  – ${trip.name}: already has owner entry`); continue; }
    trip.householdBudgets.push({
      householdId: owner.householdId,
      budget: trip.budget,
      baseCurrency: (trip.baseCurrency || 'CAD').toUpperCase(),
    });
    await trip.save();
    console.log(`  ✓ ${trip.name} → family budget ${trip.baseCurrency} ${trip.budget}`);
  }
  console.log('Done.');
  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
