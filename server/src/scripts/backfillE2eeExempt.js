/**
 * One-off rollout migration for MANDATORY E2EE: grandfather every household that
 * exists *now* as e2eeExempt = true, so the new mandate applies only to signups
 * created after this runs. New households default e2eeExempt = false (required).
 *
 *   node src/scripts/backfillE2eeExempt.js          # DRY RUN (counts only)
 *   node src/scripts/backfillE2eeExempt.js --commit # set e2eeExempt=true on all existing
 *
 * Idempotent: only touches households not already exempt. Run ONCE at the deploy
 * that turns on enforcement.
 */
const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const connectDB = require('../db');
const Household = require('../models/Household');

async function run({ commit = false, log = console.log } = {}) {
  const total = await Household.countDocuments({});
  const pending = await Household.countDocuments({ e2eeExempt: { $ne: true } });
  log(`Households: ${total} total, ${pending} not yet exempt.`);
  if (!commit) {
    log('DRY RUN — re-run with --commit to grandfather the above as e2eeExempt=true.');
    return { total, pending, committed: 0 };
  }
  const res = await Household.updateMany({ e2eeExempt: { $ne: true } }, { $set: { e2eeExempt: true } });
  log(`Grandfathered ${res.modifiedCount} household(s) as e2eeExempt=true.`);
  return { total, pending, committed: res.modifiedCount };
}

if (require.main === module) {
  (async () => {
    await connectDB();
    try {
      await run({ commit: process.argv.includes('--commit') });
    } catch (e) { console.error(e); process.exitCode = 1; }
    await mongoose.disconnect();
  })();
}

module.exports = { run };
