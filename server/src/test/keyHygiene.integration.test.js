// Signal-parity B1/B2/B3 — old-version record listing, envelope retirement
// gating, and the periodic-rotation flag. Real app + in-memory MongoDB.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startDb, stopDb, request, registerUser, enrollKeys, b64u, fakeEnc } = require('./harness');

before(startDb);
after(stopDb);

const Household = require('../models/Household');
const HouseholdKeyEnvelope = require('../models/HouseholdKeyEnvelope');
// Signal-parity C3b: content lives in the unified opaque Record store.
const Record = require('../models/Record');

// Mint v1 through the API, then force the household to v2 directly (a real
// rotation needs client crypto the harness doesn't have).
async function setupRotatedHousehold() {
  const u = await registerUser({ firstName: 'Kay' });
  await enrollKeys(u.auth);
  const mint = await request().post('/api/household/key').set('Authorization', u.auth)
    .send({ keyVersion: 1, wrappedHDK: b64u(96) });
  assert.equal(mint.status, 201);
  const householdId = u.user.householdId;
  await Household.updateOne({ _id: householdId }, { $set: { currentKeyVersion: 2 } });
  await HouseholdKeyEnvelope.create({
    householdId, userId: u.user._id, keyVersion: 2, wrappedHDK: b64u(96), wrappedByUserId: u.user._id,
  });
  return { u, householdId };
}

test('old-versions lists v1 records; retire refuses until drained, then deletes old envelopes', async () => {
  const { u, householdId } = await setupRotatedHousehold();

  // One record still sealed under v1, in the unified opaque store.
  const ev = await Record.create({
    userId: u.user._id, householdId, enc: fakeEnc(), keyVersion: 1,
  });

  const old = await request().get('/api/household/e2ee/old-versions').set('Authorization', u.auth);
  assert.equal(old.status, 200);
  assert.equal(old.body.total, 1);
  // C3b: the 9 migrated collections are opaque — old-versions returns them under
  // the pseudo-collection 'Record' (the client decrypts each opaquely + re-seals).
  assert.equal(old.body.collections[0].collection, 'Record');
  assert.equal(old.body.collections[0].records[0].keyVersion, 1);

  // Retire must refuse while the v1 record remains.
  const blocked = await request().post('/api/household/key/retire').set('Authorization', u.auth);
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.remaining, 1);

  // Re-seal (as the client B1 pass would) → PUT the v2 ciphertext to /records →
  // drained → retire deletes the v1 envelope.
  const seal = await request().put(`/api/records/${ev._id}`).set('Authorization', u.auth)
    .send({ enc: fakeEnc(), keyVersion: 2 });
  assert.equal(seal.status, 200);

  const retired = await request().post('/api/household/key/retire').set('Authorization', u.auth);
  assert.equal(retired.status, 200);
  assert.equal(retired.body.retired, 1);
  const envs = await HouseholdKeyEnvelope.find({ householdId }).lean();
  assert.deepEqual(envs.map((e) => e.keyVersion), [2]);
});

test('periodic rotation flags only stale households', async () => {
  const { runKeyRotationCheck } = require('../jobs/scheduler');
  const { householdId } = await setupRotatedHousehold();

  // Fresh household: not flagged.
  process.env.KEY_ROTATION_INTERVAL_DAYS = '90';
  await runKeyRotationCheck();
  let hh = await Household.findById(householdId).lean();
  assert.equal(!!hh.keyRotationPending, false);

  // Age the key + the household past the interval: flagged. (Native driver:
  // mongoose always strips createdAt overwrites when timestamps are on.)
  const old = new Date(Date.now() - 91 * 24 * 60 * 60 * 1000);
  await Household.collection.updateOne(
    { _id: new (require('mongoose').Types.ObjectId)(String(householdId)) },
    { $set: { lastKeyRotationAt: old, createdAt: old } },
  );
  await runKeyRotationCheck();
  hh = await Household.findById(householdId).lean();
  assert.equal(hh.keyRotationPending, true);
});
