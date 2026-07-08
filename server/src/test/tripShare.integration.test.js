// Integration tests for §9.3 decrypt-on-share: sharing an E2EE trip requires the
// owner's device to post the decrypted content (409 decrypt_required otherwise),
// the server re-writes it plaintext + clears enc, and steady-state write guards
// keep a shared trip's records plaintext. Real app + in-memory MongoDB.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  startDb, stopDb, request, b64u, fakeEnc, registerUser, enrollKeys,
} = require('./harness');

const Household = require('../models/Household');
const Trip = require('../models/Trip');
const TripItem = require('../models/TripItem');

before(startDb);
after(stopDb);

// An owner whose household is post-drop (e2eeActive), holding one sealed trip
// with one sealed booking — plaintext content nulled, exactly as the drop leaves
// them (updateOne bypasses required-field validation, like updateMany at the drop).
async function setupSealedTrip() {
  const owner = await registerUser({ firstName: 'Vera' });
  await enrollKeys(owner.auth);
  await request().post('/api/household/key')
    .set('Authorization', owner.auth).send({ keyVersion: 1, wrappedHDK: b64u(96) });
  await Household.updateOne({ ownerId: owner.user._id }, { $set: { e2eeActive: true } });

  const trip = await Trip.create({
    userId: owner.user._id, name: 'tmp', destination: 'tmp', notes: 'tmp',
    start: new Date('2026-08-01'), end: new Date('2026-08-08'),
    enc: fakeEnc(), keyVersion: 1,
  });
  await Trip.updateOne({ _id: trip._id }, { $unset: { name: '', destination: '', notes: '' } });

  const item = await TripItem.create({
    userId: owner.user._id, householdId: owner.user.householdId, tripId: trip._id,
    type: 'hotel', title: 'tmp', start: new Date('2026-08-01'),
    enc: fakeEnc(), keyVersion: 1,
  });
  await TripItem.updateOne({ _id: item._id }, { $unset: { title: '', notes: '', location: '' } });

  return { owner, tripId: trip._id, itemId: item._id };
}

test('sharing a sealed trip without decrypted content → 409 decrypt_required', async () => {
  const { owner, tripId } = await setupSealedTrip();
  const res = await request().post(`/api/trips/${tripId}/share`).set('Authorization', owner.auth);
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'decrypt_required');
});

test('decrypt-on-share re-writes trip + items as plaintext, clears enc, mints the code', async () => {
  const { owner, tripId, itemId } = await setupSealedTrip();

  const res = await request().post(`/api/trips/${tripId}/share`)
    .set('Authorization', owner.auth)
    .send({
      decrypted: {
        trip: { name: 'Ski Week', destination: 'Whistler', notes: 'bring the good skis' },
        items: [{ _id: String(itemId), title: 'Hotel Alpina', location: 'Whistler Village', notes: 'late checkout' }],
      },
    });
  assert.equal(res.status, 200);
  assert.ok(res.body.shareCode);

  const trip = await Trip.findById(tripId).lean();
  assert.equal(trip.name, 'Ski Week');
  assert.equal(trip.destination, 'Whistler');
  assert.equal(trip.shareCode, res.body.shareCode);
  assert.equal(trip.enc, undefined);
  assert.equal(trip.keyVersion, undefined);

  const item = await TripItem.findById(itemId).lean();
  assert.equal(item.title, 'Hotel Alpina');
  assert.equal(item.location, 'Whistler Village');
  assert.equal(item.enc, undefined);

  // Re-sharing returns the existing code without needing decrypted content.
  const again = await request().post(`/api/trips/${tripId}/share`).set('Authorization', owner.auth);
  assert.equal(again.status, 200);
  assert.equal(again.body.shareCode, res.body.shareCode);
});

test('steady-state guards: edits to a shared trip and its items never re-introduce enc', async () => {
  const { owner, tripId, itemId } = await setupSealedTrip();
  await request().post(`/api/trips/${tripId}/share`)
    .set('Authorization', owner.auth)
    .send({
      decrypted: {
        trip: { name: 'Ski Week', destination: 'Whistler', notes: '' },
        items: [{ _id: String(itemId), title: 'Hotel Alpina' }],
      },
    });

  // Trip edit carrying ciphertext (a stale client sealing out of habit) → the
  // plaintext update lands, the enc is dropped.
  const put = await request().put(`/api/trips/${tripId}`)
    .set('Authorization', owner.auth)
    .send({ name: 'Ski Week 2026', enc: fakeEnc(), keyVersion: 1 });
  assert.equal(put.status, 200);
  const trip = await Trip.findById(tripId).lean();
  assert.equal(trip.name, 'Ski Week 2026');
  assert.equal(trip.enc, undefined);

  // Same for editing an existing booking…
  const itemPut = await request().put(`/api/trips/${tripId}/items/${itemId}`)
    .set('Authorization', owner.auth)
    .send({ type: 'hotel', title: 'Hotel Alpina — upgraded', start: '2026-08-01', enc: fakeEnc(), keyVersion: 1 });
  assert.equal(itemPut.status, 200);
  const item = await TripItem.findById(itemId).lean();
  assert.equal(item.title, 'Hotel Alpina — upgraded');
  assert.equal(item.enc, undefined);

  // …and for creating a new booking on the shared trip.
  const itemPost = await request().post(`/api/trips/${tripId}/items`)
    .set('Authorization', owner.auth)
    .send({ type: 'activity', title: 'Zipline', start: '2026-08-03', enc: fakeEnc(), keyVersion: 1 });
  assert.equal(itemPost.status, 201);
  const created = await TripItem.findById(itemPost.body._id).lean();
  assert.equal(created.title, 'Zipline');
  assert.equal(created.enc, undefined);
});

test('a private trip in a non-E2EE household shares directly (no decrypt step)', async () => {
  const owner = await registerUser({ firstName: 'Paulo' });
  const trip = await Trip.create({
    userId: owner.user._id, name: 'Lake weekend', destination: 'Muskoka',
    start: new Date('2026-09-01'), end: new Date('2026-09-03'),
  });
  const res = await request().post(`/api/trips/${trip._id}/share`).set('Authorization', owner.auth);
  assert.equal(res.status, 200);
  assert.ok(res.body.shareCode);
});
