// Integration tests for E2EE trip-item attachments (Phase 4c): ciphertext upload
// with a wrapped per-file key on private bookings, refusal on shared bookings
// (collaborators hold no HDK), and ciphertext-preserving download headers.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  startDb, stopDb, request, b64u, registerUser,
} = require('./harness');

const Trip = require('../models/Trip');
const TripItem = require('../models/TripItem');

before(startDb);
after(stopDb);

async function setupBooking({ shared = false } = {}) {
  const owner = await registerUser();
  const trip = await Trip.create({
    userId: owner.user._id, name: 'Trip', destination: 'X',
    start: new Date('2026-08-01'), end: new Date('2026-08-05'),
    ...(shared ? { shareCode: 'SHARE123' } : {}),
  });
  const item = await TripItem.create({
    userId: owner.user._id, householdId: owner.user.householdId, tripId: trip._id,
    type: 'hotel', title: 'Hotel', start: new Date('2026-08-01'),
  });
  return { owner, trip, item };
}

const CIPHERTEXT = Buffer.from('opaque-encrypted-bytes-here');

test('encrypted attachment upload on a private booking stores the crypto metadata', async () => {
  const { owner, trip, item } = await setupBooking();
  const attId = '66aabbccddeeff0011223355';
  const res = await request()
    .post(`/api/trips/${trip._id}/items/${item._id}/attachments`)
    .set('Authorization', owner.auth)
    .field('encrypted', 'true')
    .field('_id', attId)
    .field('wrappedFileKey', b64u(96))
    .field('keyVersion', '1')
    .field('fileType', 'application/pdf')
    .field('title', 'confirmation.pdf')
    .attach('file', CIPHERTEXT, { filename: `${attId}.bin`, contentType: 'application/octet-stream' });
  assert.equal(res.status, 201);
  assert.equal(res.body._id, attId);
  assert.equal(res.body.encrypted, true);
  assert.ok(res.body.wrappedFileKey);
  assert.equal(res.body.keyVersion, 1);
  assert.equal(res.body.fileType, 'application/pdf'); // plaintext mimetype for post-decrypt
  assert.equal(res.body.filename, 'confirmation.pdf');

  // Download serves the ciphertext as an opaque stream, not the plaintext type.
  const dl = await request()
    .get(`/api/trips/${trip._id}/items/${item._id}/attachments/${attId}/download`)
    .set('Authorization', owner.auth);
  assert.equal(dl.status, 200);
  assert.match(dl.headers['content-type'], /application\/octet-stream/);
});

test('encrypted upload is refused on a shared trip (collaborators must be able to read)', async () => {
  const { owner, trip, item } = await setupBooking({ shared: true });
  const res = await request()
    .post(`/api/trips/${trip._id}/items/${item._id}/attachments`)
    .set('Authorization', owner.auth)
    .field('encrypted', 'true')
    .field('wrappedFileKey', b64u(96))
    .field('keyVersion', '1')
    .attach('file', CIPHERTEXT, { filename: 'x.bin', contentType: 'application/octet-stream' });
  assert.equal(res.status, 409);

  // Plaintext upload on the same shared booking is fine.
  const plain = await request()
    .post(`/api/trips/${trip._id}/items/${item._id}/attachments`)
    .set('Authorization', owner.auth)
    .attach('file', CIPHERTEXT, { filename: 'conf.pdf', contentType: 'application/pdf' });
  assert.equal(plain.status, 201);
  assert.equal(plain.body.encrypted, undefined);
  assert.equal(plain.body.filename, 'conf.pdf');
});

test('encrypted upload without a wrapped file key is rejected', async () => {
  const { owner, trip, item } = await setupBooking();
  const res = await request()
    .post(`/api/trips/${trip._id}/items/${item._id}/attachments`)
    .set('Authorization', owner.auth)
    .field('encrypted', 'true')
    .attach('file', CIPHERTEXT, { filename: 'x.bin', contentType: 'application/octet-stream' });
  assert.equal(res.status, 400);
});
