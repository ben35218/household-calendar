/**
 * One-time migration: converts the legacy free-text `location` on items into a
 * Property reference. For each non-vehicle item that still has a `location` and
 * no `propertyId`, find-or-create a Property of that name (scoped to the item's
 * owner) and set it, then clear the `location` field.
 *
 * Vehicles are skipped — they group on their own and don't belong to a property.
 *
 * Dry-run (default, no writes):
 *   node src/scripts/migrateLocationToProperty.js
 *
 * Apply:
 *   node src/scripts/migrateLocationToProperty.js --apply
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const connectDB = require('../db');
const Item = require('../models/Item');
const Property = require('../models/Property');

const DRY_RUN = !process.argv.includes('--apply');

async function run() {
  await connectDB();

  const items = await Item.find({
    type: { $ne: 'vehicle' },
    propertyId: { $in: [null, undefined] },
    location: { $nin: [null, ''] },
  }).lean();

  console.log(`${items.length} non-vehicle item(s) with a legacy location and no property.`);

  // Reuse existing properties so we don't duplicate (e.g. the default "Home").
  const cache = new Map(); // `${userId}::${name.toLowerCase()}` -> propertyId
  for (const p of await Property.find().lean()) {
    cache.set(`${p.userId}::${p.name.trim().toLowerCase()}`, p._id);
  }

  let created = 0;
  let migrated = 0;
  for (const item of items) {
    const name = (item.location || '').trim();
    if (!name) continue;
    const key = `${item.userId}::${name.toLowerCase()}`;
    let propId = cache.get(key);

    if (!propId) {
      created++;
      if (DRY_RUN) {
        console.log(`  [would create property] "${name}" (user ${item.userId})`);
        propId = 'DRYRUN';
      } else {
        propId = (await Property.create({ userId: item.userId, name }))._id;
      }
      cache.set(key, propId);
    }

    migrated++;
    if (DRY_RUN) {
      console.log(`  [would migrate] "${item.name}" → property "${name}"`);
    } else {
      await Item.updateOne({ _id: item._id }, { $set: { propertyId: propId }, $unset: { location: '' } });
    }
  }

  console.log(
    DRY_RUN
      ? `Dry run — would create ${created} property(ies) and migrate ${migrated} item(s). Re-run with --apply.`
      : `Done. Created ${created} property(ies), migrated ${migrated} item(s).`
  );
  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
