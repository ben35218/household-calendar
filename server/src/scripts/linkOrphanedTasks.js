/**
 * Links maintenance tasks that have no itemId to the most appropriate item.
 *
 * Strategy per user:
 *   1. Tasks already linked → skip.
 *   2. Collect the user's items grouped by type.
 *   3. If a task's category is vehicle-adjacent and there is exactly one
 *      vehicle/equipment item → link there.
 *   4. All other orphaned tasks → link to the single structure-type item ("Home").
 *      If no structure item exists yet, one is created automatically.
 *   5. Ambiguous cases (e.g. multiple vehicle items) are reported but not touched.
 *
 * Run in DRY-RUN mode (default, no writes):
 *   node src/scripts/linkOrphanedTasks.js
 *
 * Run for real:
 *   node src/scripts/linkOrphanedTasks.js --apply
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const connectDB = require('../db');
const MaintenanceTask = require('../models/MaintenanceTask');
const Item = require('../models/Item');
const User = require('../models/User');
require('../models/Category'); // register schema for populate

const DRY_RUN = !process.argv.includes('--apply');

const VEHICLE_KEYWORDS = ['vehicle', 'car', 'truck', 'auto', 'oil', 'tire', 'engine', 'transmission', 'brake', 'fleet'];

function looksVehicle(categoryName = '') {
  const lower = categoryName.toLowerCase();
  return VEHICLE_KEYWORDS.some(k => lower.includes(k));
}

async function run() {
  await connectDB();

  const users = await User.find().lean();
  console.log(`\nChecking ${users.length} user(s) — ${DRY_RUN ? 'DRY RUN (no writes)' : '⚠️  APPLYING CHANGES'}\n`);

  let totalLinked = 0;
  let totalAmbiguous = 0;

  for (const user of users) {
    const userId = user._id;
    const label = user.email || String(userId);

    const [orphanedTasks, items] = await Promise.all([
      MaintenanceTask.find({ userId, itemId: { $in: [null, undefined] } })
        .populate('categoryId', 'name')
        .lean(),
      Item.find({ userId }).lean(),
    ]);

    if (!orphanedTasks.length) {
      console.log(`${label}: no orphaned tasks`);
      continue;
    }

    const structureItems = items.filter(i => i.type === 'structure');
    const vehicleItems   = items.filter(i => i.type === 'vehicle' || i.type === 'equipment');

    console.log(`${label}: ${orphanedTasks.length} orphaned task(s)`);
    console.log(`  Items — structure: ${structureItems.length}, vehicle/equipment: ${vehicleItems.length}`);

    const toLink = [];   // { taskId, itemId, reason }
    const ambiguous = [];

    for (const task of orphanedTasks) {
      const catName = task.categoryId?.name || '';

      if (looksVehicle(catName) && vehicleItems.length === 1) {
        toLink.push({ taskId: task._id, itemId: vehicleItems[0]._id, reason: `vehicle category "${catName}" → "${vehicleItems[0].name}"` });
      } else if (looksVehicle(catName) && vehicleItems.length > 1) {
        ambiguous.push({ task: task.title, reason: `multiple vehicle items, can't auto-assign (category: "${catName}")` });
      } else if (structureItems.length === 1) {
        toLink.push({ taskId: task._id, itemId: structureItems[0]._id, reason: `"${task.title}" → "${structureItems[0].name}"` });
      } else if (structureItems.length > 1) {
        ambiguous.push({ task: task.title, reason: `multiple structure items, can't auto-assign` });
      } else {
        // No structure item exists — queue for auto-creation
        toLink.push({ taskId: task._id, itemId: null, needsHomeItem: true, reason: `"${task.title}" → [new Home item]` });
      }
    }

    // Create a "Home" item if any tasks need it and none exists
    const needsHome = toLink.some(t => t.needsHomeItem);
    let homeItem = structureItems[0] || null;
    if (needsHome) {
      console.log(`  ${DRY_RUN ? '[would create]' : '[creating]'} structure item "Home" for user`);
      if (!DRY_RUN) {
        homeItem = await Item.create({ userId, name: 'Home', type: 'structure' });
        structureItems.push(homeItem);
      }
    }

    for (const entry of toLink) {
      const targetId = entry.needsHomeItem ? (homeItem?._id || '[pending]') : entry.itemId;
      console.log(`  ${DRY_RUN ? '[would link]' : '[linking]'} ${entry.reason}`);
      if (!DRY_RUN && targetId && targetId !== '[pending]') {
        await MaintenanceTask.findByIdAndUpdate(entry.taskId, { itemId: targetId });
      }
    }

    for (const { task, reason } of ambiguous) {
      console.log(`  [ambiguous] "${task}": ${reason}`);
    }

    totalLinked += toLink.length;
    totalAmbiguous += ambiguous.length;
    console.log();
  }

  console.log(`Done. ${DRY_RUN ? 'Would link' : 'Linked'} ${totalLinked} task(s). Ambiguous: ${totalAmbiguous}.`);
  if (DRY_RUN && totalLinked > 0) {
    console.log('\nRe-run with --apply to commit changes.');
  }

  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
