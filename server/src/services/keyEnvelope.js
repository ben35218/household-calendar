// Server-side validation + sanitization for E2EE key material.
//
// The server cannot verify any crypto (it holds no key), but it MUST validate
// the *shape* of what clients upload — reject malformed envelopes, store only
// known fields, and enforce the safety invariant that a user can never delete
// their last surviving unlock factor (which would make their data
// unrecoverable). Pure functions, unit-tested; the /keys route is the only
// caller. See docs/E2EE-SYNC-PLAN.md §3.4.

const FACTORS = ['password', 'passkey', 'recovery'];
// libsodium URLSAFE_NO_PADDING base64 alphabet.
const B64URL = /^[A-Za-z0-9_-]+$/;

function isB64(s) {
  return typeof s === 'string' && s.length > 0 && s.length <= 4096 && B64URL.test(s);
}

// Returns an error string if the envelope is malformed, or null if valid.
function validateEnvelope(env) {
  if (!env || typeof env !== 'object') return 'envelope must be an object';
  if (!FACTORS.includes(env.factor)) return 'invalid factor kind';
  if (!isB64(env.nonce)) return 'invalid nonce';
  if (!isB64(env.ct)) return 'invalid ct';

  if (env.factor === 'password') {
    if (env.kdf !== 'argon2id') return 'password factor requires kdf=argon2id';
    if (!isB64(env.salt)) return 'invalid salt';
    if (!Number.isInteger(env.opslimit) || env.opslimit <= 0) return 'invalid opslimit';
    if (!Number.isInteger(env.memlimit) || env.memlimit <= 0) return 'invalid memlimit';
  }
  if (env.factor === 'passkey') {
    if (!isB64(env.credentialId)) return 'passkey factor requires credentialId';
    if (env.prfSalt != null && !isB64(env.prfSalt)) return 'invalid prfSalt';
  }
  return null;
}

// Strip an uploaded envelope to only the fields we persist for its kind, so a
// client can't smuggle arbitrary data into the User document.
function pickEnvelope(env) {
  const base = { factor: env.factor, nonce: env.nonce, ct: env.ct };
  if (env.factor === 'password') {
    return { ...base, kdf: env.kdf, salt: env.salt, opslimit: env.opslimit, memlimit: env.memlimit };
  }
  if (env.factor === 'passkey') {
    const out = { ...base, credentialId: env.credentialId };
    if (env.prfSalt != null) out.prfSalt = env.prfSalt;
    return out;
  }
  return base; // recovery
}

// Validate a full enrollment payload (public key + initial factor set).
function validateEnrollment(payload) {
  if (!payload || typeof payload !== 'object') return 'invalid payload';
  if (!isB64(payload.identityPublicKey)) return 'invalid identityPublicKey';
  const { factors } = payload;
  if (!Array.isArray(factors) || factors.length === 0) return 'at least one factor is required';
  for (const f of factors) {
    const err = validateEnvelope(f);
    if (err) return err;
  }
  return null;
}

// Merge a new/updated factor into an existing set. A single password/recovery
// factor is replaced in place; passkey factors coexist keyed by credentialId.
function upsertFactor(existing, env) {
  const clean = pickEnvelope(env);
  const keep = existing.filter((f) => {
    if (f.factor !== clean.factor) return true;
    if (clean.factor === 'passkey') return f.credentialId !== clean.credentialId;
    return false; // replace the single password/recovery factor
  });
  return [...keep, clean];
}

// The factor set that would remain after a proposed removal. Callers reject the
// removal when this is empty (the "at least one factor must survive" rule).
function removeFactor(existing, factor, credentialId) {
  return existing.filter((f) => {
    if (f.factor !== factor) return true;
    if (factor === 'passkey') return f.credentialId !== credentialId;
    return false;
  });
}

module.exports = {
  FACTORS,
  isB64,
  validateEnvelope,
  pickEnvelope,
  validateEnrollment,
  upsertFactor,
  removeFactor,
};
