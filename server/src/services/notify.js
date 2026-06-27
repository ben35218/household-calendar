const User = require('../models/User');
const push = require('./push');

// Push is the only notification channel. Alerts are configured per item
// (event / chore / task) and routed to an audience (everyone vs. the item's
// creator); birthdays always go to everyone. This module just fans a payload
// out to a user's subscribed devices and prunes dead subscriptions.

// Prune a push subscription the platform has expired (web 404/410, Expo
// DeviceNotRegistered). Matches web subs by endpoint, native subs by expoToken.
async function pruneSubscription(userId, sub) {
  const match = sub.expoToken ? { expoToken: sub.expoToken } : { endpoint: sub.endpoint };
  await User.updateOne({ _id: userId }, { $pull: { pushSubscriptions: match } }).catch(() => {});
}

// Send a push payload to every device a user has subscribed.
// Returns { sent, failed } counts. No-ops cleanly when push isn't configured
// or the user has no subscriptions.
async function pushToUser(user, payload) {
  if (!push.isConfigured()) return { sent: 0, failed: 0 };
  const subs = user.pushSubscriptions || [];
  let sent = 0, failed = 0;
  for (const sub of subs) {
    try {
      await push.sendToSubscription(sub, payload);
      sent++;
    } catch (err) {
      failed++;
      if (err.statusCode === 404 || err.statusCode === 410) {
        await pruneSubscription(user._id, sub);
      }
    }
  }
  return { sent, failed };
}

module.exports = { pushToUser, pruneSubscription };
