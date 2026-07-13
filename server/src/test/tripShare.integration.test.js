// Integration tests for trip sharing by email invitation + §9.3 decrypt-on-share:
// adding an outside email to an E2EE trip requires the owner's device to post the
// decrypted content (409 decrypt_required otherwise), the server re-writes it
// plaintext + clears enc, and steady-state write guards keep a shared trip's
// records plaintext. Accepting the invitation makes the recipient a collaborator.
// Real app + in-memory MongoDB.
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

const DECRYPTED = {
  trip: { name: 'Ski Week', destination: 'Whistler', notes: 'bring the good skis' },
  items: [{ title: 'Hotel Alpina', location: 'Whistler Village', notes: 'late checkout' }],
};

test('adding an outside email to a sealed trip without decrypted content → 409', async () => {
  const { owner, tripId } = await setupSealedTrip();
  const res = await request().put(`/api/trips/${tripId}/share`)
    .set('Authorization', owner.auth).send({ emails: ['gil@example.com'] });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, 'decrypt_required');
});

test('decrypt-on-share re-writes trip + items as plaintext, clears enc, sets the share list', async () => {
  const { owner, tripId, itemId } = await setupSealedTrip();

  const res = await request().put(`/api/trips/${tripId}/share`)
    .set('Authorization', owner.auth)
    .send({
      emails: ['gil@example.com'],
      decrypted: {
        trip: DECRYPTED.trip,
        items: [{ _id: String(itemId), ...DECRYPTED.items[0] }],
      },
    });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.sharedWithOutside.map((e) => e.email), ['gil@example.com']);

  const trip = await Trip.findById(tripId).lean();
  assert.equal(trip.name, 'Ski Week');
  assert.equal(trip.destination, 'Whistler');
  assert.equal(trip.enc, undefined);
  assert.equal(trip.keyVersion, undefined);

  const item = await TripItem.findById(itemId).lean();
  assert.equal(item.title, 'Hotel Alpina');
  assert.equal(item.location, 'Whistler Village');
  assert.equal(item.enc, undefined);

  // Re-saving the same share list needs no decrypted content (already shared).
  const again = await request().put(`/api/trips/${tripId}/share`)
    .set('Authorization', owner.auth).send({ emails: ['gil@example.com'] });
  assert.equal(again.status, 200);
});

test('steady-state guards: edits to a shared trip and its items never re-introduce enc', async () => {
  const { owner, tripId, itemId } = await setupSealedTrip();
  await request().put(`/api/trips/${tripId}/share`)
    .set('Authorization', owner.auth)
    .send({
      emails: ['gil@example.com'],
      decrypted: { trip: { name: 'Ski Week', destination: 'Whistler', notes: '' }, items: [{ _id: String(itemId), title: 'Hotel Alpina' }] },
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
  const res = await request().put(`/api/trips/${trip._id}/share`)
    .set('Authorization', owner.auth).send({ emails: ['friend@example.com'] });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.sharedWithOutside.map((e) => e.email), ['friend@example.com']);
});

test('invite → accept makes a collaborator; trip shows on their calendar (expanded + raw)', async () => {
  const owner = await registerUser({ firstName: 'Hana' });
  const guest = await registerUser({ firstName: 'Gil' });
  const trip = await Trip.create({
    userId: owner.user._id, name: 'Japan', destination: 'Tokyo', status: 'booked',
    startDate: new Date('2027-01-31'), endDate: new Date('2027-02-25'),
  });

  // Owner shares to the guest's email → a pending invitation lands in the guest's inbox.
  const share = await request().put(`/api/trips/${trip._id}/share`)
    .set('Authorization', owner.auth).send({ emails: [guest.user.email] });
  assert.equal(share.status, 200);

  const inbox = await request().get('/api/trips/invitations').set('Authorization', guest.auth);
  const invite = inbox.body.find((i) => i.status === 'pending');
  assert.ok(invite, 'guest sees a pending trip invitation');

  const accept = await request().post(`/api/trips/invitations/${invite._id}/accept`)
    .set('Authorization', guest.auth).send({});
  assert.equal(accept.status, 200);
  assert.equal(String(accept.body.tripId), String(trip._id));

  const range = 'from=2027-01-01&to=2027-03-31';
  const cal = await request().get(`/api/calendar?${range}`).set('Authorization', guest.auth);
  assert.equal(cal.status, 200);
  assert.deepEqual(cal.body.trips.map(t => t.name), ['Japan']);

  const raw = await request().get(`/api/calendar/raw?${range}`).set('Authorization', guest.auth);
  assert.equal(raw.status, 200);
  assert.deepEqual(raw.body.trips.map(t => t.name), ['Japan']);

  // A stranger's calendar stays empty.
  const other = await registerUser({ firstName: 'Uma' });
  const none = await request().get(`/api/calendar?${range}`).set('Authorization', other.auth);
  assert.deepEqual(none.body.trips, []);
});

test('share by phone resolves to the account with that number; they can accept', async () => {
  const owner = await registerUser({ firstName: 'Nadia' });
  const guest = await registerUser({ firstName: 'Omar' });
  // The guest saves a phone number on their account (loosely normalized server-side).
  const save = await request().put('/api/settings')
    .set('Authorization', guest.auth).send({ phone: '(416) 555-0199' });
  assert.equal(save.status, 200);

  const trip = await Trip.create({
    userId: owner.user._id, name: 'Road trip', destination: 'PEI',
    startDate: new Date('2027-05-01'), endDate: new Date('2027-05-05'),
  });

  // Owner shares by the guest's phone — a slightly different format resolves to
  // the same normalized number and to the guest's account.
  const share = await request().put(`/api/trips/${trip._id}/share`)
    .set('Authorization', owner.auth).send({ recipients: [{ phone: '416-555-0199' }] });
  assert.equal(share.status, 200);
  assert.deepEqual(share.body.sharedWithOutside.map((e) => e.phone), ['4165550199']);

  const inbox = await request().get('/api/trips/invitations').set('Authorization', guest.auth);
  const invite = inbox.body.find((i) => i.status === 'pending');
  assert.ok(invite, 'guest sees the phone-addressed invitation resolved to their account');

  const accept = await request().post(`/api/trips/invitations/${invite._id}/accept`)
    .set('Authorization', guest.auth).send({});
  assert.equal(accept.status, 200);
  assert.equal(String(accept.body.tripId), String(trip._id));
});
