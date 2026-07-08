// Mobile E2EE session: enrollment + unlock on top of @household/crypto.
//
// Phase 1 mirror of client/src/services/e2ee.js. On login/register we ensure the
// account has an identity keypair (enroll if not) and hold the unlocked keypair
// in memory for the session. The private key is NEVER persisted to disk here — a
// relaunch re-unlocks from the password (later phases add a passkey/biometric
// path). A tiny subscriber store surfaces the one-time recovery code to a modal,
// matching the pattern in lib/privacyPrefs.ts. See docs/E2EE-SYNC-PLAN.md §3.4.

import { createEnrollment, type StoredKeyMaterial, type IdentityKeyPair, type RecordEnvelope } from '@household/crypto';
import { loadHouseholdCrypto } from '@household/crypto/adapters/native';
import { keysApi, householdApi, type HDKEnvelopePayload } from '../api';

let enrollment: Awaited<ReturnType<typeof buildEnrollment>> | null = null;
let keyPair: IdentityKeyPair | null = null;
// Every HDK version this session can unwrap, keyed by version. Under lazy
// rotation (§5.2) records sealed before a rotation stay at their old version, so
// we must keep old HDKs to read them while writing new records under the current
// version. `hdkVersion` is the *current* (write) version.
const hdks = new Map<number, Uint8Array>();
let hdkVersion = 0; // the current HDK version (bound into new-record AAD)
let hdkHouseholdId: string | null = null; // the household the HDK belongs to (bound into record AAD)

function currentHDK(): Uint8Array | null {
  return hdks.get(hdkVersion) ?? null;
}

// One-time recovery code + subscribers (so a root modal can display it once).
let pendingRecoveryCode: string | null = null;
const subs = new Set<() => void>();
function emit() { subs.forEach((fn) => fn()); }

export function subscribeRecoveryCode(fn: () => void): () => void {
  subs.add(fn);
  return () => subs.delete(fn);
}
export function getPendingRecoveryCode(): string | null {
  return pendingRecoveryCode;
}
export function clearRecoveryCode() {
  pendingRecoveryCode = null;
  emit();
}

async function buildEnrollment() {
  const crypto = await loadHouseholdCrypto();
  return createEnrollment(crypto);
}
async function getEnrollment() {
  if (!enrollment) enrollment = await buildEnrollment();
  return enrollment;
}

export function isUnlocked(): boolean {
  return keyPair != null;
}
export function getKeyPair(): IdentityKeyPair | null {
  return keyPair;
}
export function getHDK(): Uint8Array | null {
  return currentHDK();
}
export function lock() {
  keyPair = null;
  hdks.clear();
  hdkVersion = 0;
  hdkHouseholdId = null;
}

// ── Household Data Key (HDK) — Phase 2 ───────────────────────────────────────
// Mirrors client/src/services/e2ee.js ensureHouseholdKey: unwrap my envelope, or
// (if I own a keyless household) mint HDK v1 and self-wrap, or stay keyless until
// a family member approves me. See docs/E2EE-SYNC-PLAN.md §5.
export async function ensureHouseholdKey(): Promise<'locked' | 'ready' | 'pending'> {
  if (!keyPair) return 'locked';
  const crypto = await loadHouseholdCrypto();
  const { data } = await householdApi.getKey();
  const householdId = data.householdId || null;
  const current = data.currentKeyVersion || 0;

  // Household changed under us (left/joined/deleted) → drop every cached version
  // so we don't decrypt against an orphaned HDK or skip minting a fresh key.
  if (hdkHouseholdId !== householdId) {
    hdks.clear();
    hdkVersion = 0;
    hdkHouseholdId = householdId;
  }

  // Unwrap every envelope we don't already hold — including older versions — so a
  // record sealed before a rotation stays decryptable.
  for (const e of data.envelopes || []) {
    if (!hdks.has(e.keyVersion)) {
      try { hdks.set(e.keyVersion, crypto.unwrapHDK(e.wrappedHDK, keyPair)); } catch { /* skip a bad envelope */ }
    }
  }

  if (current > 0 && hdks.has(current)) {
    hdkVersion = current;
    // A departed member left this household keyed for rotation (§5.2). Drive it
    // now, best-effort — a concurrent rotation by another member just 409s and
    // we pick up their new envelope on the next call.
    if (data.keyRotationPending) { try { await rotateHouseholdKey(); } catch { /* non-fatal */ } }
    return 'ready';
  }
  if (current === 0 && data.isOwner) {
    const fresh = crypto.generateHDK();
    await householdApi.mintKey({ wrappedHDK: crypto.wrapHDKForMember(fresh, keyPair.publicKey), keyVersion: 1 });
    hdks.set(1, fresh);
    hdkVersion = 1;
    return 'ready';
  }
  return 'pending';
}

// §5.2 lazy rotation: mint a fresh HDK for the next version and wrap it to every
// current member, so a removed/departed member can't read future writes. Old
// versions stay in the map for reading historical records. Self-healing —
// invoked from ensureHouseholdKey when the server flags keyRotationPending.
export async function rotateHouseholdKey(): Promise<boolean> {
  if (!keyPair || !hdkHouseholdId || !hdks.has(hdkVersion)) return false;
  const crypto = await loadHouseholdCrypto();
  const nextVersion = hdkVersion + 1;
  const { data: members } = await householdApi.memberKeys();
  if (!members.length) return false;
  const fresh = crypto.generateHDK();
  const envelopes = members.map((m) => ({
    userId: m.userId,
    wrappedHDK: crypto.wrapHDKForMember(fresh, crypto.unb64(m.identityPublicKey)),
  }));
  try {
    const { data } = await householdApi.rotateKey({ keyVersion: nextVersion, envelopes });
    hdks.set(data.keyVersion, fresh);
    hdkVersion = data.keyVersion;
    return true;
  } catch {
    return false;
  }
}

// ── Record encryption (Phase 3 dual-write) ───────────────────────────────────
// A client-minted Mongo ObjectId so a new encrypted record's AAD can bind to its
// _id before the server round-trip. 4-byte time + 8 random bytes as hex.
export async function newObjectId(): Promise<string> {
  const crypto = await loadHouseholdCrypto();
  const ts = Math.floor(Date.now() / 1000).toString(16).padStart(8, '0');
  const rand = Array.from(crypto.randomBytes(8), (b) => b.toString(16).padStart(2, '0')).join('');
  return ts + rand;
}

// Encrypt a record's content. Returns { enc, keyVersion } to send alongside the
// plaintext payload, or null if this session holds no HDK. See §3.2.
export async function encryptRecord(
  collection: string,
  id: string,
  fields: unknown,
): Promise<{ enc: RecordEnvelope; keyVersion: number } | null> {
  const hdk = currentHDK();
  if (!hdk || !hdkHouseholdId) return null;
  const crypto = await loadHouseholdCrypto();
  const loc = { collection, id, householdId: String(hdkHouseholdId), keyVersion: hdkVersion };
  return { enc: crypto.encryptRecord(hdk, loc, fields), keyVersion: hdkVersion };
}

// Decrypt a record's `enc` blob back to its fields, or null if we can't (no HDK,
// no blob, or an AAD/version mismatch — the caller falls back to plaintext).
export async function decryptRecord<T = Record<string, unknown>>(
  collection: string,
  id: string,
  keyVersion: number | undefined,
  enc: { alg: string; nonce: string; ct: string } | undefined | null,
): Promise<T | null> {
  if (!hdkHouseholdId || !enc) return null;
  const version = keyVersion ?? hdkVersion;
  const hdk = hdks.get(version);
  if (!hdk) return null;
  const crypto = await loadHouseholdCrypto();
  const loc = { collection, id, householdId: String(hdkHouseholdId), keyVersion: version };
  try {
    return crypto.decryptRecord<T>(hdk, loc, enc as RecordEnvelope);
  } catch {
    return null;
  }
}

// ── Dual-write convenience wrappers (one-liners for content forms) ────────────
type Rec = Record<string, unknown>;
// `fields` is the content subset to encrypt (defaults to the whole payload). Pass
// a subset for records whose plaintext carries populated refs or server-scheduled
// dates, so decrypt-on-load can safely merge without clobbering them.
// Augment a create payload with a client-minted _id + ciphertext, or return it
// unchanged when this session holds no HDK (so saving is never blocked).
export async function sealNew(collection: string, payload: Rec, fields?: Rec): Promise<Rec> {
  const _id = await newObjectId();
  const sealed = await encryptRecord(collection, _id, fields ?? payload);
  return sealed ? { _id, ...payload, ...sealed } : payload;
}
// Augment an update payload with re-encrypted ciphertext at the current version.
export async function sealUpdate(collection: string, id: string, payload: Rec, fields?: Rec): Promise<Rec> {
  const sealed = await encryptRecord(collection, id, fields ?? payload);
  return sealed ? { ...payload, ...sealed } : payload;
}
// Return a fetched record with its decrypted content merged over the plaintext
// (falls back to the plaintext the server returned when we can't decrypt).
export async function openRecord<T extends { _id: string; keyVersion?: number; enc?: { alg: string; nonce: string; ct: string } }>(
  collection: string,
  record: T,
): Promise<T> {
  if (!record) return record;
  const dec = await decryptRecord<Partial<T>>(collection, record._id, record.keyVersion, record.enc);
  return dec ? ({ ...record, ...dec } as T) : record;
}

// ── Attachment encryption (Phase 4c) ─────────────────────────────────────────
// Encrypt file bytes for `collection`/`id`: a fresh per-file key encrypts the
// bytes (chunked AEAD), and that key is HDK-wrapped bound to the record. Returns
// the serialized ciphertext to upload + the wrapped key (JSON string) + version,
// or null if this session holds no HDK. Mirrors the web `encryptAttachment`.
const ATTACH_CHUNK = 1024 * 1024; // 1 MiB chunks

export async function encryptAttachment(
  collection: string,
  id: string,
  bytes: Uint8Array,
): Promise<{ ciphertext: Uint8Array; wrappedFileKey: string; keyVersion: number } | null> {
  const hdk = currentHDK();
  if (!hdk || !hdkHouseholdId) return null;
  const crypto = await loadHouseholdCrypto();
  const loc = { collection, id, householdId: String(hdkHouseholdId), keyVersion: hdkVersion };
  const fileKey = crypto.generateFileKey();
  const chunks: Uint8Array[] = [];
  for (let i = 0; i < bytes.length; i += ATTACH_CHUNK) chunks.push(bytes.subarray(i, i + ATTACH_CHUNK));
  const enc = crypto.encryptFile(fileKey, chunks);
  const wrapped = crypto.wrapFileKey(hdk, fileKey, loc);
  return {
    ciphertext: new TextEncoder().encode(JSON.stringify(enc)),
    wrappedFileKey: JSON.stringify(wrapped),
    keyVersion: hdkVersion,
  };
}

// Reverse of encryptAttachment: unwrap the file key (picking the right HDK
// version) and decrypt the serialized ciphertext back to the original bytes, or
// null if we can't (no HDK for that version, malformed blob).
export async function decryptAttachment(
  collection: string,
  id: string,
  keyVersion: number | undefined,
  wrappedFileKey: string,
  ciphertext: Uint8Array,
): Promise<Uint8Array | null> {
  if (!hdkHouseholdId) return null;
  const version = keyVersion ?? hdkVersion;
  const hdk = hdks.get(version);
  if (!hdk) return null;
  const crypto = await loadHouseholdCrypto();
  const loc = { collection, id, householdId: String(hdkHouseholdId), keyVersion: version };
  try {
    const fileKey = crypto.unwrapFileKey(hdk, JSON.parse(wrappedFileKey), loc);
    const enc = JSON.parse(new TextDecoder().decode(ciphertext));
    return crypto.decryptFile(fileKey, enc);
  } catch {
    return null;
  }
}

// Human-comparable fingerprint of a public key, for out-of-band verification.
export async function publicKeyFingerprint(publicKeyB64: string): Promise<string> {
  const crypto = await loadHouseholdCrypto();
  return crypto.publicKeyFingerprint(publicKeyB64);
}

// Wrap this session's HDK to a join requester's public key (approver path).
export async function wrapHDKForJoiner(
  requesterPublicKeyB64: string,
  keyVersion: number,
): Promise<HDKEnvelopePayload | null> {
  const hdk = currentHDK();
  if (!hdk) return null;
  const crypto = await loadHouseholdCrypto();
  return {
    wrappedHDK: crypto.wrapHDKForMember(hdk, crypto.unb64(requesterPublicKeyB64)),
    keyVersion,
  };
}

// Called after a successful login/register. Enrolls on first use (raising the
// one-time recovery code) or unlocks the existing keypair with the password.
// Returns the resulting status; 'locked' means the password didn't unlock it and
// the user must use another factor.
export async function ensureEnrolledOnLogin(
  password: string,
): Promise<'enrolled' | 'unlocked' | 'locked'> {
  const enroll = await getEnrollment();
  const { data } = await keysApi.me();

  if (!data.enrolled) {
    const result = enroll.enroll(password);
    await keysApi.enroll(result.payload);
    keyPair = result.keyPair;
    pendingRecoveryCode = result.recoveryCodeDisplay;
    emit();
    return 'enrolled';
  }

  const material = data as unknown as StoredKeyMaterial;
  try {
    keyPair = enroll.unlockWithPassword(material, password);
    return 'unlocked';
  } catch {
    keyPair = null;
    return 'locked';
  }
}

export async function unlockWithRecoveryCode(code: string): Promise<boolean> {
  const enroll = await getEnrollment();
  const { data } = await keysApi.me();
  if (!data.enrolled) return false;
  try {
    keyPair = enroll.unlockWithRecovery(data as unknown as StoredKeyMaterial, code);
    return true;
  } catch {
    return false;
  }
}

// Re-wrap under a new password (call right after a password change).
export async function rewrapForNewPassword(newPassword: string): Promise<boolean> {
  if (!keyPair) return false;
  const enroll = await getEnrollment();
  await keysApi.putFactor(enroll.rewrapPassword(keyPair.privateKey, newPassword));
  return true;
}

// Mint a fresh recovery code (invalidates the previous one) and surface it via
// the one-time modal (subscriber store). Returns the code, or null if locked.
export async function regenerateRecoveryCode(): Promise<string | null> {
  if (!keyPair) return null;
  const enroll = await getEnrollment();
  const { factor, display } = enroll.regenerateRecoveryCode(keyPair.privateKey);
  await keysApi.putFactor(factor);
  pendingRecoveryCode = display;
  emit();
  return display;
}
