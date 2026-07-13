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
 * BEFORE committing.
 *
 * The logic lives in `dropPlaintext()` (exported, integration-tested over an
 * in-memory MongoDB); this file doubles as the thin CLI around it.
 */
const mongoose = require('mongoose');
const Household = require('../models/Household');
const User = require('../models/User');
const HouseholdKeyEnvelope = require('../models/HouseholdKeyEnvelope');
const AuditLog = require('../models/AuditLog');
const { computeReadiness, dropUnsetFor } = require('../services/dropReadiness');
const { sharedTripIds, excludeSharedFilter } = require('../services/tripSharing');
const { outsideSharedCalendarKeys, excludeOutsideCalendarFilter } = require('../services/calendarSharing');
const CustomCalendar = require('../models/CustomCalendar');

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

// Run the drop (or its dry run) against the current mongoose connection.
// Returns { status, ... } instead of exiting so tests can assert on it:
//   already-active | not-ready | stragglers | dry-run | committed
async function dropPlaintext(householdId, { commit = false, log = () => {} } = {}) {
  const hh = await Household.findById(householdId);
  if (!hh) throw new Error('No such household');
  if (hh.e2eeActive) {
    log('Household is already E2EE-active. Nothing to do.');
    return { status: 'already-active' };
  }

  const members = await User.find({ householdId: hh._id });
  const memberIds = members.map((m) => m._id);
  const envelopes = await HouseholdKeyEnvelope.find({ householdId: hh._id });

  log(`\nHousehold "${hh.name}" (${hh._id}) — HDK v${hh.currentKeyVersion}, ${members.length} member(s)\n`);

  // 1) Readiness gate.
  const readiness = computeReadiness({
    members,
    envelopes,
    currentKeyVersion: hh.currentKeyVersion,
    minAppVersion: process.env.E2EE_MIN_APP_VERSION || null,
  });
  log(`Readiness: ${readiness.ready ? 'READY' : 'NOT READY'}`);
  readiness.reasons.forEach((r) => log('  - ' + r));
  if (!readiness.ready) {
    log('\nAborting — resolve the above first.');
    return { status: 'not-ready', readiness };
  }

  // 2) Straggler check — every content record must already carry ciphertext,
  // EXCEPT shared trips (and their items): those stay plaintext on purpose so
  // cross-household collaborators can read them, so they're exempt here and in
  // the commit below. See services/tripSharing.js / §6.
  let stragglers = 0;
  const scope = { userId: { $in: memberIds } };
  const sharedIds = await sharedTripIds(MODELS.Trip, memberIds);
  if (sharedIds.length) log(`  (${sharedIds.length} shared trip(s) + their items are plaintext-exempt)\n`);
  // Events on outside-shared custom calendars are likewise plaintext-exempt
  // (§9.5) — collaborators outside the household hold no HDK.
  const sharedCalKeys = await outsideSharedCalendarKeys(CustomCalendar, memberIds);
  if (sharedCalKeys.length) log(`  (events on ${sharedCalKeys.length} outside-shared calendar(s) are plaintext-exempt)\n`);
  for (const [name, Model] of Object.entries(MODELS)) {
    const exempt = { ...excludeSharedFilter(name, sharedIds), ...excludeOutsideCalendarFilter(name, sharedCalKeys) };
    const [sealed, missing] = await Promise.all([
      Model.countDocuments({ ...scope, enc: { $exists: true } }),
      Model.countDocuments({ ...scope, ...exempt, enc: { $exists: false } }),
    ]);
    stragglers += missing;
    log(`  ${name.padEnd(16)} ${sealed} sealed, ${missing} missing enc`);
  }
  const hhLocationUnsealed = !!(hh.homeAddress && !hh.enc);
  log(`  ${'Household'.padEnd(16)} location ${hh.enc ? 'sealed' : (hh.homeAddress ? 'NOT sealed' : 'none set')}`);
  if (hhLocationUnsealed) stragglers++;

  if (stragglers > 0) {
    log(`\n${stragglers} record(s) still lack ciphertext. The owner's device must open + re-save them (or run the client re-encrypt pass) before the drop. Aborting.`);
    return { status: 'stragglers', stragglers, readiness };
  }

  if (!commit) {
    log('\nDRY RUN — nothing changed. Re-run with --commit to null the plaintext content columns and set e2eeActive.');
    log('IMPORTANT: verify on-device that an unlocked member reads everything first (§9.2). --commit is irreversible.');
    return { status: 'dry-run', readiness };
  }

  // 3) COMMIT — null plaintext content only where ciphertext exists.
  log('\nCOMMITTING drop…');
  const nulled = {};
  for (const [name, Model] of Object.entries(MODELS)) {
    const unset = dropUnsetFor(name);
    if (!unset) continue;
    // Never null a shared trip's (or its items') plaintext, nor an event's on
    // an outside-shared calendar — collaborators outside the household read
    // them and hold no HDK.
    const exempt = { ...excludeSharedFilter(name, sharedIds), ...excludeOutsideCalendarFilter(name, sharedCalKeys) };
    const res = await Model.updateMany({ ...scope, ...exempt, enc: { $exists: true } }, { $unset: unset });
    nulled[name] = res.modifiedCount;
    log(`  ${name.padEnd(16)} nulled ${res.modifiedCount}`);
  }
  // Household location: lat/lon derive from homeAddress, so they go with it.
  if (hh.enc) await Household.updateOne({ _id: hh._id }, { $unset: { homeAddress: '', lat: '', lon: '' } });
  await Household.updateOne({ _id: hh._id }, { $set: { e2eeActive: true } });
  await AuditLog.create({ householdId: hh._id, event: 'plaintext_dropped', meta: { memberCount: members.length, keyVersion: hh.currentKeyVersion } });

  log('\nDONE. e2eeActive = true; plaintext content nulled. The E2EE boundary is now live for this household.');
  return { status: 'committed', nulled, readiness };
}

async function runCli() {
  require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
  const connectDB = require('../db');
  const householdId = process.argv[2];
  const commit = process.argv.includes('--commit');
  if (!householdId || !mongoose.isValidObjectId(householdId)) {
    console.error('usage: node src/scripts/dropPlaintext.js <householdId> [--commit]');
    process.exit(1);
  }
  await connectDB();
  try {
    const result = await dropPlaintext(householdId, { commit, log: console.log });
    process.exit(['not-ready', 'stragglers'].includes(result.status) ? 1 : 0);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

if (require.main === module) {
  runCli().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { dropPlaintext, MODELS };
