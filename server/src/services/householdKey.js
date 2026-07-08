// Server-side shape validation for Phase 2 household-key material.
//
// As with keyEnvelope.js, the server holds no key and can verify no crypto — it
// only validates the *shape* of what clients upload (a sealed-box HDK envelope
// is opaque base64; a key version is a positive integer) and rejects anything
// malformed before it touches the database. Pure functions, unit-tested.
// See docs/E2EE-SYNC-PLAN.md §4.2 / §5.1.

const { isB64 } = require('./keyEnvelope');

// A minted or approved HDK envelope: { wrappedHDK, keyVersion }.
// Returns an error string if malformed, or null if valid.
function validateHDKEnvelope(body) {
  if (!body || typeof body !== 'object') return 'invalid body';
  if (!isB64(body.wrappedHDK)) return 'invalid wrappedHDK';
  if (!Number.isInteger(body.keyVersion) || body.keyVersion < 1) return 'invalid keyVersion';
  return null;
}

// A rotation payload (§5.2 lazy rotation): a new key version plus one sealed-box
// envelope per remaining member — the HDK_vN+1 wrapped to each member's public
// key. The server verifies only the *shape* here; the route additionally checks
// the version is exactly current+1 and the envelopes cover the live member set.
// Returns an error string if malformed, or null if valid.
function validateRotation(body) {
  if (!body || typeof body !== 'object') return 'invalid body';
  if (!Number.isInteger(body.keyVersion) || body.keyVersion < 2) return 'invalid keyVersion';
  if (!Array.isArray(body.envelopes) || body.envelopes.length === 0) return 'envelopes required';
  const seen = new Set();
  for (const e of body.envelopes) {
    if (!e || typeof e !== 'object') return 'invalid envelope';
    if (!isObjectId(String(e.userId || ''))) return 'invalid envelope userId';
    if (!isB64(e.wrappedHDK)) return 'invalid envelope wrappedHDK';
    if (seen.has(String(e.userId))) return 'duplicate envelope userId';
    seen.add(String(e.userId));
  }
  return null;
}

// base64url with a generous cap for record ciphertext, which (unlike a fixed key
// envelope) can be large — a long recipe or trip note. ~2 MB of base64 ≈ 1.5 MB
// plaintext, well under Mongo's 16 MB document limit.
const B64URL = /^[A-Za-z0-9_-]+$/;
function isRecordB64(s, max) {
  return typeof s === 'string' && s.length > 0 && s.length <= max && B64URL.test(s);
}

// An AEAD record ciphertext blob (a document's `enc` field), written by clients
// during dual-write. Opaque to the server — we only check the shape. Returns an
// error string if malformed, or null if valid. See docs/E2EE-SYNC-PLAN.md §3.2.
function validateRecordEnvelope(enc) {
  if (!enc || typeof enc !== 'object') return 'invalid enc';
  if (enc.alg !== 'xchacha20poly1305-ietf') return 'invalid enc.alg';
  if (!isRecordB64(enc.nonce, 64)) return 'invalid enc.nonce'; // 24-byte nonce → 32 chars
  if (!isRecordB64(enc.ct, 2_000_000)) return 'invalid enc.ct';
  return null;
}

// A client-minted Mongo ObjectId (24 hex chars). Clients supply the _id when
// creating an encrypted record so the ciphertext's AAD can bind to it before the
// round-trip. See docs/E2EE-SYNC-PLAN.md §3.2 / Phase 3.
function isObjectId(s) {
  return typeof s === 'string' && /^[a-f0-9]{24}$/i.test(s);
}

// Pull the optional dual-write fields off a request body, validating the
// ciphertext shape. Returns { enc?, keyVersion? } or throws an error string for
// a malformed envelope. Used by every content route that accepts `enc`.
function pickRecordEnc(body) {
  const out = {};
  if (body.enc !== undefined) {
    const err = validateRecordEnvelope(body.enc);
    if (err) throw err;
    out.enc = { alg: body.enc.alg, nonce: body.enc.nonce, ct: body.enc.ct };
    if (Number.isInteger(body.keyVersion)) out.keyVersion = body.keyVersion;
  }
  return out;
}

module.exports = { validateHDKEnvelope, validateRotation, validateRecordEnvelope, isObjectId, pickRecordEnc };
