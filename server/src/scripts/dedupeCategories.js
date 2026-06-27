/**
 * One-off cleanup: collapse duplicate categories within each household.
 *
 * Duplicates arose because each member was seeded an identical default category
 * set at registration, and household reads aggregate categories across members.
 * Items / maintenance tasks / subcategories pointing at a duplicate are
 * repointed at the survivor before the duplicate is deleted.
 *
 *   node src/scripts/dedupeCategories.js                # all households
 *   node src/scripts/dedupeCategories.js <householdId>  # just one
 *   node src/scripts/dedupeCategories.js --dry-run      # report, don't mutate
 *
 * Safe to re-run (idempotent — a deduped household has nothing left to merge).
 * Note: in --dry-run the top-level counts are exact; subcategory counts are an
 * estimate (they don't account for parents being merged first).
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const connectDB = require('../db');
const User = require('../models/User');
const Household = require('../models/Household');
const { dedupeCategoriesForScope } = require('../services/dedupeCategories');

async function run() {
  await connectDB();
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const onlyId = args.find((a) => !a.startsWith('--'));

  const households = onlyId
    ? await Household.find({ _id: onlyId })
    : await Household.find({});
  console.log(`Checking ${households.length} household(s)…${dryRun ? ' (dry run — no changes)' : ''}`);

  let total = 0;
  for (const hh of households) {
    const members = await User.find({ householdId: hh._id }, '_id email').lean();
    const memberIds = members.map((m) => m._id);
    if (!memberIds.length) continue;
    // Owner's copies win; ties fall back to oldest.
    const { merged } = await dedupeCategoriesForScope(memberIds, [hh.ownerId], { dryRun });
    if (merged > 0) {
      total += merged;
      const emails = members.map((m) => m.email).join(', ');
      const verb = dryRun ? 'would merge' : 'merged';
      console.log(`  ✓ ${hh.name} (${emails}) — ${verb} ${merged} duplicate categor${merged === 1 ? 'y' : 'ies'}`);
    }
  }
  const verb = dryRun ? 'Would merge' : 'Merged';
  console.log(`Done. ${verb} ${total} duplicate categor${total === 1 ? 'y' : 'ies'} total.`);
  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
