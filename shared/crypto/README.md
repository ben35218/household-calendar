# @household/crypto

Shared end-to-end-encryption primitives for Household Calendar, used by the web
client, admin app, and mobile app. See [`docs/E2EE-SYNC-PLAN.md`](../../docs/E2EE-SYNC-PLAN.md)
for the full design.

**Phase 0 (crypto foundation) — implemented and tested.** No product surface is
wired to this yet; that begins in Phase 1 (key management).

## Design in one paragraph

One platform-agnostic core (`src/core.ts`) over a dependency-injected libsodium
instance, plus thin per-platform adapters. There is exactly one audited crypto
implementation; only the libsodium binding differs:

- **web / admin** → `adapters/web.ts` (`libsodium-wrappers-sumo`, WASM)
- **mobile** → `adapters/native.ts` (`react-native-libsodium`, JSI; needs an Expo dev/prebuild client)

The `-sumo` build is required on web for Argon2id (`crypto_pwhash`), which the
base libsodium-wrappers build omits.

## Key hierarchy

```
per-user X25519 identity keypair
  └─ private key stored server-side only as ciphertext, wrapped INDEPENDENTLY by
     each enrolled factor (any one decrypts it):
       • password  → Argon2id KEK      (baseline, always present)
       • passkey   → WebAuthn PRF KEK  (progressive; where the platform supports PRF)
       • recovery  → one-time code KEK
per-household symmetric HDK (versioned)
  └─ sealed-boxed (crypto_box_seal) to each member's public key  → HouseholdKeyEnvelope
  └─ encrypts records (XChaCha20-Poly1305, AAD-bound to record slot + key version)
  └─ wraps per-file content keys; files streamed via secretstream
```

## Primitives

| Purpose | libsodium primitive |
|---|---|
| Identity keypair / HDK envelopes | X25519 `crypto_box_seal` (anonymous sealed box) |
| Record & file-key AEAD | XChaCha20-Poly1305 IETF (24-byte nonce, AAD = `collection id householdId keyVersion`) |
| Private-key-at-rest wrapping | `crypto_secretbox` under a per-factor KEK |
| Password KEK | Argon2id (`crypto_pwhash`, MODERATE) |
| Recovery / passkey-PRF KEK | `crypto_generichash` over the high-entropy secret |
| File/attachment bytes | chunked XChaCha20-Poly1305 (each chunk `nonce\|\|ct`, index+count bound as AAD → tamper/truncation/reorder-detecting) |

> Portability: the core uses only primitives present in **both** `libsodium-wrappers-sumo` (web) and `react-native-libsodium` (mobile). UTF-8 is done via `TextEncoder`/`TextDecoder` and files via chunked AEAD, because react-native-libsodium ships neither `from_string`/`to_string` nor `crypto_secretstream`.

## Usage

```ts
import { loadHouseholdCrypto } from '@household/crypto/adapters/web'; // or /native

const crypto = await loadHouseholdCrypto();

// Enroll: identity keypair + factor envelopes (stored server-side as ciphertext).
const kp = crypto.generateIdentityKeyPair();
const passwordFactor = crypto.createPasswordFactor(kp.privateKey, userPassword);
const recovery = crypto.generateRecoveryCode();            // show recovery.display ONCE
const recoveryFactor = crypto.createSecretFactor('recovery', kp.privateKey, recovery.secret);

// Household: create + wrap the HDK to a member's public key.
const hdk = crypto.generateHDK();
const envelope = crypto.wrapHDKForMember(hdk, kp.publicKey); // → HouseholdKeyEnvelope.wrappedHDK

// Records: encrypt/decrypt with location binding.
const loc = { collection: 'CalendarEvent', id, householdId, keyVersion: 1 };
const enc = crypto.encryptRecord(hdk, loc, { title: 'Dentist', startDate });
const back = crypto.decryptRecord(hdk, loc, enc);

// Unlock later: recover the private key from any factor, then the HDK.
const priv = crypto.openPasswordFactor(passwordFactor, userPassword);
const hdkAgain = crypto.unwrapHDK(envelope, { publicKey: kp.publicKey, privateKey: priv });
```

## Tests

```
npm install
npm test        # node:test runner (Node 26 runs the TS directly)
```

14 tests cover record/file roundtrips, AAD location binding, tamper &
truncation rejection, sealed-box HDK envelopes, all three factor types, and
multi-factor independent recovery.
