// Signal-parity F4 — QR device-linking relay tests.
//
// The server is a blind relay between two of the SAME account's devices: it
// ferries the opaque sealed handoff and never reads it. These tests pin the relay
// contract — happy path (start → complete → single-use delivery), cross-account
// isolation, expiry, and input validation — not the crypto (that's covered in
// shared/crypto/src/deviceLink.test.ts).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startDb, stopDb, request, registerUser, b64u } = require('./harness');
const DeviceLink = require('../models/DeviceLink');

before(startDb);
after(stopDb);

test('F4: start → complete → the new device receives the sealed payload exactly once', async () => {
  const user = await registerUser({ firstName: 'Ivy' });

  // New device opens a slot with its ephemeral public key.
  const start = await request().post('/api/keys/link/start')
    .set('Authorization', user.auth)
    .send({ ephemeralPublicKey: b64u(32), deviceName: 'Ivy’s iPad' });
  assert.equal(start.status, 201);
  const { linkId } = start.body;
  assert.ok(linkId);

  // Before the existing device seals, the slot is pending (no payload leaks).
  const pending = await request().get(`/api/keys/link/${linkId}`).set('Authorization', user.auth);
  assert.equal(pending.status, 200);
  assert.equal(pending.body.status, 'pending');
  assert.equal(pending.body.sealedPayload, undefined);

  // Existing (unlocked) device posts the opaque sealed handoff.
  const sealed = b64u(200);
  const complete = await request().post('/api/keys/link/complete')
    .set('Authorization', user.auth)
    .send({ linkId, sealedPayload: sealed });
  assert.equal(complete.status, 200);

  // New device polls, gets the payload, and the slot is burned (single-use).
  const got = await request().get(`/api/keys/link/${linkId}`).set('Authorization', user.auth);
  assert.equal(got.status, 200);
  assert.equal(got.body.status, 'sealed');
  assert.equal(got.body.sealedPayload, sealed);

  const replay = await request().get(`/api/keys/link/${linkId}`).set('Authorization', user.auth);
  assert.equal(replay.status, 404, 'the slot is gone after one delivery');
});

test('F4: another account cannot complete or read someone else’s link', async () => {
  const owner = await registerUser({ firstName: 'Owner' });
  const attacker = await registerUser({ firstName: 'Mal' });

  const start = await request().post('/api/keys/link/start')
    .set('Authorization', owner.auth).send({ ephemeralPublicKey: b64u(32) });
  const { linkId } = start.body;

  const steal = await request().post('/api/keys/link/complete')
    .set('Authorization', attacker.auth).send({ linkId, sealedPayload: b64u(200) });
  assert.equal(steal.status, 404, 'a foreign account cannot seal into the slot');

  const peek = await request().get(`/api/keys/link/${linkId}`).set('Authorization', attacker.auth);
  assert.equal(peek.status, 404, 'a foreign account cannot poll the slot');
});

test('F4: an expired slot cannot be completed or read', async () => {
  const user = await registerUser({ firstName: 'Tess' });
  const start = await request().post('/api/keys/link/start')
    .set('Authorization', user.auth).send({ ephemeralPublicKey: b64u(32) });
  const { linkId } = start.body;

  // Force the slot into the past.
  await DeviceLink.updateOne({ linkId }, { $set: { expiresAt: new Date(Date.now() - 1000) } });

  const complete = await request().post('/api/keys/link/complete')
    .set('Authorization', user.auth).send({ linkId, sealedPayload: b64u(200) });
  assert.equal(complete.status, 404);

  const poll = await request().get(`/api/keys/link/${linkId}`).set('Authorization', user.auth);
  assert.equal(poll.status, 404);
});

test('F4: validation — start needs an ephemeral key; complete needs a sealed payload', async () => {
  const user = await registerUser({ firstName: 'Val' });
  const badStart = await request().post('/api/keys/link/start')
    .set('Authorization', user.auth).send({});
  assert.equal(badStart.status, 400);

  const start = await request().post('/api/keys/link/start')
    .set('Authorization', user.auth).send({ ephemeralPublicKey: b64u(32) });
  const badComplete = await request().post('/api/keys/link/complete')
    .set('Authorization', user.auth).send({ linkId: start.body.linkId });
  assert.equal(badComplete.status, 400);
});

test('F4: starting a new link clears the account’s prior pending slot', async () => {
  const user = await registerUser({ firstName: 'Rex' });
  const first = await request().post('/api/keys/link/start')
    .set('Authorization', user.auth).send({ ephemeralPublicKey: b64u(32) });
  const second = await request().post('/api/keys/link/start')
    .set('Authorization', user.auth).send({ ephemeralPublicKey: b64u(32) });
  assert.equal(second.status, 201);

  const stale = await request().get(`/api/keys/link/${first.body.linkId}`).set('Authorization', user.auth);
  assert.equal(stale.status, 404, 'the prior pending slot was cleared');
});
