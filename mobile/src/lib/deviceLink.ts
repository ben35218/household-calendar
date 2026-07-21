// Signal-parity F4 — QR device linking (client flows).
//
// Gives a second device the account's E2EE keys without the recovery code: the
// NEW (locked) device shows a QR with a one-shot ephemeral public key; an existing
// UNLOCKED device scans it and seals the identity keypair to that key; the server
// only ferries the opaque ciphertext (routes in server/src/routes/keys.js). This
// module wraps the two device roles over @household/crypto + keysApi + e2ee.
//
// Trust model (matches Signal's linked devices): the ephemeral public key travels
// out-of-band in the QR (never via the server), so a malicious server can't MITM
// the handshake; the user confirms the same fingerprint on both screens before the
// existing device seals. Sealing is an anonymous sealed box, so a bystander who
// photographs the QR learns nothing (they'd need the ephemeral PRIVATE key, which
// never leaves the new device). See docs/SIGNAL-PARITY-PLAN.md §F4.

import { loadHouseholdCrypto } from '@household/crypto/adapters/native';
import type { IdentityKeyPair } from '@household/crypto';
import { keysApi } from '../api';
import { getKeyPair, importLinkedKeyPair } from './e2ee';

// The QR payload — kept tiny and versioned. `epk` is base64url; `id` is the relay
// slot. Nothing secret is in here (the ephemeral key is public by design).
interface LinkQrPayload {
  v: 1;
  id: string;   // linkId (relay slot)
  epk: string;  // ephemeral public key (b64url)
}

// The new device holds its one-shot ephemeral keypair here across the poll loop.
// Cleared once linking completes (or a fresh link starts).
let ephemeral: IdentityKeyPair | null = null;
let ephemeralLinkId: string | null = null;

// ── New device (shows the QR, polls for the sealed handoff) ─────────────────

export interface StartedLink {
  linkId: string;
  qr: string;          // JSON string to render as a QR code
  fingerprint: string; // shown under the QR; the other device shows the same one
  expiresAt: string;
}

// Open a link session: mint the ephemeral keypair, register the relay slot, and
// return the QR payload + a fingerprint to compare out loud.
export async function startLink(deviceName?: string): Promise<StartedLink> {
  const crypto = await loadHouseholdCrypto();
  ephemeral = crypto.generateLinkKeyPair();
  const ephemeralPublicKey = crypto.b64(ephemeral.publicKey);
  const { data } = await keysApi.linkStart({ ephemeralPublicKey, deviceName });
  ephemeralLinkId = data.linkId;
  const payload: LinkQrPayload = { v: 1, id: data.linkId, epk: ephemeralPublicKey };
  return {
    linkId: data.linkId,
    qr: JSON.stringify(payload),
    fingerprint: crypto.publicKeyFingerprint(ephemeralPublicKey),
    expiresAt: data.expiresAt,
  };
}

// Poll the relay once. Returns 'pending' until the existing device seals, then
// opens the handoff locally and imports the keypair → 'linked'. 'expired' when the
// slot is gone. Safe to call on an interval.
export async function pollLink(linkId: string): Promise<'pending' | 'linked' | 'expired'> {
  if (!ephemeral || ephemeralLinkId !== linkId) return 'expired';
  let res;
  try {
    res = await keysApi.linkPoll(linkId);
  } catch (e: any) {
    if (e?.response?.status === 404) return 'expired';
    return 'pending'; // transient network error — keep polling
  }
  if (res.data.status !== 'sealed' || !res.data.sealedPayload) return 'pending';
  const crypto = await loadHouseholdCrypto();
  const handoff = crypto.openLinkPayload<{ pub: string; priv: string }>(res.data.sealedPayload, ephemeral);
  await importLinkedKeyPair(handoff.pub, handoff.priv);
  ephemeral = null;
  ephemeralLinkId = null;
  return 'linked';
}

// ── Existing device (scans the QR, seals the handoff) ───────────────────────

// Parse a scanned QR string into its slot + ephemeral key, or null if it isn't a
// device-link code.
export function parseLinkQr(text: string): { linkId: string; epk: string } | null {
  try {
    const p = JSON.parse(text) as Partial<LinkQrPayload>;
    if (p?.v === 1 && typeof p.id === 'string' && typeof p.epk === 'string') {
      return { linkId: p.id, epk: p.epk };
    }
  } catch { /* not our QR */ }
  return null;
}

// The fingerprint of a scanned ephemeral key — shown so the user confirms it
// matches the one under the QR on the new device before sealing.
export async function fingerprintOf(epk: string): Promise<string> {
  const crypto = await loadHouseholdCrypto();
  return crypto.publicKeyFingerprint(epk);
}

// Seal this (unlocked) device's identity keypair to the scanned ephemeral key and
// post it to the relay. Throws if the vault is locked (nothing to hand over).
export async function completeLink(linkId: string, epk: string): Promise<void> {
  const kp = getKeyPair();
  if (!kp) throw new Error('Unlock this device before linking another.');
  const crypto = await loadHouseholdCrypto();
  const handoff = { pub: crypto.b64(kp.publicKey), priv: crypto.b64(kp.privateKey) };
  const sealedPayload = crypto.sealLinkPayload(handoff, crypto.unb64(epk));
  await keysApi.linkComplete({ linkId, sealedPayload });
}
