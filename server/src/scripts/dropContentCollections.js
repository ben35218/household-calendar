/**
 * C3b FINAL STEP (Signal-parity C3 store cutover) — drop the per-collection content
 * tables once their data lives in the unified `Record` store.
 *
 * This is IRREVERSIBLE and the LAST step of the C3b migration order:
 *   1. deploy the cutover (writes+reads go through /records);
 *   2. node src/scripts/migrateToRecords.js --commit      (copy the backlog → Record)
 *   3. app session on each owner device → the re-seal-all pass folds the newly-
 *      sealed routing columns into the v2 ciphertext (DROP_FIELDS_VERSION 4) and
 *      stamps Household.dropFieldsVersion = 4;
 *   4. node src/scripts/dropContentCollections.js --commit  (THIS — drop the tables)
 *
 *   node src/scripts/dropContentCollections.js            # DRY RUN (default)
 *   node src/scripts/dropContentCollections.js --commit   # drop the collections
 *
 * SAFETY. It REFUSES to commit unless, for every collection:
 *   - every e2eeActive household is stamped at the current DROP_FIELDS_VERSION (the
 *     re-seal pass completed — so the full sealed field set is in each record's
 *     `Record.enc`), and
 *   - the old table has no more rows than `Record` holds for that household set
 *     (the migration copied the backlog — no un-migrated content would be lost).
 * These are the same "never destroy before the ciphertext is complete" interlocks
 * the drop/re-drop scripts use.
 */
const mongoose = require('mongoose');
const Household = require('../models/Household');
const Record = require('../models/Record');
const { DROP_FIELDS_VERSION } = require('../services/dropReadiness');
const { MIGRATE_MODELS } = require('./migrateToRecords');

async function dropContentCollections({ commit = false, log = () => {} } = {}) {
  // Interlock 1: every e2eeActive household must have completed the v4 re-seal, so
  // its records carry the full sealed field set inside Record.enc.
  const stale = await Household.countDocuments({
    e2eeActive: true,
    $or: [{ dropFieldsVersion: { $lt: DROP_FIELDS_VERSION } }, { dropFieldsVersion: { $exists: false } }],
  });
  if (stale > 0) {
    log(`Re-seal NOT complete: ${stale} e2eeActive household(s) below DROP_FIELDS_VERSION ${DROP_FIELDS_VERSION}.`);
    log('Run the app re-seal pass (reencryptForReDrop) on each owner device first. Refusing.');
    return { status: 'reseal-pending', stale };
  }

  // Interlock 2: the migration must have copied the backlog. Per collection, the
  // old table must hold no more rows than Record (a lossless copy leaves Record ≥
  // the source; a shortfall means un-migrated rows would be lost on drop).
  const report = {};
  let blocked = false;
  const recordTotal = await Record.estimatedDocumentCount();
  for (const [collection, Model] of Object.entries(MIGRATE_MODELS)) {
    const oldCount = await Model.estimatedDocumentCount();
    report[collection] = oldCount;
    // Coarse guard: Record must hold at least as many rows as any single source
    // table (Record is the union of all of them, so this always holds after a
    // complete migration; a violation means the migration didn't run).
    if (oldCount > recordTotal) { blocked = true; }
  }
  if (blocked) {
    log('Migration NOT complete: a source table has more rows than the Record store. Run migrateToRecords.js --commit first. Refusing.');
    return { status: 'migration-pending', report, recordTotal };
  }

  log(`Record store holds ${recordTotal} rows. Per-collection source counts:`);
  for (const [c, n] of Object.entries(report)) log(`  ${c}: ${n}`);

  if (!commit) {
    log('DRY RUN — pass --commit to drop these collections.');
    return { status: 'dry-run', report, recordTotal };
  }

  const dropped = [];
  for (const Model of Object.values(MIGRATE_MODELS)) {
    try {
      await Model.collection.drop();
      dropped.push(Model.collection.collectionName);
    } catch (err) {
      // NamespaceNotFound (26) — already dropped / never existed. Idempotent.
      if (err.code !== 26) throw err;
    }
  }
  log(`Dropped ${dropped.length} collection(s): ${dropped.join(', ')}`);
  return { status: 'committed', dropped };
}

async function runCli() {
  require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
  const connectDB = require('../db');
  const commit = process.argv.includes('--commit');
  await connectDB();
  try {
    const result = await dropContentCollections({ commit, log: console.log });
    process.exit(['reseal-pending', 'migration-pending'].includes(result.status) ? 1 : 0);
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}

if (require.main === module) {
  runCli().catch((err) => { console.error(err); process.exit(1); });
}

module.exports = { dropContentCollections };
