// E2EE key-material endpoints (Phase 1).
//
// The server is a blind store: it persists the user's identity PUBLIC key and
// their private key wrapped as opaque per-factor envelopes, and hands them back
// on unlock. It never sees a plaintext private key or the Household Data Key.
// All actual crypto happens client-side in @household/crypto.

const express = require('express');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const {
  validateEnrollment, validateEnvelope, pickEnvelope, upsertFactor, removeFactor,
} = require('../services/keyEnvelope');

const router = express.Router();
router.use(requireAuth);

// Enrollment and factor changes are security-sensitive; a few per minute is
// plenty for a real user and blunts scripted abuse.
const keyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 20,
  message: 'Too many key-management requests. Please wait a minute and try again.',
});

// The caller's own key material — used on login to decide whether to enroll and
// to fetch the envelopes needed to unlock. Returns the wrapped (ciphertext)
// private key; only the caller can decrypt it, so this is safe to return.
router.get('/me', (req, res) => {
  const u = req.user;
  res.json({
    enrolled: Boolean(u.identityPublicKey),
    identityPublicKey: u.identityPublicKey || null,
    wrappedPrivateKey: u.wrappedPrivateKey || [],
    keyEnrolledAt: u.keyEnrolledAt || null,
    keySchemaVersion: u.keySchemaVersion || 1,
  });
});

// First-time enrollment: store the identity public key + initial factor set.
// Idempotency: enrolling an already-enrolled account is rejected — re-keying a
// user (lost all factors) is the household re-admission / re-enroll flow in a
// later phase, not a silent overwrite here.
router.post('/enroll', keyLimiter, async (req, res) => {
  try {
    const err = validateEnrollment(req.body);
    if (err) return res.status(400).json({ error: err });

    const user = await User.findById(req.user._id);
    if (user.identityPublicKey) {
      return res.status(409).json({ error: 'Keys already enrolled for this account' });
    }

    user.identityPublicKey = req.body.identityPublicKey;
    user.wrappedPrivateKey = req.body.factors.map(pickEnvelope);
    user.keyEnrolledAt = new Date();
    user.keySchemaVersion = 1;
    await user.save();

    res.status(201).json({ enrolled: true, keyEnrolledAt: user.keyEnrolledAt });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Add or replace a single unlock factor (enroll a passkey, rotate the
// password-wrapped envelope after a password change, regenerate a recovery
// code). The public key and private key are unchanged — only the wrapping.
router.put('/factors', keyLimiter, async (req, res) => {
  try {
    const err = validateEnvelope(req.body);
    if (err) return res.status(400).json({ error: err });

    const user = await User.findById(req.user._id);
    if (!user.identityPublicKey) {
      return res.status(409).json({ error: 'Enroll keys before managing factors' });
    }
    user.wrappedPrivateKey = upsertFactor(user.wrappedPrivateKey, req.body);
    await user.save();
    res.json({ factors: user.wrappedPrivateKey.map((f) => ({ factor: f.factor, credentialId: f.credentialId })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Remove a factor — but never the last one, or the account's data becomes
// unrecoverable by design. Passkey removal targets a specific credentialId.
router.delete('/factors/:factor', keyLimiter, async (req, res) => {
  try {
    const { factor } = req.params;
    const { credentialId } = req.query;
    const user = await User.findById(req.user._id);
    if (!user.identityPublicKey) {
      return res.status(409).json({ error: 'No keys enrolled' });
    }
    const remaining = removeFactor(user.wrappedPrivateKey, factor, credentialId);
    if (remaining.length === user.wrappedPrivateKey.length) {
      return res.status(404).json({ error: 'No matching factor to remove' });
    }
    if (remaining.length === 0) {
      return res.status(400).json({ error: 'Cannot remove your last unlock factor — enroll another first' });
    }
    user.wrappedPrivateKey = remaining;
    await user.save();
    res.json({ factors: user.wrappedPrivateKey.map((f) => ({ factor: f.factor, credentialId: f.credentialId })) });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// A household member's identity PUBLIC key — needed to wrap the Household Data
// Key to them (Phase 2 approve-to-join). Scoped to the caller's household.
router.get('/public/:userId', async (req, res) => {
  try {
    const inScope = req.scopeIds.some((id) => String(id) === String(req.params.userId));
    if (!inScope) return res.status(404).json({ error: 'User not in your household' });
    const target = await User.findById(req.params.userId).select('identityPublicKey firstName');
    if (!target || !target.identityPublicKey) {
      return res.status(404).json({ error: 'That member has not enrolled keys yet' });
    }
    res.json({ userId: target._id, identityPublicKey: target.identityPublicKey });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

module.exports = router;
