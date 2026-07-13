/**
 * Phase 1 migration: give every existing user their own household.
 * Safe to re-run — skips users who already have a householdId.
 * Does NOT change data scoping (that's Phase 2).
 *
 *   node src/scripts/backfillHouseholds.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const connectDB = require('../db');
const User = require('../models/User');
const Household = require('../models/Household');

async function run() {
  await connectDB();
  const users = await User.find({ $or: [{ householdId: { $exists: false } }, { householdId: null }] });
  console.log(`Backfilling households for ${users.length} user(s)…`);
  for (const user of users) {
    // Reuse a household already owned by this user (e.g. from a prior partial run),
    // otherwise create one. updateOne avoids validating unrelated legacy fields.
    let household = await Household.findOne({ ownerId: user._id });
    if (!household) household = await Household.createForOwner(user._id, `${user.firstName || 'My'}'s Household`);
    await User.updateOne({ _id: user._id }, { $set: { householdId: household._id } });
    console.log(`  ✓ ${user.email || user._id} → household ${household._id}`);
  }
  console.log('Done.');
  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
