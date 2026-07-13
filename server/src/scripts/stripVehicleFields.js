/**
 * One-time cleanup: removes the retired vehicle preset fields
 * ("Vehicle Type", "Condition", "Colour") from every item's customFields.
 *
 * These were dropped from the vehicle item form (lib/itemTypes.ts). Existing
 * items keep the saved values in customFields, where they now surface as loose
 * "additional fields". This strips them so they disappear entirely.
 *
 * Note: for E2EE items whose plaintext customFields have already been dropped,
 * the values live only in client-held ciphertext and are re-sealed on next edit;
 * this plaintext $pull can't reach those. Plaintext is still authoritative today.
 *
 * Dry-run (default, no writes):
 *   node src/scripts/stripVehicleFields.js
 *
 * Apply:
 *   node src/scripts/stripVehicleFields.js --apply
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const connectDB = require('../db');
const Item = require('../models/Item');

const KEYS = ['Vehicle Type', 'Condition', 'Colour'];
const DRY_RUN = !process.argv.includes('--apply');

async function run() {
  await connectDB();

  const affected = await Item.countDocuments({ 'customFields.key': { $in: KEYS } });
  console.log(`${affected} item(s) have one of ${KEYS.map(k => `"${k}"`).join(', ')} in customFields.`);

  if (DRY_RUN) {
    console.log('Dry run — no changes written. Re-run with --apply to strip them.');
    process.exit(0);
  }

  const res = await Item.updateMany(
    { 'customFields.key': { $in: KEYS } },
    { $pull: { customFields: { key: { $in: KEYS } } } }
  );
  console.log(`Done. Modified ${res.modifiedCount} item(s).`);
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
