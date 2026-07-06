// Tests for the E2EE key-envelope validators. Built-in node:test runner, no
// deps (mirrors scheduler.test.js).
//
// Run: node --test src/services/keyEnvelope.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  validateEnvelope, pickEnvelope, validateEnrollment, upsertFactor, removeFactor,
} = require('./keyEnvelope');

const passwordFactor = () => ({
  factor: 'password', kdf: 'argon2id', salt: 'c2FsdA', opslimit: 3, memlimit: 268435456,
  nonce: 'bm9uY2U', ct: 'Y2lwaGVy',
});
const recoveryFactor = () => ({ factor: 'recovery', nonce: 'bm9uY2U', ct: 'Y2lwaGVy' });
const passkeyFactor = (credentialId = 'Y3JlZDE') => ({
  factor: 'passkey', credentialId, prfSalt: 'cHJmc2FsdA', nonce: 'bm9uY2U', ct: 'Y2lwaGVy',
});

test('valid factors pass validation', () => {
  assert.equal(validateEnvelope(passwordFactor()), null);
  assert.equal(validateEnvelope(recoveryFactor()), null);
  assert.equal(validateEnvelope(passkeyFactor()), null);
});

test('rejects unknown factor kind and missing ciphertext', () => {
  assert.match(validateEnvelope({ factor: 'magic', nonce: 'a', ct: 'b' }), /invalid factor/);
  assert.match(validateEnvelope({ factor: 'recovery', nonce: 'bm9uY2U' }), /invalid ct/);
});

test('rejects non-base64url and oversized fields', () => {
  assert.match(validateEnvelope({ ...recoveryFactor(), ct: 'has spaces' }), /invalid ct/);
  assert.match(validateEnvelope({ ...recoveryFactor(), nonce: 'a+b/c=' }), /invalid nonce/);
});

test('password factor requires argon2id params', () => {
  assert.match(validateEnvelope({ ...passwordFactor(), kdf: 'scrypt' }), /argon2id/);
  assert.match(validateEnvelope({ ...passwordFactor(), opslimit: 0 }), /opslimit/);
  assert.match(validateEnvelope({ ...passwordFactor(), salt: '' }), /salt/);
});

test('passkey factor requires a credentialId', () => {
  const { credentialId, ...noCred } = passkeyFactor();
  assert.match(validateEnvelope(noCred), /credentialId/);
});

test('pickEnvelope strips unknown fields per kind', () => {
  const dirty = { ...passwordFactor(), evil: 'DROP TABLE', role: 'admin' };
  assert.deepEqual(pickEnvelope(dirty), passwordFactor());
  // recovery keeps only base fields
  assert.deepEqual(pickEnvelope({ ...recoveryFactor(), salt: 'nope' }), recoveryFactor());
});

test('validateEnrollment needs a public key and at least one factor', () => {
  assert.match(validateEnrollment({ identityPublicKey: 'has space', factors: [passwordFactor()] }), /identityPublicKey/);
  assert.match(validateEnrollment({ identityPublicKey: 'cHVia2V5', factors: [] }), /at least one factor/);
  assert.equal(validateEnrollment({ identityPublicKey: 'cHVia2V5', factors: [passwordFactor(), recoveryFactor()] }), null);
});

test('upsertFactor replaces the single password factor, keeps others', () => {
  const start = [passwordFactor(), recoveryFactor()];
  const next = upsertFactor(start, { ...passwordFactor(), ct: 'bmV3Y3Q' });
  assert.equal(next.length, 2);
  assert.equal(next.find((f) => f.factor === 'password').ct, 'bmV3Y3Q');
  assert.ok(next.find((f) => f.factor === 'recovery'));
});

test('upsertFactor lets multiple passkeys coexist by credentialId', () => {
  let set = [passwordFactor()];
  set = upsertFactor(set, passkeyFactor('ZGV2MQ'));
  set = upsertFactor(set, passkeyFactor('ZGV2Mg'));
  assert.equal(set.filter((f) => f.factor === 'passkey').length, 2);
  // Re-enrolling the same credentialId replaces, not duplicates.
  set = upsertFactor(set, { ...passkeyFactor('ZGV2MQ'), ct: 'cm90YXRlZA' });
  assert.equal(set.filter((f) => f.factor === 'passkey').length, 2);
  assert.equal(set.find((f) => f.credentialId === 'ZGV2MQ').ct, 'cm90YXRlZA');
});

test('removeFactor targets the right factor and supports last-factor guard', () => {
  const set = [passwordFactor(), recoveryFactor()];
  assert.equal(removeFactor(set, 'recovery').length, 1);
  // Removing a passkey needs the matching credentialId.
  const withKeys = [passkeyFactor('ZGV2MQ'), passkeyFactor('ZGV2Mg')];
  assert.equal(removeFactor(withKeys, 'passkey', 'ZGV2MQ').length, 1);
  assert.equal(removeFactor(withKeys, 'passkey', 'nope').length, 2);
  // The route uses a length-0 result to block removing the last factor.
  assert.equal(removeFactor([recoveryFactor()], 'recovery').length, 0);
});
