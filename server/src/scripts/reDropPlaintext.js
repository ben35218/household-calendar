/**
 * RE-SEAL + RE-DROP BACKFILL (Signal-parity pass-2 insert) — the null half.
 *
 * A household dropped under an OLDER DROP_FIELDS version (dropFieldsVersion <
 * current) still carries the columns ADDED since (v2: MaintenanceTask/Chore
 * nextDueDate, OdometerLog reading/notes, RecipeSchedule notes, Category name,
 * Household name) in PLAINTEXT — the one-time drop never re-runs, and the old
 * `enc` blobs predate those fields. This script nulls those columns for an
 * already-e2eeActive household.
 *
 *   node src/scripts/reDropPlaintext.js <householdId>            # DRY RUN
 *   node src/scripts/reDropPlaintext.js <householdId> --commit   # perform it
 *
 * SAFETY — it NEVER nulls before the re-seal-all client pass has folded the new
 * fields into every record's ciphertext. That pass ends by stamping
 * `Household.dropFieldsVersion = DROP_FIELDS_VERSION` (POST /e2ee/reseal-complete,
 * only on zero failures). This script REFUSES to commit unless that stamp is
 * current, and only nulls columns where `enc` exists. Run order for a stale
 * household:
 *   1. Open the app on the owner's UNLOCKED device → it runs the re-seal-all
 *      pass automatically (dropMigration.reencryptForReDrop) and calls
 *      /e2ee/reseal-complete when done.
 *   2. Dry-run this script; confirm it reports READY (dropFieldsVersion current)
 *      and the counts look right.
 *   3. Re-run with --commit.
 *
 * The logic lives in `reDropPlaintext()` (exported, integration-tested); this
 * file doubles as the thin CLI.
 */
const mongoose = require('mongoose');
const Household = require('../models/Household');
const AuditLog = require('../models/AuditLog');
const { dropUnsetFor, DROP_FIELDS_VERSION } = require('../services/dropReadiness');
const { AUTHOR_HIDDEN } = require('../services/e2eePolicy');
const User = require('../models/User');
const { MODELS } = require('./dropPlaintext');

// Re-run the drop's null step on an already-active household to catch up the
// DROP_FIELDS columns added since it was first dropped. Returns { status, ... }:
//   not-active | reseal-pending | already-current | dry-run | committed
async function reDropPlaintext(householdId, { commit = false, log = () => {} } = {}) {
  const hh = await Household.findById(householdId);
  if (!hh) throw new Error('No such household');
  if (!hh.e2eeActive) {
    log('Household is not e2eeActive — run dropPlaintext.js (the first-time drop) instead.');
    return { status: 'not-active' };
  }

  const current = DROP_FIELDS_VERSION;
  const stamped = hh.dropFieldsVersion || 0;
  log(`\nHousehold "${hh.name || hh._id}" (${hh._id}) — dropFieldsVersion ${stamped}, current ${current}\n`);

  // The interlock: committing before the re-seal-all client pass confirms would
  // null plaintext the old enc blobs don't contain → data loss. A committed
  // drop stamps dropFieldsVersion, and /e2ee/reseal-complete bumps it after the
  // client re-seals every record. Refuse --commit until it's current.
  if (stamped < current && commit) {
    log(`Re-seal NOT confirmed: dropFieldsVersion ${stamped} < ${current}.`);
    log('Open the app on the owner\'s unlocked device to run the re-seal-all pass');
    log('(it POSTs /e2ee/reseal-complete when done), THEN re-run this script with --commit.');
    return { status: 'reseal-pending', dropFieldsVersion: stamped };
  }
  if (stamped < current) {
    log('(Dry run — --commit is refused until the re-seal-all pass stamps the current version.)');
  }

  const members = await User.find({ householdId: hh._id }, '_id').lean();
  const memberIds = members.map((m) => m._id);
  const scope = { userId: { $in: memberIds } };

  // Preview / commit the null of each collection's content columns, only where
  // ciphertext exists (a re-sealed record). Signal-parity D1/D2: outside-shared
  // calendar events AND shared trips/items are NO LONGER exempt — a resource-
  // sealed record (CalendarKey/TripKey) carries `enc`, so its plaintext is nulled
  // like any sealed record (collaborators read it via the resource key), while an
  // un-migrated plaintext-lane record (no `enc`) is skipped by the `enc exists`
  // gate.
  const affected = {};
  let totalTouched = 0;
  for (const [name, Model] of Object.entries(MODELS)) {
    const unset = dropUnsetFor(name);
    if (!unset) continue;
    // Rows that still hold ANY of the plaintext columns, with ciphertext present.
    const stillPlaintext = Object.keys(unset).map((f) => ({ [f]: { $nin: [null, undefined] } }));
    const filter = { ...scope, enc: { $exists: true }, $or: stillPlaintext };
    if (commit) {
      const res = await Model.updateMany(filter, { $unset: unset });
      affected[name] = res.modifiedCount;
      log(`  ${name.padEnd(16)} nulled ${res.modifiedCount}`);
    } else {
      affected[name] = await Model.countDocuments(filter);
      log(`  ${name.padEnd(16)} ${affected[name]} still plaintext`);
    }
    totalTouched += affected[name];
  }

  // Signal-parity C4: stamp householdId (so scoping survives the author null),
  // then null the member-granular plaintext `userId` on HDK-sealed records of the
  // author-hidden collections. The re-seal-all pass has folded the author into
  // `enc` before we reach here (the version interlock above). A resource-sealed
  // (`enc.ks`) record keeps its userId (the §C4 routing deviation).
  for (const [name, Model] of Object.entries(MODELS)) {
    if (!AUTHOR_HIDDEN.has(name)) continue;
    const authorFilter = { ...scope, enc: { $exists: true }, 'enc.ks': { $exists: false }, userId: { $nin: [null, undefined] } };
    if (commit) {
      await Model.updateMany({ ...authorFilter, householdId: { $exists: false } }, { $set: { householdId: hh._id } });
      const res = await Model.updateMany(
        { householdId: hh._id, enc: { $exists: true }, 'enc.ks': { $exists: false }, userId: { $nin: [null, undefined] } },
        { $unset: { userId: '' } },
      );
      affected[`${name}:author`] = res.modifiedCount;
      if (res.modifiedCount) log(`  ${name.padEnd(16)} author-nulled ${res.modifiedCount}`);
      totalTouched += res.modifiedCount;
    } else {
      const n = await Model.countDocuments(authorFilter);
      if (n) { affected[`${name}:author`] = n; log(`  ${name.padEnd(16)} ${n} author still plaintext`); totalTouched += n; }
    }
  }

  // Household name/homeAddress (+ derived geocoords) — nulled only once the
  // sealed settings blob exists to serve them (C2).
  const hhBlobSealed = !!hh.enc?.ct;
  const hhHasPlaintext = !!(hh.name || hh.homeAddress);
  if (commit && hhBlobSealed && hhHasPlaintext) {
    await Household.updateOne({ _id: hh._id }, { $unset: { name: '', homeAddress: '', lat: '', lon: '' } });
    log(`  ${'Household'.padEnd(16)} nulled name/homeAddress`);
    totalTouched += 1;
  } else {
    if (hhHasPlaintext && hhBlobSealed) totalTouched += 1;
    log(`  ${'Household'.padEnd(16)} name/homeAddress ${hhHasPlaintext ? (hhBlobSealed ? 'still plaintext' : 'NOT sealed (blocked)') : 'none set'}`);
  }

  if (!commit) {
    log('\nDRY RUN — nothing changed.');
    return { status: 'dry-run', affected, dropFieldsVersion: stamped, currentVersion: current };
  }
  if (totalTouched === 0) {
    log('\nNothing still in plaintext — the backfill has already run for this household.');
    return { status: 'already-current', affected };
  }
  await AuditLog.create({ householdId: hh._id, event: 'plaintext_redropped', meta: { toVersion: current } });
  log('\nDONE. The newer DROP_FIELDS columns are now nulled where ciphertext exists.');
  return { status: 'committed', affected };
}

async function runCli() {
  require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
  const connectDB = require('../db');
  const householdId = process.argv[2];
  const commit = process.argv.includes('--commit');
  if (!householdId || !mongoose.isValidObjectId(householdId)) {
    console.error('usage: node src/scripts/reDropPlaintext.js <householdId> [--commit]');
    process.exit(1);
  }
  await connectDB();
  try {
    const result = await reDropPlaintext(householdId, { commit, log: console.log });
    process.exit(['not-active', 'reseal-pending'].includes(result.status) ? 1 : 0);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

if (require.main === module) {
  runCli().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { reDropPlaintext };
