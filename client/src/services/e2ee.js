// Web E2EE session: enrollment + unlock on top of @household/crypto.
//
// Phase 1 scope: on login/register we ensure the account has an identity keypair
// (enroll if not), and hold the unlocked keypair in memory for the session. No
// records are encrypted yet — that arrives in later phases — but this is the
// foundation everything else builds on. The private key is NEVER persisted in
// the browser; a page reload re-unlocks from the password (or the user re-enters
// a factor). See docs/E2EE-SYNC-PLAN.md §3.4 / Phase 1.

import { createEnrollment } from '@household/crypto';
import { loadHouseholdCrypto } from '@household/crypto/adapters/web';
import { keysApi, householdApi } from './api';

let enrollment = null; // memoized createEnrollment(crypto)
let keyPair = null; // in-memory unlocked identity keypair for this session
let hdk = null; // in-memory Household Data Key for this session (Phase 2)
let hdkVersion = 0; // the HDK's key version (bound into record AAD)
let hdkHouseholdId = null; // the household the HDK belongs to (bound into record AAD)

async function getEnrollment() {
  if (enrollment) return enrollment;
  const crypto = await loadHouseholdCrypto();
  enrollment = createEnrollment(crypto);
  return enrollment;
}

export function isUnlocked() {
  return keyPair != null;
}

export function getKeyPair() {
  return keyPair;
}

export function getHDK() {
  return hdk;
}

export function lock() {
  keyPair = null;
  hdk = null;
  hdkVersion = 0;
  hdkHouseholdId = null;
}

// Called after a successful login or register. Returns:
//   { status: 'enrolled', recoveryCode }  — first-time enrollment; SHOW the code once
//   { status: 'unlocked' }                — already enrolled, unlocked with the password
//   { status: 'locked' }                  — enrolled but the password didn't unlock it
//                                            (e.g. password changed without re-wrapping);
//                                            the user must unlock via another factor
export async function ensureEnrolledOnLogin(password) {
  const enroll = await getEnrollment();
  const { data } = await keysApi.me();

  if (!data.enrolled) {
    const result = enroll.enroll(password);
    await keysApi.enroll(result.payload);
    keyPair = result.keyPair;
    return { status: 'enrolled', recoveryCode: result.recoveryCodeDisplay };
  }

  try {
    keyPair = enroll.unlockWithPassword(data, password);
    return { status: 'unlocked' };
  } catch {
    keyPair = null;
    return { status: 'locked' };
  }
}

// Unlock an already-enrolled account from the one-time recovery code (e.g. when
// the password factor is unavailable). Returns true on success.
export async function unlockWithRecoveryCode(code) {
  const enroll = await getEnrollment();
  const { data } = await keysApi.me();
  if (!data.enrolled) return false;
  try {
    keyPair = enroll.unlockWithRecovery(data, code);
    return true;
  } catch {
    return false;
  }
}

// Re-wrap the private key under a new password (call right after a successful
// password change) so the new password can unlock the account. No-op if locked.
export async function rewrapForNewPassword(newPassword) {
  if (!keyPair) return false;
  const enroll = await getEnrollment();
  const envelope = enroll.rewrapPassword(keyPair.privateKey, newPassword);
  await keysApi.putFactor(envelope);
  return true;
}

// Mint a fresh recovery code (invalidates the previous one). Returns the code to
// show once, or null if locked.
export async function regenerateRecoveryCode() {
  if (!keyPair) return null;
  const enroll = await getEnrollment();
  const { factor, display } = enroll.regenerateRecoveryCode(keyPair.privateKey);
  await keysApi.putFactor(factor);
  return display;
}

// ── Household Data Key (HDK) — Phase 2 ───────────────────────────────────────
// After the identity keypair is unlocked, make sure this session holds the HDK:
//   - if the server already has an envelope for me, unwrap it;
//   - else if I own a household with no key yet, mint HDK v1 and self-wrap it
//     (the owner-mints-lazily-on-first-unlock model — every household is founded
//     solo, so the founder mints its key);
//   - else I'm a member/joiner without an envelope yet → stay keyless until a
//     family member approves me (approve-on-device).
// Returns the resulting status. See docs/E2EE-SYNC-PLAN.md §5.
export async function ensureHouseholdKey() {
  if (!keyPair) return 'locked';
  if (hdk) return 'ready';
  const crypto = await loadHouseholdCrypto();
  const { data } = await householdApi.getKey();

  hdkHouseholdId = data.householdId || null;
  const current = data.currentKeyVersion || 0;
  const mine = (data.envelopes || []).find((e) => e.keyVersion === current);
  if (current > 0 && mine) {
    hdk = crypto.unwrapHDK(mine.wrappedHDK, keyPair);
    hdkVersion = current;
    return 'ready';
  }
  if (current === 0 && data.isOwner) {
    const fresh = crypto.generateHDK();
    await householdApi.mintKey({ wrappedHDK: crypto.wrapHDKForMember(fresh, keyPair.publicKey), keyVersion: 1 });
    hdk = fresh;
    hdkVersion = 1;
    return 'ready';
  }
  return 'pending'; // enrolled + unlocked, but no HDK envelope for me yet
}

// ── Record encryption (Phase 3 dual-write) ───────────────────────────────────
// A client-minted Mongo ObjectId, so a new encrypted record's AAD can bind to
// its _id before the server round-trip. 4-byte time + 8 random bytes as hex.
export function newObjectId() {
  const ts = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
  const rand = Array.from(randomBytes(8), (b) => b.toString(16).padStart(2, '0')).join('');
  return ts + rand;
}

// Encrypt a record's content for storage. Returns { enc, keyVersion } to send
// alongside the plaintext payload, or null if this session holds no HDK. The AAD
// binds the ciphertext to (collection, id, household, keyVersion).
export async function encryptRecord(collection, id, fields) {
  if (!hdk || !hdkHouseholdId) return null;
  const c = await loadHouseholdCrypto();
  const loc = { collection, id, householdId: String(hdkHouseholdId), keyVersion: hdkVersion };
  return { enc: c.encryptRecord(hdk, loc, fields), keyVersion: hdkVersion };
}

// Decrypt a record's `enc` blob back to its fields, or null if we can't (no HDK,
// no blob, or an AAD/version mismatch — the caller falls back to plaintext).
export async function decryptRecord(collection, id, keyVersion, enc) {
  if (!hdk || !hdkHouseholdId || !enc) return null;
  const c = await loadHouseholdCrypto();
  const loc = { collection, id, householdId: String(hdkHouseholdId), keyVersion: keyVersion ?? hdkVersion };
  try {
    return c.decryptRecord(hdk, loc, enc);
  } catch {
    return null;
  }
}

// ── Dual-write convenience wrappers (one-liners for content forms) ────────────
// `fields` is the content subset to encrypt (defaults to the whole payload). Pass
// a subset for records whose plaintext carries populated refs or server-scheduled
// dates, so decrypt-on-load can safely merge without clobbering them.
// Augment a create payload with a client-minted _id + ciphertext, or return it
// unchanged when this session holds no HDK (so saving is never blocked).
export async function sealNew(collection, payload, fields) {
  const _id = newObjectId();
  const sealed = await encryptRecord(collection, _id, fields ?? payload);
  return sealed ? { _id, ...payload, ...sealed } : payload;
}
// Augment an update payload with re-encrypted ciphertext at the current version.
export async function sealUpdate(collection, id, payload, fields) {
  const sealed = await encryptRecord(collection, id, fields ?? payload);
  return sealed ? { ...payload, ...sealed } : payload;
}
// Return a fetched record with its decrypted content merged over the plaintext
// (falls back to the plaintext the server returned when we can't decrypt).
export async function openRecord(collection, record) {
  if (!record) return record;
  const dec = await decryptRecord(collection, record._id, record.keyVersion, record.enc);
  return dec ? { ...record, ...dec } : record;
}

// A short, human-comparable fingerprint of a public key, for out-of-band
// verification of a join requester before approving them.
export async function publicKeyFingerprint(publicKeyB64) {
  const crypto = await loadHouseholdCrypto();
  return crypto.publicKeyFingerprint(publicKeyB64);
}

// Approve a join request: wrap this session's HDK to the requester's public key.
// The caller passes the request's pinned public key + version; the result is
// POSTed to /household/join-requests/:id/approve. Returns null if we hold no HDK.
export async function wrapHDKForJoiner(requesterPublicKeyB64, keyVersion) {
  if (!hdk) return null;
  const crypto = await loadHouseholdCrypto();
  return {
    wrappedHDK: crypto.wrapHDKForMember(hdk, crypto.unb64(requesterPublicKeyB64)),
    keyVersion,
  };
}

// ── Attachment encryption (Phase 4c) ─────────────────────────────────────────
// Encrypt raw file bytes with a fresh per-file key, wrap that key to the HDK
// (AAD-bound to the owning record), and return the serialized ciphertext + the
// wrapped key to upload. Returns null if this session holds no HDK.
const ATTACH_CHUNK = 1024 * 1024; // 1 MiB chunks
export async function encryptAttachment(collection, id, bytes) {
  if (!hdk || !hdkHouseholdId) return null;
  const c = await loadHouseholdCrypto();
  const loc = { collection, id, householdId: String(hdkHouseholdId), keyVersion: hdkVersion };
  const fileKey = c.generateFileKey();
  const chunks = [];
  for (let o = 0; o < bytes.length; o += ATTACH_CHUNK) chunks.push(bytes.subarray(o, Math.min(o + ATTACH_CHUNK, bytes.length)));
  return {
    fileText: JSON.stringify(c.encryptFile(fileKey, chunks)),
    wrappedKey: JSON.stringify(c.wrapFileKey(hdk, fileKey, loc)),
    keyVersion: hdkVersion,
  };
}
// Reverse: unwrap the file key and decrypt the downloaded ciphertext to bytes.
export async function decryptAttachment(collection, id, keyVersion, wrappedKeyStr, fileText) {
  if (!hdk || !hdkHouseholdId) return null;
  const c = await loadHouseholdCrypto();
  const loc = { collection, id, householdId: String(hdkHouseholdId), keyVersion: keyVersion ?? hdkVersion };
  const fileKey = c.unwrapFileKey(hdk, JSON.parse(wrappedKeyStr), loc);
  return c.decryptFile(fileKey, JSON.parse(fileText));
}

// ── Passkey / WebAuthn-PRF factor (progressive — decision D1) ────────────────
// A passkey unlocks data only via the PRF (hmac-secret) extension, which yields
// a stable per-credential secret we use as a KEK. PRF support is uneven across
// platforms, so this is an *additional* factor offered where available, never
// the sole one. See docs/E2EE-SYNC-PLAN.md §1.1.

const RP_NAME = 'Household Calendar';

export function passkeySupported() {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}

function randomBytes(n) {
  const b = new Uint8Array(n);
  (window.crypto || globalThis.crypto).getRandomValues(b);
  return b;
}

// Enroll a passkey as an unlock factor. Requires the account to be unlocked (we
// wrap the in-memory private key). Returns { enrolled, reason }.
export async function enrollPasskey(user) {
  if (!keyPair) return { enrolled: false, reason: 'locked' };
  if (!passkeySupported()) return { enrolled: false, reason: 'unsupported' };
  const crypto = await loadHouseholdCrypto();

  // Create a platform credential that advertises the PRF extension.
  const created = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: RP_NAME, id: window.location.hostname },
      user: {
        // Stable ≤64-byte handle for this account (WebAuthn requires a user.id).
        id: new TextEncoder().encode(String(user?._id || user?.email || 'user')).slice(0, 64),
        name: user?.email || 'user',
        displayName: user?.firstName || user?.email || 'You',
      },
      pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
      authenticatorSelection: { residentKey: 'preferred', userVerification: 'preferred' },
      extensions: { prf: {} },
    },
  });
  if (!created) return { enrolled: false, reason: 'cancelled' };
  if (created.getClientExtensionResults()?.prf?.enabled === false) {
    return { enrolled: false, reason: 'no-prf' };
  }

  // Derive the PRF secret for a fresh random salt (stored with the factor so we
  // can re-derive the same secret on future unlocks).
  const prfSalt = randomBytes(32);
  const secret = await evalPrf([{ id: created.rawId }], prfSalt);
  if (!secret) return { enrolled: false, reason: 'no-prf' };

  const factor = crypto.createSecretFactor('passkey', keyPair.privateKey, secret);
  factor.credentialId = crypto.b64(new Uint8Array(created.rawId));
  factor.prfSalt = crypto.b64(prfSalt);
  await keysApi.putFactor(factor);
  return { enrolled: true };
}

// Run a WebAuthn assertion with a PRF eval and return the 32-byte secret.
async function evalPrf(allowCredentials, prfSaltBytes) {
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: allowCredentials.map((c) => ({ type: 'public-key', id: c.id })),
      userVerification: 'preferred',
      extensions: { prf: { eval: { first: prfSaltBytes } } },
    },
  });
  const first = assertion?.getClientExtensionResults()?.prf?.results?.first;
  return first ? new Uint8Array(first) : null;
}

// Unlock an enrolled account with a passkey. Returns true on success.
export async function unlockWithPasskey() {
  if (!passkeySupported()) return false;
  const enroll = await getEnrollment();
  const crypto = await loadHouseholdCrypto();
  const { data } = await keysApi.me();
  const passkeys = (data.wrappedPrivateKey || []).filter((f) => f.factor === 'passkey');
  if (!data.enrolled || !passkeys.length) return false;

  // Try each enrolled passkey with its own PRF salt.
  for (const f of passkeys) {
    try {
      const secret = await evalPrf([{ id: crypto.unb64(f.credentialId) }], crypto.unb64(f.prfSalt));
      if (!secret) continue;
      keyPair = { publicKey: crypto.unb64(data.identityPublicKey), privateKey: crypto.openSecretFactor(f, secret) };
      return true;
    } catch { /* try the next credential */ }
  }
  return false;
}
