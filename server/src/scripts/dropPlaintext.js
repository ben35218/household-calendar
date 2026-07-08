/**
 * §9 PLAINTEXT DROP — the point of no return. For one household, verify readiness,
 * confirm every content record already carries ciphertext, then null the plaintext
 * content columns and set `Household.e2eeActive = true`. After this the server can
 * no longer read the household's content — the E2EE boundary is live.
 *
 *   node src/scripts/dropPlaintext.js <householdId>            # DRY RUN (default)
 *   node src/scripts/dropPlaintext.js <householdId> --commit   # perform the drop
 *
 * Dry run is read-only: it prints readiness + how many records would be nulled.
 * --commit is IRREVERSIBLE. Run the dry run first, and verify on-device that an
 * unlocked member can still read everything (see docs/E2EE-SYNC-PLAN.md §9.2)
 * BEFORE committing — nothing here has been exercised with the flag on.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const connectDB = require('../db');
const mongoose = require('mongoose');
const Household = require('../models/Household');
const User = require('../models/User');
const HouseholdKeyEnvelope = require('../models/HouseholdKeyEnvelope');
const AuditLog = require('../models/AuditLog');
const { computeReadiness, dropUnsetFor } = require('../services/dropReadiness');
const { sharedTripIds, excludeSharedFilter } = require('../services/tripSharing');

// Content collections scoped by userId. Household is handled separately (by _id).
const MODELS = {
  CalendarEvent:  require('../models/CalendarEvent'),
  Person:         require('../models/Person'),
  MaintenanceTask:require('../models/MaintenanceTask'),
  Chore:          require('../models/Chore'),
  Recipe:         require('../models/Recipe'),
  Trip:           require('../models/Trip'),
  TripItem:       require('../models/TripItem'),
  Item:           require('../models/Item'),
  FoodInventory:  require('../models/FoodInventory'),
};

async function run() {
  const householdId = process.argv[2];
  const commit = process.argv.includes('--commit');
  if (!householdId || !mongoose.isValidObjectId(householdId)) {
    console.error('usage: node src/scripts/dropPlaintext.js <householdId> [--commit]');
    process.exit(1);
  }

  await connectDB();
  const hh = await Household.findById(householdId);
  if (!hh) { console.error('No such household'); process.exit(1); }
  if (hh.e2eeActive) { console.log('Household is already E2EE-active. Nothing to do.'); process.exit(0); }

  const members = await User.find({ householdId: hh._id });
  const memberIds = members.map((m) => m._id);
  const envelopes = await HouseholdKeyEnvelope.find({ householdId: hh._id });

  console.log(`\nHousehold "${hh.name}" (${hh._id}) — HDK v${hh.currentKeyVersion}, ${members.length} member(s)\n`);

  // 1) Readiness gate.
  const readiness = computeReadiness({ members, envelopes, currentKeyVersion: hh.currentKeyVersion });
  console.log(`Readiness: ${readiness.ready ? 'READY' : 'NOT READY'}`);
  readiness.reasons.forEach((r) => console.log('  - ' + r));
  if (!readiness.ready) { console.log('\nAborting — resolve the above first.'); process.exit(1); }

  // 2) Straggler check — every content record must already carry ciphertext,
  // EXCEPT shared trips (and their items): those stay plaintext on purpose so
  // cross-household collaborators can read them, so they're exempt here and in
  // the commit below. See services/tripSharing.js / §6.
  let stragglers = 0;
  const scope = { userId: { $in: memberIds } };
  const sharedIds = await sharedTripIds(MODELS.Trip, memberIds);
  if (sharedIds.length) console.log(`  (${sharedIds.length} shared trip(s) + their items are plaintext-exempt)\n`);
  for (const [name, Model] of Object.entries(MODELS)) {
    const exempt = excludeSharedFilter(name, sharedIds);
    const [sealed, missing] = await Promise.all([
      Model.countDocuments({ ...scope, enc: { $exists: true } }),
      Model.countDocuments({ ...scope, ...exempt, enc: { $exists: false } }),
    ]);
    stragglers += missing;
    console.log(`  ${name.padEnd(16)} ${sealed} sealed, ${missing} missing enc`);
  }
  const hhLocationUnsealed = !!(hh.homeAddress && !hh.enc);
  console.log(`  ${'Household'.padEnd(16)} location ${hh.enc ? 'sealed' : (hh.homeAddress ? 'NOT sealed' : 'none set')}`);
  if (hhLocationUnsealed) stragglers++;

  if (stragglers > 0) {
    console.log(`\n${stragglers} record(s) still lack ciphertext. The owner's device must open + re-save them (or run the client re-encrypt pass) before the drop. Aborting.`);
    process.exit(1);
  }

  if (!commit) {
    console.log('\nDRY RUN — nothing changed. Re-run with --commit to null the plaintext content columns and set e2eeActive.');
    console.log('IMPORTANT: verify on-device that an unlocked member reads everything first (§9.2). --commit is irreversible.');
    process.exit(0);
  }

  // 3) COMMIT — null plaintext content only where ciphertext exists.
  console.log('\nCOMMITTING drop…');
  for (const [name, Model] of Object.entries(MODELS)) {
    const unset = dropUnsetFor(name);
    if (!unset) continue;
    // Never null a shared trip's (or its items') plaintext — collaborators outside
    // the household read it and hold no HDK.
    const exempt = excludeSharedFilter(name, sharedIds);
    const res = await Model.updateMany({ ...scope, ...exempt, enc: { $exists: true } }, { $unset: unset });
    console.log(`  ${name.padEnd(16)} nulled ${res.modifiedCount}`);
  }
  if (hh.enc) await Household.updateOne({ _id: hh._id }, { $unset: dropUnsetFor('Household') ? { homeAddress: '', lat: '', lon: '' } : {} });
  await Household.updateOne({ _id: hh._id }, { $set: { e2eeActive: true } });
  await AuditLog.create({ householdId: hh._id, event: 'plaintext_dropped', meta: { memberCount: members.length, keyVersion: hh.currentKeyVersion } });

  console.log('\nDONE. e2eeActive = true; plaintext content nulled. The E2EE boundary is now live for this household.');
  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
