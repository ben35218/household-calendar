const mongoose = require('mongoose');
const crypto = require('crypto');

// Signal-parity F4 — QR device-linking relay slot.
//
// A NEW device (already signed in to the account, but with a LOCKED E2EE vault)
// opens a link session and shows a QR carrying a one-shot ephemeral X25519 public
// key. An existing UNLOCKED device scans it and seals the account secret (the
// identity keypair) to that ephemeral key. The server is a blind relay: it only
// ferries the opaque `sealedPayload` ciphertext between the two devices — it can
// no more read it than it can read an HDK envelope. Both sides authenticate as the
// SAME account, and the slot is short-lived + single-use.
//
// The `ephemeralPublicKey` stored here is the new device's own record only; the
// sealing device uses the key it SCANNED from the QR (an out-of-band channel), so
// a malicious server can't substitute its own key into the handshake.
const deviceLinkSchema = new mongoose.Schema({
  linkId:   { type: String, unique: true, index: true, default: () => crypto.randomBytes(16).toString('hex') },
  userId:   { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  // b64url ephemeral public key the new device generated for this one handoff.
  ephemeralPublicKey: { type: String, required: true },
  // A label for the existing device to show ("Link <this device>?").
  deviceName: { type: String },
  // The opaque sealed box the existing device posts; the server never reads it.
  sealedPayload: { type: String },
  status:   { type: String, enum: ['pending', 'sealed', 'consumed'], default: 'pending', index: true },
  // Short TTL so an abandoned link can't be completed later. A background TTL
  // index sweeps expired slots; the routes also reject on expiry directly so
  // correctness never depends on the sweep's timing.
  expiresAt: { type: Date, required: true },
}, { timestamps: true });

deviceLinkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

module.exports = mongoose.model('DeviceLink', deviceLinkSchema);
