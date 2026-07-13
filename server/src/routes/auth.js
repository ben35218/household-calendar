const express = require('express');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const User = require('../models/User');
const Household = require('../models/Household');
const Person = require('../models/Person');
const Category = require('../models/Category');
const { requireAuth, signToken } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const { sendPasswordResetCode } = require('../services/mailer');
const { deleteUserAndData } = require('../services/accountDeletion');
const { seedDefaultCategories, seedDefaultSubcategories } = require('../seed');

const router = express.Router();

// Per-IP throttles on the unauthenticated endpoints (the limiter falls back to
// req.ip when there's no req.user). Generous for real users, hostile to
// credential stuffing / code brute-forcing. The register cap stays high enough
// that the integration-test harness (many registrations per file) never trips it.
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many sign-in attempts. Please try again in a few minutes.' });
const registerLimiter = rateLimit({ windowMs: 60 * 60 * 1000, max: 30, message: 'Too many accounts created from this network. Please try again later.' });
const forgotLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: 'Too many reset requests. Please try again in a few minutes.' });
const resetLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many reset attempts. Please try again in a few minutes.' });
// Authed but credential-changing — keyed per user once requireAuth has run.
const credChangeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many attempts. Please try again in a few minutes.' });

// Passkey sign-in ceremonies (WebAuthn challenge + assertion verify).
router.use('/passkey', require('./authPasskey'));

// The login/register/reset response body, one shape everywhere.
function sessionResponse(user) {
  return {
    token: signToken(String(user._id)),
    user: { _id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role },
  };
}

router.post('/register', registerLimiter, async (req, res) => {
  try {
    const { email, password, firstName, lastName } = req.body;
    if (!email || !password || !firstName) return res.status(400).json({ error: 'email, password and first name required' });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(409).json({ error: 'Email already registered' });

    const passwordHash = await bcrypt.hash(password, 12);
    const user = await User.create({ email, passwordHash, firstName, lastName: lastName || '' });

    // Every new user starts in their own household (others can join via its code later).
    const household = await Household.createForOwner(user._id, `${firstName}'s Household`);
    user.householdId = household._id;
    await user.save();

    await seedDefaultCategories(user._id);
    await seedDefaultSubcategories(user._id);

    // Add the new member to the People roster as their own "You" card.
    await Person.ensureSelf(user);

    res.status(201).json(sessionResponse(user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    res.json(sessionResponse(user));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ── Forgot password ──────────────────────────────────────────────────────────
// Step 1: email a short-lived 6-digit code. Always answers { ok: true } so the
// endpoint can't be used to probe which emails have accounts.
router.post('/forgot', forgotLimiter, async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase();
    if (!email) return res.status(400).json({ error: 'email is required' });

    const user = await User.findOne({ email });
    if (user) {
      const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');
      user.resetCodeHash = await bcrypt.hash(code, 12);
      user.resetCodeExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
      user.resetCodeAttempts = 0;
      await user.save();
      await sendPasswordResetCode(user, code); // never throws (mailer contract)
    }
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Step 2: verify the code and set the new password, then sign the user in.
// NOTE (E2EE): this changes only the LOGIN password. The password-wrapped key
// envelope still needs the old password — the client unlocks with a passkey or
// recovery code afterwards and re-wraps (rewrapForNewPassword). The server
// deliberately leaves the stale envelope in place: removing it could strip the
// account's last factor and make the data unrecoverable.
router.post('/reset', resetLimiter, async (req, res) => {
  try {
    const email = req.body.email?.trim().toLowerCase();
    const { code, newPassword } = req.body;
    if (!email || !code || !newPassword) return res.status(400).json({ error: 'email, code and new password are required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

    const user = await User.findOne({ email });
    const expired = !user?.resetCodeHash || !user.resetCodeExpiresAt || user.resetCodeExpiresAt < new Date();
    if (expired || user.resetCodeAttempts >= 5) {
      return res.status(400).json({ error: 'That code is invalid or has expired. Request a new one.' });
    }

    const valid = await bcrypt.compare(String(code), user.resetCodeHash);
    if (!valid) {
      user.resetCodeAttempts += 1;
      await user.save();
      return res.status(400).json({ error: 'That code is invalid or has expired. Request a new one.' });
    }

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    user.resetCodeHash = undefined;
    user.resetCodeExpiresAt = undefined;
    user.resetCodeAttempts = 0;
    await user.save();
    res.json({ ...sessionResponse(user), e2eeEnrolled: Boolean(user.identityPublicKey) });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// Change login email — requires the current password to confirm identity.
router.put('/email', requireAuth, credChangeLimiter, async (req, res) => {
  try {
    const { email, currentPassword } = req.body;
    const newEmail = email?.trim().toLowerCase();
    if (!newEmail || !currentPassword) return res.status(400).json({ error: 'email and current password are required' });
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(newEmail)) return res.status(400).json({ error: 'Enter a valid email address' });

    const user = await User.findById(req.user._id);
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    if (newEmail === user.email) return res.json({ _id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName });
    const taken = await User.findOne({ email: newEmail });
    if (taken) return res.status(409).json({ error: 'That email is already in use' });

    user.email = newEmail;
    await user.save();
    res.json({ _id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Change password — requires the current password.
router.put('/password', requireAuth, credChangeLimiter, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!currentPassword || !newPassword) return res.status(400).json({ error: 'current and new password are required' });
    if (newPassword.length < 8) return res.status(400).json({ error: 'New password must be at least 8 characters' });

    const user = await User.findById(req.user._id);
    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Current password is incorrect' });

    user.passwordHash = await bcrypt.hash(newPassword, 12);
    await user.save();
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Permanent, irreversible account deletion (Apple 5.1.1(v)). Re-authenticate
// with the password before wiping — this is destructive and the session token
// alone shouldn't be enough. Deletes the user and all their data (see
// services/accountDeletion); the now-invalid session 401s on its next request.
router.delete('/account', requireAuth, credChangeLimiter, async (req, res) => {
  try {
    const { password } = req.body;
    if (!password) return res.status(400).json({ error: 'Password is required to delete your account' });

    const user = await User.findById(req.user._id);
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Password is incorrect' });

    await deleteUserAndData(user);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
