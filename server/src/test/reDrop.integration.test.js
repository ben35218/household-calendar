// Integration test for the re-seal + re-drop backfill (Signal-parity pass-2):
// a household dropped under an OLDER DROP_FIELDS version still carries the newer
// content columns in plaintext. The client re-seal-all pass folds them into enc
// (GET /e2ee/reseal-all → POST /e2ee/seal → POST /e2ee/reseal-complete), and
// only then may scripts/reDropPlaintext.js null the plaintext.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startDb, stopDb, request, fakeEnc, registerUser } = require('./harness');

const Household = require('../models/Household');
const MaintenanceTask = require('../models/MaintenanceTask');
const Category = require('../models/Category');
const OdometerLog = require('../models/OdometerLog');
const RecipeSchedule = require('../models/RecipeSchedule');
const Recipe = require('../models/Recipe');
const Item = require('../models/Item');
const { reDropPlaintext } = require('../scripts/reDropPlaintext');
const { migrateToRecords } = require('../scripts/migrateToRecords');
const { DROP_FIELDS_VERSION } = require('../services/dropReadiness');

before(startDb);
after(stopDb);

test('re-seal-all → reseal-complete → re-drop nulls the newer plaintext columns', async () => {
  const owner = await registerUser({ firstName: 'Pat' });
  const householdId = owner.user.householdId;

  // Simulate a household dropped BEFORE pass 2: e2eeActive, but an old field set
  // (dropFieldsVersion 0) and a sealed settings blob whose ciphertext predates
  // the household name (C2). The name is still plaintext.
  await Household.updateOne({ _id: householdId },
    { $set: { e2eeActive: true, currentKeyVersion: 1, dropFieldsVersion: 0, enc: fakeEnc(), keyVersion: 1, name: 'The Olds' } });

  // Records in the pre-pass-2 shape: the OLD drop nulled the old content columns
  // (title etc., sealed in enc), but left the NEWER columns plaintext:
  //  - a task with enc but a plaintext nextDueDate (D4),
  //  - a category with a plaintext name and NO enc (D5 straggler),
  //  - an odometer log + meal note likewise plaintext, no enc.
  const car = await Item.create({ userId: owner.user._id, type: 'vehicle', enc: fakeEnc(), keyVersion: 1 });
  const task = await MaintenanceTask.create({
    userId: owner.user._id, type: 'interval',
    recurrence: { type: 'interval', intervalValue: 6, intervalUnit: 'months' },
    nextDueDate: new Date('2026-09-01'), enc: fakeEnc(), keyVersion: 1,
  });
  const cat = await Category.create({ userId: owner.user._id, name: 'Boats', icon: 'sail-boat' });
  const odo = await OdometerLog.create({
    userId: owner.user._id, itemId: car._id, reading: 48200, notes: 'lake trip', recordedAt: new Date('2026-07-01'),
  });
  const recipe = await Recipe.create({ userId: owner.user._id, enc: fakeEnc(), keyVersion: 1 });
  const meal = await RecipeSchedule.create({
    userId: owner.user._id, recipeId: recipe._id, scheduledDate: new Date('2026-07-22'), notes: 'extra garlic',
  });

  // Signal-parity C3b ops order: the legacy per-collection rows are copied into the
  // unified Record store (the re-seal writes the folded v2 ciphertext there by _id).
  // The old tables stay until the final drop, so reDropPlaintext still nulls their
  // plaintext below.
  await migrateToRecords({ commit: true });

  // ── 1) The script REFUSES to commit before the re-seal pass confirms ────────
  const early = await reDropPlaintext(householdId, { commit: true });
  assert.equal(early.status, 'reseal-pending', 'nulling is blocked until dropFieldsVersion is current');
  assert.equal((await MaintenanceTask.findById(task._id)).nextDueDate?.toISOString().slice(0, 10), '2026-09-01', 'nothing nulled yet');

  // ── 2) reseal-all lists exactly the records needing their new fields folded ──
  const rs = await request().get('/api/household/e2ee/reseal-all').set('Authorization', owner.auth);
  assert.equal(rs.status, 200);
  assert.equal(rs.body.dropFieldsVersion, DROP_FIELDS_VERSION);
  const listed = Object.fromEntries(rs.body.collections.map((c) => [c.collection, c.records.map((r) => String(r._id))]));
  assert.ok(listed.MaintenanceTask?.includes(String(task._id)), 'the task (plaintext nextDueDate) is listed');
  assert.ok(listed.Category?.includes(String(cat._id)), 'the enc-less category is listed');
  assert.ok(listed.OdometerLog?.includes(String(odo._id)), 'the enc-less odometer log is listed');
  assert.ok(listed.RecipeSchedule?.includes(String(meal._id)), 'the enc-less meal note is listed');

  // ── 3) Simulate the client decrypt-merge-reseal: write a fresh enc for each ──
  for (const group of rs.body.collections) {
    for (const row of group.records) {
      const seal = await request().post('/api/household/e2ee/seal').set('Authorization', owner.auth)
        .send({ collection: group.collection, _id: row._id, enc: fakeEnc(), keyVersion: 1 });
      assert.equal(seal.status, 200);
    }
  }
  // The clean pass stamps the version — the interlock the script requires.
  const done = await request().post('/api/household/e2ee/reseal-complete').set('Authorization', owner.auth);
  assert.equal(done.body.dropFieldsVersion, DROP_FIELDS_VERSION);
  assert.equal((await Household.findById(householdId)).dropFieldsVersion, DROP_FIELDS_VERSION);

  // ── 4) Dry run previews, commit nulls the newer plaintext columns ───────────
  assert.equal((await reDropPlaintext(householdId)).status, 'dry-run');
  assert.equal((await MaintenanceTask.findById(task._id)).nextDueDate?.toISOString().slice(0, 10), '2026-09-01', 'dry run changes nothing');

  const committed = await reDropPlaintext(householdId, { commit: true });
  assert.equal(committed.status, 'committed');

  // A record that already carried enc (the task) still has its newer plaintext
  // column nulled in place by the re-drop (its old-table enc gates the null).
  const taskAfter = await MaintenanceTask.findById(task._id).lean();
  assert.equal(taskAfter.nextDueDate, undefined, 'nextDueDate is nulled');
  assert.ok(taskAfter.enc?.ct, 'the re-sealed ciphertext survives');

  // C3b: the enc-less stragglers (category / odometer / meal) had their newer
  // content FOLDED INTO the unified Record store by the re-seal — the folded v2
  // ciphertext lands there (the old per-collection rows are dropped by the final
  // dropContentCollections step, so the re-drop doesn't null them in place).
  const RecordM = require('../models/Record');
  for (const id of [cat._id, odo._id, meal._id]) {
    assert.ok((await RecordM.findById(id).lean())?.enc?.ct, 'the fold-in wrote v2 ciphertext to Record');
  }

  const hhAfter = await Household.findById(householdId).lean();
  assert.equal(hhAfter.name, undefined, 'the household name is nulled (blob intact)');
  assert.ok(hhAfter.enc?.ct);

  // ── 5) Idempotent: already current → nothing to do ──────────────────────────
  assert.equal((await reDropPlaintext(householdId, { commit: true })).status, 'already-current');
});

test('re-drop refuses a household that was never dropped', async () => {
  const owner = await registerUser({ firstName: 'Sam' });
  const res = await reDropPlaintext(owner.user.householdId, { commit: true });
  assert.equal(res.status, 'not-active');
});
