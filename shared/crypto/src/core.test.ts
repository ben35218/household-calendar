// Cross-platform crypto core tests. Uses the built-in node:test runner (matching
// server/) and libsodium-wrappers as the injected Sodium instance — the same
// core that runs on web and mobile.
//
// Run: npm test   (from shared/crypto)

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHouseholdCrypto } from './core.ts';
import type { Sodium, RecordLocation } from './index.ts';

// libsodium-wrappers ships a broken ESM subpath; the CJS build is fine under
// Node's test runner. Bundlers (Vite/Metro) consume the ESM entry in the
// adapters without this shim.
const require = createRequire(import.meta.url);
const _sodium = require('libsodium-wrappers-sumo');
await _sodium.ready;
const crypto = createHouseholdCrypto(_sodium as unknown as Sodium);

const bytesEqual = (a: Uint8Array, b: Uint8Array) => assert.deepEqual([...a], [...b]);

const loc: RecordLocation = {
  collection: 'CalendarEvent',
  id: '507f1f77bcf86cd799439011',
  householdId: '507f191e810c19729de860ea',
  keyVersion: 1,
};

test('record encrypt/decrypt roundtrip preserves content (incl. dates)', () => {
  const hdk = crypto.generateHDK();
  const record = { title: 'Dentist', startDate: '2026-07-10T14:00:00Z', location: '123 Main St' };
  const env = crypto.encryptRecord(hdk, loc, record);
  assert.equal(env.alg, 'xchacha20poly1305-ietf');
  assert.deepEqual(crypto.decryptRecord(hdk, loc, env), record);
});

test('AAD binds ciphertext to its record slot — wrong location fails', () => {
  const hdk = crypto.generateHDK();
  const env = crypto.encryptRecord(hdk, loc, { title: 'secret' });
  assert.throws(() => crypto.decryptRecord(hdk, { ...loc, id: 'other-id' }, env));
  assert.throws(() => crypto.decryptRecord(hdk, { ...loc, keyVersion: 2 }, env));
  assert.throws(() => crypto.decryptRecord(hdk, { ...loc, householdId: 'elsewhere' }, env));
});

test('wrong HDK cannot decrypt', () => {
  const env = crypto.encryptRecord(crypto.generateHDK(), loc, { title: 'x' });
  assert.throws(() => crypto.decryptRecord(crypto.generateHDK(), loc, env));
});

test('tampered ciphertext is rejected', () => {
  const hdk = crypto.generateHDK();
  const env = crypto.encryptRecord(hdk, loc, { title: 'x' });
  const bad = crypto.b64(crypto.unb64(env.ct).map((b, i) => (i === 0 ? b ^ 1 : b)));
  assert.throws(() => crypto.decryptRecord(hdk, loc, { ...env, ct: bad }));
});

test('HDK sealed-box envelope: wrap to a member, member unwraps', () => {
  const hdk = crypto.generateHDK();
  const member = crypto.generateIdentityKeyPair();
  const wrapped = crypto.wrapHDKForMember(hdk, member.publicKey);
  bytesEqual(crypto.unwrapHDK(wrapped, member), hdk);
});

test('a non-member keypair cannot unwrap the HDK envelope', () => {
  const hdk = crypto.generateHDK();
  const member = crypto.generateIdentityKeyPair();
  const outsider = crypto.generateIdentityKeyPair();
  const wrapped = crypto.wrapHDKForMember(hdk, member.publicKey);
  assert.throws(() => crypto.unwrapHDK(wrapped, outsider));
});

test('public-key fingerprint is stable, key-specific, and human-formatted', () => {
  const a = crypto.generateIdentityKeyPair();
  const b = crypto.generateIdentityKeyPair();
  const fpA = crypto.publicKeyFingerprint(crypto.b64(a.publicKey));
  // Deterministic for the same key, distinct for different keys.
  assert.equal(fpA, crypto.publicKeyFingerprint(crypto.b64(a.publicKey)));
  assert.notEqual(fpA, crypto.publicKeyFingerprint(crypto.b64(b.publicKey)));
  // Six groups of four Crockford-base32 chars, e.g. "K7Q2-M9XR-4T…".
  assert.match(fpA, /^[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){5}$/);
});

test('password factor: recover private key with correct password, reject wrong', () => {
  const kp = crypto.generateIdentityKeyPair();
  const env = crypto.createPasswordFactor(kp.privateKey, 'correct horse battery staple');
  bytesEqual(crypto.openPasswordFactor(env, 'correct horse battery staple'), kp.privateKey);
  assert.throws(() => crypto.openPasswordFactor(env, 'wrong password'));
});

test('recovery-code factor: canonicalization makes formatting irrelevant', () => {
  const kp = crypto.generateIdentityKeyPair();
  const { display, secret } = crypto.generateRecoveryCode();
  assert.match(display, /^[0-9A-Z]{5}(-[0-9A-Z]{1,5})+$/);
  const env = crypto.createSecretFactor('recovery', kp.privateKey, secret);
  // User re-enters the code lowercased, spaced, without dashes → same key.
  const reentered = crypto.recoverySecretFromCode(display.replace(/-/g, ' ').toLowerCase());
  bytesEqual(crypto.openSecretFactor(env, reentered), kp.privateKey);
});

test('passkey-PRF factor: high-entropy secret wraps/unwraps the private key', () => {
  const kp = crypto.generateIdentityKeyPair();
  const prfOutput = _sodium.randombytes_buf(32); // simulated WebAuthn PRF result
  const env = crypto.createSecretFactor('passkey', kp.privateKey, prfOutput);
  bytesEqual(crypto.openSecretFactor(env, prfOutput), kp.privateKey);
  assert.throws(() => crypto.openSecretFactor(env, _sodium.randombytes_buf(32)));
});

test('multiple factors independently recover the same private key', () => {
  const kp = crypto.generateIdentityKeyPair();
  const pw = crypto.createPasswordFactor(kp.privateKey, 'hunter2hunter2');
  const rc = crypto.generateRecoveryCode();
  const rcEnv = crypto.createSecretFactor('recovery', kp.privateKey, rc.secret);
  bytesEqual(crypto.openPasswordFactor(pw, 'hunter2hunter2'), kp.privateKey);
  bytesEqual(crypto.openSecretFactor(rcEnv, rc.secret), kp.privateKey);
  // End-to-end: unlock via a factor, then decrypt a household record.
  const hdk = crypto.generateHDK();
  const wrapped = crypto.wrapHDKForMember(hdk, kp.publicKey);
  const recovered = crypto.openPasswordFactor(pw, 'hunter2hunter2');
  const hdkBack = crypto.unwrapHDK(wrapped, { publicKey: kp.publicKey, privateKey: recovered });
  const env = crypto.encryptRecord(hdk, loc, { title: 'end to end' });
  assert.deepEqual(crypto.decryptRecord(hdkBack, loc, env), { title: 'end to end' });
});

test('file encryption roundtrips multi-chunk content', () => {
  const fileKey = crypto.generateFileKey();
  const chunks = [_sodium.randombytes_buf(4096), _sodium.randombytes_buf(4096), _sodium.randombytes_buf(37)];
  const enc = crypto.encryptFile(fileKey, chunks);
  const whole = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
  let off = 0;
  for (const c of chunks) { whole.set(c, off); off += c.length; }
  bytesEqual(crypto.decryptFile(fileKey, enc), whole);
});

test('empty file still produces a verifiable stream', () => {
  const fileKey = crypto.generateFileKey();
  const enc = crypto.encryptFile(fileKey, []);
  assert.equal(crypto.decryptFile(fileKey, enc).length, 0);
});

test('truncated file is rejected (chunk-count bound in AAD)', () => {
  const fileKey = crypto.generateFileKey();
  const enc = crypto.encryptFile(fileKey, [_sodium.randombytes_buf(64), _sodium.randombytes_buf(64)]);
  const truncated = { v: enc.v, chunks: enc.chunks.slice(0, 1) };
  assert.throws(() => crypto.decryptFile(fileKey, truncated));
});

test('reordered file chunks are rejected (chunk-index bound in AAD)', () => {
  const fileKey = crypto.generateFileKey();
  const enc = crypto.encryptFile(fileKey, [_sodium.randombytes_buf(64), _sodium.randombytes_buf(64)]);
  const swapped = { v: enc.v, chunks: [enc.chunks[1], enc.chunks[0]] };
  assert.throws(() => crypto.decryptFile(fileKey, swapped));
});

test('per-file content key wraps/unwraps under the HDK', () => {
  const hdk = crypto.generateHDK();
  const fileKey = crypto.generateFileKey();
  const fileLoc: RecordLocation = { ...loc, collection: 'Manual' };
  const wrapped = crypto.wrapFileKey(hdk, fileKey, fileLoc);
  bytesEqual(crypto.unwrapFileKey(hdk, wrapped, fileLoc), fileKey);
});

// End-to-end attachment flow (Phase 4c): the exact composition upload/download
// wiring must use. Uploader encrypts the bytes under a fresh per-file key, wraps
// that key to the household HDK, and stores {file, wrappedKey}; a different
// member (holding the same HDK) unwraps the key and recovers the bytes.
test('attachment flow: encrypt+wrap on upload, unwrap+decrypt on another device', () => {
  const hdk = crypto.generateHDK();
  const fileLoc: RecordLocation = { ...loc, collection: 'Manual', id: 'manual-1' };
  const plaintext = _sodium.randombytes_buf(5000); // stand-in for a PDF/photo

  // Uploader side.
  const fileKey = crypto.generateFileKey();
  const stored = {
    file: crypto.encryptFile(fileKey, [plaintext.subarray(0, 4096), plaintext.subarray(4096)]),
    wrappedKey: crypto.wrapFileKey(hdk, fileKey, fileLoc),
  };

  // Downloader side (same household HDK, fresh crypto state).
  const recoveredKey = crypto.unwrapFileKey(hdk, stored.wrappedKey, fileLoc);
  bytesEqual(crypto.decryptFile(recoveredKey, stored.file), plaintext);

  // The wrapped key is AAD-bound to its record: a wrong attachment id fails.
  assert.throws(() => crypto.unwrapFileKey(hdk, stored.wrappedKey, { ...fileLoc, id: 'manual-2' }));
});
