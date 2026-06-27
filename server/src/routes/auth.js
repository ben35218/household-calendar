const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Household = require('../models/Household');
const Person = require('../models/Person');
const Category = require('../models/Category');
const { requireAuth } = require('../middleware/auth');
const { seedDefaultCategories, seedDefaultSubcategories } = require('../seed');

const router = express.Router();

router.post('/register', async (req, res) => {
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

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    res.status(201).json({ token, user: { _id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase() });
    if (!user) return res.status(401).json({ error: 'Invalid credentials' });

    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, { expiresIn: process.env.JWT_EXPIRES_IN || '7d' });
    res.json({ token, user: { _id: user._id, email: user.email, firstName: user.firstName, lastName: user.lastName, role: user.role } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/me', requireAuth, (req, res) => {
  res.json(req.user);
});

// Change login email — requires the current password to confirm identity.
router.put('/email', requireAuth, async (req, res) => {
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
router.put('/password', requireAuth, async (req, res) => {
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

module.exports = router;
