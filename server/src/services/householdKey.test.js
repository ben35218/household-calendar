// Tests for the Phase 2 household-key shape validators. Built-in node:test
// runner, no deps (mirrors keyEnvelope.test.js).
//
// Run: node --test src/services/householdKey.test.js

const test = require('node:test');
const assert = require('node:assert/strict');
const { validateHDKEnvelope, validateRotation, validateRecordEnvelope } = require('./householdKey');

const valid = () => ({ wrappedHDK: 'c2VhbGVkYm94', keyVersion: 1 });

test('a well-formed HDK envelope passes', () => {
  assert.equal(validateHDKEnvelope(valid()), null);
});

test('rejects a missing or non-base64url wrappedHDK', () => {
  assert.match(validateHDKEnvelope({ ...valid(), wrappedHDK: undefined }), /wrappedHDK/);
  assert.match(validateHDKEnvelope({ ...valid(), wrappedHDK: 'has spaces' }), /wrappedHDK/);
  assert.match(validateHDKEnvelope({ ...valid(), wrappedHDK: 'a+b/c=' }), /wrappedHDK/);
});

test('rejects a non-positive or non-integer keyVersion', () => {
  assert.match(validateHDKEnvelope({ ...valid(), keyVersion: 0 }), /keyVersion/);
  assert.match(validateHDKEnvelope({ ...valid(), keyVersion: 1.5 }), /keyVersion/);
  assert.match(validateHDKEnvelope({ ...valid(), keyVersion: '1' }), /keyVersion/);
});

test('rejects a non-object body', () => {
  assert.match(validateHDKEnvelope(null), /invalid body/);
});

const oid = (n) => String(n).padStart(24, '0');
const validRotation = () => ({
  keyVersion: 2,
  envelopes: [
    { userId: oid(1), wrappedHDK: 'c2VhbGVkMQ' },
    { userId: oid(2), wrappedHDK: 'c2VhbGVkMg' },
  ],
});

test('a well-formed rotation payload passes', () => {
  assert.equal(validateRotation(validRotation()), null);
});

test('rotation requires keyVersion >= 2 (v1 is minted, not rotated)', () => {
  assert.match(validateRotation({ ...validRotation(), keyVersion: 1 }), /keyVersion/);
  assert.match(validateRotation({ ...validRotation(), keyVersion: 2.5 }), /keyVersion/);
});

test('rotation needs at least one envelope with a valid id + wrappedHDK', () => {
  assert.match(validateRotation({ ...validRotation(), envelopes: [] }), /envelopes required/);
  assert.match(validateRotation({ ...validRotation(), envelopes: [{ userId: 'nope', wrappedHDK: 'x' }] }), /userId/);
  assert.match(validateRotation({ ...validRotation(), envelopes: [{ userId: oid(1), wrappedHDK: 'a+b/c=' }] }), /wrappedHDK/);
});

test('rotation rejects a duplicate member envelope', () => {
  assert.match(validateRotation({
    keyVersion: 2,
    envelopes: [{ userId: oid(1), wrappedHDK: 'c2VhbA' }, { userId: oid(1), wrappedHDK: 'c2VhbA' }],
  }), /duplicate/);
});

const validEnc = () => ({ alg: 'xchacha20poly1305-ietf', nonce: 'bm9uY2U', ct: 'Y2lwaGVy' });

test('a well-formed record envelope passes', () => {
  assert.equal(validateRecordEnvelope(validEnc()), null);
});

test('rejects a record envelope with wrong alg or bad base64', () => {
  assert.match(validateRecordEnvelope({ ...validEnc(), alg: 'aes-gcm' }), /enc\.alg/);
  assert.match(validateRecordEnvelope({ ...validEnc(), nonce: 'has spaces' }), /enc\.nonce/);
  assert.match(validateRecordEnvelope({ ...validEnc(), ct: 'a+b/c=' }), /enc\.ct/);
  assert.match(validateRecordEnvelope(null), /invalid enc/);
});
