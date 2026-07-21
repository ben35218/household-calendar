// Integration tests for E2EE trip-item attachments (Phase 4c + Signal-parity D2):
// ciphertext upload with a wrapped per-file key on private bookings (Kf under the
// HDK) AND on shared bookings (Kf under the TripKey — the retired §9.3 plaintext
// lane), plus ciphertext-preserving download headers. The server is blind to
// which key wrapped Kf; it only stores the opaque wrappedFileKey.
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
    ...(shared ? { sharedWithOutside: [{ email: 'guest@example.com' }] } : {}),
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

test('D2: encrypted upload IS allowed on a shared booking (Kf wrapped under the TripKey)', async () => {
  const { owner, trip, item } = await setupBooking({ shared: true });
  const attId = '66aabbccddeeff0011223399';
  // The client wraps Kf under the TripKey (its wrap envelope carries ks:'trip');
  // the server just stores the opaque wrappedFileKey — no 409 anymore.
  const res = await request()
    .post(`/api/trips/${trip._id}/items/${item._id}/attachments`)
    .set('Authorization', owner.auth)
    .field('encrypted', 'true')
    .field('_id', attId)
    .field('wrappedFileKey', JSON.stringify({ alg: 'xchacha20poly1305-ietf', nonce: b64u(32), ct: b64u(80), ks: 'trip' }))
    .field('keyVersion', '1')
    .field('fileType', 'application/pdf')
    .field('title', 'shared-receipt.pdf')
    .attach('file', CIPHERTEXT, { filename: `${attId}.bin`, contentType: 'application/octet-stream' });
  assert.equal(res.status, 201);
  assert.equal(res.body.encrypted, true);
  assert.ok(res.body.wrappedFileKey);

  // Download still serves ciphertext as an opaque stream.
  const dl = await request()
    .get(`/api/trips/${trip._id}/items/${item._id}/attachments/${attId}/download`)
    .set('Authorization', owner.auth);
  assert.equal(dl.status, 200);
  assert.match(dl.headers['content-type'], /application\/octet-stream/);

  // Plaintext upload on the same shared booking is still fine (graceful fallback).
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
