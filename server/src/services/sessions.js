const mongoose = require('mongoose');
const User = require('../models/User');
const AuditLog = require('../models/AuditLog');
const { pushToUser } = require('./notify');
const { sendNewDeviceAlert } = require('./mailer');

// Device sessions (Signal-parity plan F2/F3). A session row is created whenever
// a credential sign-in mints a token; its subdoc id rides in the JWT as `sid`.
// Deleting the row revokes the token (middleware/auth checks membership).
// Creation on an unfamiliar device also fans out the F3 "new sign-in" alert to
// the account email + the user's other devices — the loud takeover signal.

const MAX_SESSIONS = 20;

// Device identity comes from client-sent headers (the mobile api client sets
// them). Spoofable — fine: they only label the row and tune alert noise; they
// are never an auth factor. The known-device check for F1 uses the sid.
function deviceFromReq(req) {
  return {
    deviceName: (req.get('x-device-name') || '').slice(0, 80) || 'Unknown device',
    platform: (req.get('x-device-platform') || '').slice(0, 20),
  };
}

// Create a session row for this sign-in and return its id (the JWT `sid`).
// `quiet` suppresses the new-device alert (registration: the account is seconds
// old, there's no one to warn).
async function createSession(userId, req, { quiet = false } = {}) {
  const device = deviceFromReq(req);
  const sid = new mongoose.Types.ObjectId();
  const user = await User.findById(userId, 'sessions email firstName pushSubscriptions');
  if (!user) return sid; // account vanished mid-flight; token will 401 anyway

  // An unfamiliar device = no existing session with this name+platform. Checked
  // BEFORE the new row is added.
  const familiar = user.sessions.some(
    (s) => s.deviceName === device.deviceName && s.platform === device.platform,
  );

  const row = { _id: sid, ...device, createdAt: new Date(), lastSeenAt: new Date() };
  const sessions = [...user.sessions.map((s) => s.toObject()), row]
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
    .slice(-MAX_SESSIONS);
  await User.updateOne({ _id: userId }, { $set: { sessions } });
  await AuditLog.create({
    userId, event: 'session_created', meta: { device: device.deviceName, platform: device.platform },
  });

  if (!quiet && !familiar) {
    // F3: loud on every unfamiliar device. Push goes to the user's already-
    // subscribed devices (the new one has no subscription yet), email as the
    // out-of-band channel an attacker-held device can't suppress.
    const body = `New sign-in to your account from ${device.deviceName}${device.platform ? ` (${device.platform})` : ''}. If this wasn't you, open Sign-in & Security and sign that device out.`;
    pushToUser(user, { title: 'New device signed in', body, tag: `signin-${userId}` }).catch(() => {});
    sendNewDeviceAlert(user, device).catch?.(() => {});
  }
  return sid;
}

// Revoke one session row. Returns true when something was removed.
async function revokeSession(userId, sid) {
  const res = await User.updateOne(
    { _id: userId },
    { $pull: { sessions: { _id: sid } } },
  );
  if (res.modifiedCount) {
    await AuditLog.create({ userId, event: 'session_revoked', meta: { sid: String(sid) } });
  }
  return !!res.modifiedCount;
}

module.exports = { createSession, revokeSession, deviceFromReq, MAX_SESSIONS };
