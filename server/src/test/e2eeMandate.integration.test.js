// Integration test for the mandatory-E2EE enforcement (the write-guard) and the
// born-encrypted activation endpoint. The policy is off under NODE_ENV=test by
// default so the other suites keep exercising the plaintext paths — this file
// flips the E2EE_ENFORCE_IN_TEST opt-in so e2eeRequired() reports true for a
// normal (non-exempt) household, exactly as it will in production.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  startDb, stopDb, request, b64u, fakeEnc, registerUser, enrollKeys,
} = require('./harness');

// Turn the mandate on for this process before any request runs.
process.env.E2EE_ENFORCE_IN_TEST = '1';

const Household = require('../models/Household');

before(startDb);
after(async () => { delete process.env.E2EE_ENFORCE_IN_TEST; await stopDb(); });

// Enroll the owner and mint HDK v1 so the session "holds a key" the way a real
// onboarded client would.
async function onboardOwner(firstName) {
  const owner = await registerUser({ firstName });
  await enrollKeys(owner.auth);
  const mint = await request().post('/api/household/key')
    .set('Authorization', owner.auth).send({ keyVersion: 1, wrappedHDK: b64u(96) });
  assert.equal(mint.status, 201);
  return owner;
}

// A fresh client-minted ObjectId (24 hex chars), as the client supplies when
// creating an encrypted record so its ciphertext AAD can bind to the _id.
const crypto = require('node:crypto');
const oid = () =>
  Math.floor(Date.now() / 1000).toString(16).padStart(8, '0') + crypto.randomBytes(8).toString('hex');

test('write-guard: plaintext content creates are rejected, enc-bearing creates succeed', async () => {
  const owner = await onboardOwner('Ada');

  // Each entry: endpoint + a minimal plaintext body. The guard must reject it
  // with no `enc`, and accept the same body once ciphertext rides along.
  const cases = [
    ['/api/people', { type: 'friend', name: 'Cal' }],
    ['/api/calendar/events', { calendarType: 'appointments', title: 'Dentist', startDate: '2026-09-01' }],
    ['/api/chores', { title: 'Sweep' }],
    ['/api/tasks', { title: 'Oil change' }],
    ['/api/inventory', { name: 'Milk' }],
    ['/api/items', { name: 'Furnace', type: 'appliance' }],
    ['/api/recipes', { title: 'Soup' }],
    ['/api/trips', { name: 'Getaway', destination: 'Banff' }],
  ];

  for (const [url, body] of cases) {
    const plain = await request().post(url).set('Authorization', owner.auth).send(body);
    assert.equal(plain.status, 400, `${url} plaintext create should be blocked`);
    assert.match(plain.body.error, /end-to-end encrypted/i, `${url} returns the mandate message`);

    const sealed = await request().post(url).set('Authorization', owner.auth)
      .send({ ...body, _id: oid(), enc: fakeEnc(), keyVersion: 1 });
    assert.equal(sealed.status, 201, `${url} enc-bearing create should succeed`);
    assert.ok(sealed.body.enc?.ct, `${url} persisted the ciphertext`);
  }

  // Trip items follow their trip: a private trip's item needs enc…
  const privateTrip = await request().post('/api/trips').set('Authorization', owner.auth)
    .send({ name: 'Private', destination: 'Rome', _id: oid(), enc: fakeEnc(), keyVersion: 1 });
  const itemPlain = await request().post(`/api/trips/${privateTrip.body._id}/items`)
    .set('Authorization', owner.auth).send({ type: 'hotel', title: 'Hotel Roma', start: '2026-09-02' });
  assert.equal(itemPlain.status, 400, 'a private trip item without enc is blocked');
  const itemSealed = await request().post(`/api/trips/${privateTrip.body._id}/items`)
    .set('Authorization', owner.auth)
    .send({ type: 'hotel', title: 'Hotel Roma', start: '2026-09-02', _id: oid(), enc: fakeEnc(), keyVersion: 1 });
  assert.equal(itemSealed.status, 201, 'a private trip item with enc succeeds');

  // …but a SHARED trip stays plaintext-readable for outside collaborators, so a
  // plaintext item on it is allowed (and never sealed).
  const sharedTrip = await request().post('/api/trips').set('Authorization', owner.auth)
    .send({ name: 'Shared', destination: 'Algonquin', _id: oid(), enc: fakeEnc(), keyVersion: 1 });
  await request().put(`/api/trips/${sharedTrip.body._id}/share`)
    .set('Authorization', owner.auth).send({ recipients: [{ email: 'cousin@example.com' }] });
  const sharedItem = await request().post(`/api/trips/${sharedTrip.body._id}/items`)
    .set('Authorization', owner.auth).send({ type: 'activity', title: 'Canoe', start: '2026-07-20' });
  assert.equal(sharedItem.status, 201, 'a shared trip item without enc is allowed');
  assert.equal(sharedItem.body.enc, undefined, 'a shared trip item is never sealed');
});

test('exempt households are never blocked and never auto-activate', async () => {
  const owner = await onboardOwner('Grace');
  await Household.updateOne({ _id: owner.user.householdId }, { $set: { e2eeExempt: true } });

  const plain = await request().post('/api/people').set('Authorization', owner.auth)
    .send({ type: 'friend', name: 'Plain Pat' });
  assert.equal(plain.status, 201, 'exempt household may write plaintext');

  const activate = await request().post('/api/household/e2ee/activate').set('Authorization', owner.auth);
  assert.equal(activate.status, 200);
  assert.equal(activate.body.status, 'not-required');
  assert.equal(activate.body.e2eeActive, false);
});

test('born-encrypted activation flips e2eeActive and stays enforced afterward', async () => {
  const owner = await onboardOwner('Ivy');

  // The register-seeded self-Person is plaintext, so it blocks the drop until
  // the owner's device seals it — mirror that client straggler pass.
  const strag = await request().get('/api/household/e2ee/stragglers').set('Authorization', owner.auth);
  const persons = strag.body.collections.find((c) => c.collection === 'Person');
  assert.ok(persons && persons.records.length >= 1, 'the seeded self-Person is a straggler');
  for (const row of persons.records) {
    const seal = await request().post('/api/household/e2ee/seal').set('Authorization', owner.auth)
      .send({ collection: 'Person', _id: row._id, enc: fakeEnc(), keyVersion: 1 });
    assert.equal(seal.status, 200);
  }

  // Activate → the household drops plaintext and goes E2EE-live.
  const activate = await request().post('/api/household/e2ee/activate').set('Authorization', owner.auth);
  assert.equal(activate.status, 200);
  assert.equal(activate.body.status, 'committed');
  assert.equal(activate.body.e2eeActive, true);

  const hh = await request().get('/api/household').set('Authorization', owner.auth);
  assert.equal(hh.body.e2eeActive, true);

  // Idempotent — a second activation is a no-op success.
  const again = await request().post('/api/household/e2ee/activate').set('Authorization', owner.auth);
  assert.equal(again.body.status, 'already-active');
  assert.equal(again.body.e2eeActive, true);

  // The write-guard still holds post-activation.
  const plain = await request().post('/api/people').set('Authorization', owner.auth)
    .send({ type: 'friend', name: 'Nope' });
  assert.equal(plain.status, 400);
  const sealed = await request().post('/api/people').set('Authorization', owner.auth)
    .send({ type: 'friend', name: 'Yes', _id: oid(), enc: fakeEnc(), keyVersion: 1 });
  assert.equal(sealed.status, 201);
});
