const express = require('express');
const User = require('../models/User');
const { requireAuth } = require('../middleware/auth');
const push = require('../services/push');

// Push is the only notification channel. Alerts themselves are configured per
// item (event / chore / task); this route just manages a user's push devices.
const router = express.Router();
router.use(requireAuth);

router.get('/push/key', (req, res) => {
  res.json({ configured: push.isConfigured(), publicKey: push.publicKey() });
});

router.post('/push/subscribe', async (req, res) => {
  try {
    const { subscription, label } = req.body;
    if (!subscription?.endpoint) return res.status(400).json({ error: 'Invalid subscription' });
    // Replace any existing entry for this endpoint, then add the fresh one.
    await User.updateOne({ _id: req.user._id },
      { $pull: { pushSubscriptions: { endpoint: subscription.endpoint } } });
    await User.updateOne({ _id: req.user._id },
      { $push: { pushSubscriptions: { endpoint: subscription.endpoint, keys: subscription.keys, label } } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/push/unsubscribe', async (req, res) => {
  try {
    const { endpoint } = req.body;
    await User.updateOne({ _id: req.user._id }, { $pull: { pushSubscriptions: { endpoint } } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Native (mobile app) push registration. The Expo push token uniquely
// identifies the device; replace any existing entry for it, then store fresh.
router.post('/push/register-native', async (req, res) => {
  try {
    const { expoToken, platform, label } = req.body;
    if (!expoToken) return res.status(400).json({ error: 'Missing expoToken' });
    const plat = platform === 'ios' || platform === 'android' ? platform : 'ios';
    await User.updateOne({ _id: req.user._id },
      { $pull: { pushSubscriptions: { expoToken } } });
    await User.updateOne({ _id: req.user._id },
      { $push: { pushSubscriptions: { platform: plat, expoToken, label } } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/push/unregister-native', async (req, res) => {
  try {
    const { expoToken } = req.body;
    await User.updateOne({ _id: req.user._id }, { $pull: { pushSubscriptions: { expoToken } } });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
