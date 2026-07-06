// Enrollment/unlock orchestration tests. Written in JS (not TS) so the module's
// exported .ts is exercised through Node's type-stripping loader with no build.
//
// Run: npm test   (included by the src/**/*.test.* glob)

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHouseholdCrypto } from './core.ts';
import { createEnrollment } from './enrollment.ts';

const require = createRequire(import.meta.url);
const _sodium = require('libsodium-wrappers-sumo');
await _sodium.ready;

const crypto = createHouseholdCrypto(_sodium);
const enroll = createEnrollment(crypto);
const bytesEqual = (a, b) => assert.deepEqual([...a], [...b]);

// Simulate the server round-trip: what /keys/enroll stores → what /keys/me returns.
function store(result) {
  return {
    identityPublicKey: result.payload.identityPublicKey,
    wrappedPrivateKey: result.payload.factors,
  };
}

test('enroll produces a public key + password & recovery factors + a recovery code', () => {
  const result = enroll.enroll('correct horse battery staple');
  assert.ok(result.payload.identityPublicKey);
  assert.deepEqual(result.payload.factors.map((f) => f.factor).sort(), ['password', 'recovery']);
  assert.match(result.recoveryCodeDisplay, /^[0-9A-Z]{5}(-[0-9A-Z]{1,5})+$/);
});

test('unlock with the password recovers the same keypair', () => {
  const result = enroll.enroll('s3cret-pass');
  const material = store(result);
  const unlocked = enroll.unlockWithPassword(material, 's3cret-pass');
  bytesEqual(unlocked.privateKey, result.keyPair.privateKey);
  bytesEqual(unlocked.publicKey, result.keyPair.publicKey);
});

test('unlock with the recovery code (reformatted) recovers the same keypair', () => {
  const result = enroll.enroll('s3cret-pass');
  const material = store(result);
  const reentered = result.recoveryCodeDisplay.replace(/-/g, ' ').toLowerCase();
  const unlocked = enroll.unlockWithRecovery(material, reentered);
  bytesEqual(unlocked.privateKey, result.keyPair.privateKey);
});

test('wrong password / wrong code are rejected', () => {
  const material = store(enroll.enroll('s3cret-pass'));
  assert.throws(() => enroll.unlockWithPassword(material, 'nope'));
  assert.throws(() => enroll.unlockWithRecovery(material, 'AAAAA-BBBBB-CCCCC'));
});

test('end-to-end: unlock, then decrypt a household record via the HDK envelope', () => {
  const result = enroll.enroll('s3cret-pass');
  const material = store(result);

  // Household side: wrap the HDK to the enrolled public key.
  const hdk = crypto.generateHDK();
  const envelope = crypto.wrapHDKForMember(hdk, result.keyPair.publicKey);
  const loc = { collection: 'CalendarEvent', id: 'abc', householdId: 'hh1', keyVersion: 1 };
  const enc = crypto.encryptRecord(hdk, loc, { title: 'Dentist' });

  // A fresh login: unlock from password, unwrap the HDK, decrypt.
  const kp = enroll.unlockWithPassword(material, 's3cret-pass');
  const hdkBack = crypto.unwrapHDK(envelope, kp);
  assert.deepEqual(crypto.decryptRecord(hdkBack, loc, enc), { title: 'Dentist' });
});

test('rewrapPassword lets a new password unlock the same key; a new recovery code works too', () => {
  const result = enroll.enroll('old-pass');
  // Change password: re-wrap and replace the password factor.
  const newPw = enroll.rewrapPassword(result.keyPair.privateKey, 'new-pass');
  const rc = enroll.regenerateRecoveryCode(result.keyPair.privateKey);
  const material = {
    identityPublicKey: result.payload.identityPublicKey,
    wrappedPrivateKey: [newPw, rc.factor],
  };
  bytesEqual(enroll.unlockWithPassword(material, 'new-pass').privateKey, result.keyPair.privateKey);
  assert.throws(() => enroll.unlockWithPassword(material, 'old-pass'));
  bytesEqual(
    enroll.unlockWithRecovery(material, rc.display).privateKey,
    result.keyPair.privateKey,
  );
});
