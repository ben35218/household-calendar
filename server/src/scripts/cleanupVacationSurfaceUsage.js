/**
 * Cleans up stale "vacation" assistant-surface data left behind when the Trips
 * assistant surface was renamed from `vacation` to `trips`.
 *
 * Two pieces of leftover data:
 *   1. Household analytics: the per-week chat breakdown counter
 *      `usage.<period>.breakdown.chat.vacation` (and the same under
 *      `usageBaseline`). These are $unset — the parent `usage.<period>.chat`
 *      total is left untouched, so only the orphaned sub-slice is dropped
 *      (avoids a confusing vacation-vs-trips split in the admin analytics).
 *   2. ContentReport moderation records tagged `surface: 'vacation'` are
 *      relabelled to `surface: 'trips'` (the report itself is preserved).
 *
 * Dry-run (default, no writes):
 *   node src/scripts/cleanupVacationSurfaceUsage.js
 *
 * Apply:
 *   node src/scripts/cleanupVacationSurfaceUsage.js --apply
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const connectDB = require('../db');
const Household = require('../models/Household');
const ContentReport = require('../models/ContentReport');

const DRY_RUN = !process.argv.includes('--apply');

// Collect the dotted paths to $unset for one usage-like map (keyed by period).
function staleVacationPaths(field, map) {
  const paths = [];
  if (!map || typeof map !== 'object') return paths;
  for (const [period, entry] of Object.entries(map)) {
    if (entry?.breakdown?.chat && 'vacation' in entry.breakdown.chat) {
      paths.push(`${field}.${period}.breakdown.chat.vacation`);
    }
  }
  return paths;
}

async function run() {
  await connectDB();
  console.log(`\n${DRY_RUN ? 'DRY RUN (no writes)' : '⚠️  APPLYING CLEANUP'}\n`);

  // ── 1. Household usage breakdown counters ──────────────────────────────────
  const households = await Household.find()
    .select('_id usage usageBaseline')
    .lean();

  let householdsTouched = 0;
  let countersRemoved = 0;
  for (const h of households) {
    const paths = [
      ...staleVacationPaths('usage', h.usage),
      ...staleVacationPaths('usageBaseline', h.usageBaseline),
    ];
    if (!paths.length) continue;
    householdsTouched++;
    countersRemoved += paths.length;
    console.log(`  ${DRY_RUN ? '[would unset]' : '[unsetting]'} household ${h._id}: ${paths.join(', ')}`);
    if (!DRY_RUN) {
      const unset = Object.fromEntries(paths.map((p) => [p, '']));
      await Household.updateOne({ _id: h._id }, { $unset: unset });
    }
  }
  console.log(
    `\nHousehold analytics: ${countersRemoved} stale vacation counter(s) across ${householdsTouched} household(s).`
  );

  // ── 2. ContentReport surface relabel ───────────────────────────────────────
  const reportCount = await ContentReport.countDocuments({ surface: 'vacation' });
  console.log(`\nContentReports tagged surface="vacation": ${reportCount}`);
  if (reportCount && !DRY_RUN) {
    const res = await ContentReport.updateMany({ surface: 'vacation' }, { $set: { surface: 'trips' } });
    console.log(`Relabelled ${res.modifiedCount} report(s) to surface="trips".`);
  }

  if (DRY_RUN) console.log('\nRe-run with --apply to commit the cleanup.');
  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
