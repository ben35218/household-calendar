// Signal-parity F4 — QR device linking handshake tests.
//
// The handshake reuses the anonymous-sealed-box primitive (crypto_box_seal over a
// C1-padded JSON payload): the NEW device makes a one-shot ephemeral keypair, the
// existing UNLOCKED device seals the account secret to the ephemeral PUBLIC key,
// and only the ephemeral PRIVATE key (held on the new device) opens it. These
// tests pin exactly that: a correct round-trip, and that no other keypair — nor
// the ephemeral public key alone — can open the sealed handoff.

import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHouseholdCrypto } from './core.ts';
import type { Sodium } from './index.ts';

const require = createRequire(import.meta.url);
const _sodium = require('libsodium-wrappers-sumo');
await _sodium.ready;
const crypto = createHouseholdCrypto(_sodium as unknown as Sodium);

const bytesEqual = (a: Uint8Array, b: Uint8Array) => assert.deepEqual([...a], [...b]);

test('F4: an existing device seals the identity keypair to the new device’s ephemeral key', () => {
  // The account secret handed to a linked device = its identity keypair (b64).
  const identity = crypto.generateIdentityKeyPair();
  const handoff = { pub: crypto.b64(identity.publicKey), priv: crypto.b64(identity.privateKey) };

  // New device: one-shot ephemeral keypair; only its PUBLIC key goes in the QR.
  const ephemeral = crypto.generateLinkKeyPair();
  const sealed = crypto.sealLinkPayload(handoff, ephemeral.publicKey); // existing device seals

  // New device opens with its ephemeral keypair → recovers the identity keypair.
  const opened = crypto.openLinkPayload<typeof handoff>(sealed, ephemeral);
  bytesEqual(crypto.unb64(opened.pub), identity.publicKey);
  bytesEqual(crypto.unb64(opened.priv), identity.privateKey);
});

test('F4: a different ephemeral keypair cannot open the sealed handoff', () => {
  const ephemeral = crypto.generateLinkKeyPair();
  const attacker = crypto.generateLinkKeyPair();
  const sealed = crypto.sealLinkPayload({ priv: 'secret' }, ephemeral.publicKey);
  assert.throws(() => crypto.openLinkPayload(sealed, attacker));
});

test('F4: the ephemeral public key alone (as seen in the QR) cannot open the payload', () => {
  // Sealing to a public key is anonymous — knowledge of the public key does NOT
  // grant the ability to open, so a bystander who photographs the QR learns nothing.
  const ephemeral = crypto.generateLinkKeyPair();
  const sealed = crypto.sealLinkPayload({ priv: 'secret' }, ephemeral.publicKey);
  const publicOnly = { publicKey: ephemeral.publicKey, privateKey: new Uint8Array(32) };
  assert.throws(() => crypto.openLinkPayload(sealed, publicOnly));
});
