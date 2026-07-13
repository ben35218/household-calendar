/**
 * One-time migration: splits the combined "Vehicles & Equipment" category into
 * two separate top-level categories, "Vehicles" and "Equipment".
 *
 * Per user that still has a "Vehicles & Equipment" top-level category:
 *   1. Rename it to "Vehicles" (keeping its subcategories — engine, tires, etc.).
 *   2. Create an "Equipment" top-level category (+ default equipment subs) unless
 *      one already exists.
 *   3. Reassign every `type: 'equipment'` item currently filed under the old
 *      Vehicles tree (the renamed parent or one of its subcategories) to the new
 *      "Equipment" category — vehicles stay under "Vehicles".
 *
 * Idempotent: re-running skips users already split (no "Vehicles & Equipment"
 * category left) and reuses an existing "Equipment" category.
 *
 * Dry-run (default, no writes):
 *   node src/scripts/splitVehiclesEquipmentCategory.js
 *
 * Apply:
 *   node src/scripts/splitVehiclesEquipmentCategory.js --apply
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const connectDB = require('../db');
const Category = require('../models/Category');
const Item = require('../models/Item');

const OLD_NAME = 'Vehicles & Equipment';
const VEHICLES_NAME = 'Vehicles';
const EQUIPMENT_NAME = 'Equipment';

// Mirrors the "Equipment" defaults in seed.js.
const EQUIPMENT_SUBS = [
  { name: 'Engine',               sortOrder: 1 },
  { name: 'Fuel & Fluids',        sortOrder: 2 },
  { name: 'Filters',              sortOrder: 3 },
  { name: 'Blades & Attachments', sortOrder: 4 },
];

const DRY_RUN = !process.argv.includes('--apply');

async function run() {
  await connectDB();

  const combined = await Category.find({ name: OLD_NAME, parentId: null }).lean();
  console.log(`${combined.length} user(s) have a "${OLD_NAME}" top-level category.`);

  let renamed = 0;
  let createdEquip = 0;
  let reassigned = 0;

  for (const parent of combined) {
    const userId = parent.userId;

    // 1. Rename the combined category → "Vehicles" (keep its icon/color).
    if (DRY_RUN) {
      console.log(`  [would rename] "${OLD_NAME}" → "${VEHICLES_NAME}" (user ${userId})`);
    } else {
      await Category.updateOne({ _id: parent._id }, { $set: { name: VEHICLES_NAME } });
    }
    renamed++;

    // 2. Find-or-create the "Equipment" top-level category for this user.
    let equip = await Category.findOne({ userId, parentId: null, name: EQUIPMENT_NAME }).lean();
    if (!equip) {
      createdEquip++;
      if (DRY_RUN) {
        console.log(`  [would create] "${EQUIPMENT_NAME}" category (+${EQUIPMENT_SUBS.length} subs) for user ${userId}`);
        equip = { _id: 'DRYRUN' };
      } else {
        equip = await Category.create({
          userId, parentId: null, name: EQUIPMENT_NAME,
          icon: 'mdi-engine', color: '#FF9800', sortOrder: parent.sortOrder + 0.5,
        });
        await Category.insertMany(
          EQUIPMENT_SUBS.map((s) => ({ ...s, userId, parentId: equip._id, icon: 'mdi-circle-small', color: '#9E9E9E' }))
        );
      }
    }

    // 3. Reassign equipment items filed under the old Vehicles tree → Equipment.
    const subIds = (await Category.find({ userId, parentId: parent._id }).lean()).map((c) => c._id);
    const treeIds = [parent._id, ...subIds];
    const equipItems = await Item.find({ userId, type: 'equipment', categoryId: { $in: treeIds } }).lean();

    for (const item of equipItems) {
      reassigned++;
      if (DRY_RUN) {
        console.log(`    [would reassign] "${item.name}" → "${EQUIPMENT_NAME}"`);
      } else {
        await Item.updateOne({ _id: item._id }, { $set: { categoryId: equip._id } });
      }
    }
  }

  console.log(
    DRY_RUN
      ? `Dry run — would rename ${renamed}, create ${createdEquip} Equipment category(ies), reassign ${reassigned} item(s). Re-run with --apply.`
      : `Done. Renamed ${renamed}, created ${createdEquip} Equipment category(ies), reassigned ${reassigned} item(s).`
  );
  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
