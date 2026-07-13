/**
 * Deletes maintenance tasks that reference an item which no longer exists
 * (dangling itemId — e.g. left behind when an item was deleted without
 * cascading its tasks). Their TaskCompletions are removed too.
 *
 * This is distinct from linkOrphanedTasks.js, which RE-LINKS tasks that have no
 * itemId at all. Here we only touch tasks whose itemId points at a missing item;
 * tasks with itemId = null are left untouched.
 *
 * Dry-run (default, no writes):
 *   node src/scripts/cleanupOrphanedTasks.js
 *
 * Apply:
 *   node src/scripts/cleanupOrphanedTasks.js --apply
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const connectDB = require('../db');
const MaintenanceTask = require('../models/MaintenanceTask');
const TaskCompletion = require('../models/TaskCompletion');
const Item = require('../models/Item');

const DRY_RUN = !process.argv.includes('--apply');

async function run() {
  await connectDB();

  // Every existing item id (as a string set for O(1) membership checks).
  const itemIds = new Set((await Item.find().select('_id').lean()).map((i) => String(i._id)));
  console.log(`\n${itemIds.size} item(s) in the database — ${DRY_RUN ? 'DRY RUN (no writes)' : '⚠️  APPLYING DELETES'}\n`);

  // Tasks that DO carry an itemId but point at something that's gone.
  const linkedTasks = await MaintenanceTask.find({ itemId: { $nin: [null, undefined] } })
    .select('_id title itemId')
    .lean();
  const orphans = linkedTasks.filter((t) => !itemIds.has(String(t.itemId)));

  if (!orphans.length) {
    console.log('No orphaned tasks — nothing to clean up.');
    return process.exit(0);
  }

  console.log(`${orphans.length} orphaned task(s) referencing a missing item:`);
  for (const t of orphans) {
    console.log(`  ${DRY_RUN ? '[would delete]' : '[deleting]'} "${t.title}" (task ${t._id} → missing item ${t.itemId})`);
  }

  const orphanIds = orphans.map((t) => t._id);
  const completionCount = await TaskCompletion.countDocuments({ taskId: { $in: orphanIds } });
  console.log(`\n${completionCount} related task completion(s) will ${DRY_RUN ? 'also be removed' : 'be removed'}.`);

  if (!DRY_RUN) {
    const [tRes, cRes] = await Promise.all([
      MaintenanceTask.deleteMany({ _id: { $in: orphanIds } }),
      TaskCompletion.deleteMany({ taskId: { $in: orphanIds } }),
    ]);
    console.log(`\nDeleted ${tRes.deletedCount} task(s) and ${cRes.deletedCount} completion(s).`);
  } else {
    console.log('\nRe-run with --apply to commit the deletes.');
  }

  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
