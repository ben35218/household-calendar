// Integration tests for the passwordless-registration signal (routes/auth.js
// /auth/register). A passwordless signup sends an on-device random secret as
// `password` (it wraps the E2EE envelope) plus a `passwordless` flag; the server
// records `hasPassword: false` so the unlock UI offers recovery/passkey instead
// of a password field. Setting a password later (reset) flips it back to true.
// See docs/PASSWORDLESS-E2EE-PLAN.md §5c. Real app + in-memory MongoDB.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const bcrypt = require('bcryptjs');
const { startDb, stopDb, request } = require('./harness');

const User = require('../models/User');

before(startDb);
after(stopDb);

test('register with passwordless flag records hasPassword:false and returns it', async () => {
  const res = await request().post('/api/auth/register')
    .send({ email: 'pwless@example.com', password: 'on-device-secret', firstName: 'Nova', passwordless: true });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.hasPassword, false, 'session response carries the flag');
  const doc = await User.findOne({ email: 'pwless@example.com' });
  assert.equal(doc.hasPassword, false);
});

test('register without the flag keeps hasPassword:true (legacy password signup)', async () => {
  const res = await request().post('/api/auth/register')
    .send({ email: 'withpw@example.com', password: 'realpassword1', firstName: 'Otto' });
  assert.equal(res.status, 201);
  assert.equal(res.body.user.hasPassword, true);
  const doc = await User.findOne({ email: 'withpw@example.com' });
  assert.equal(doc.hasPassword, true);
});

test('a password reset flips a passwordless account to hasPassword:true', async () => {
  await request().post('/api/auth/register')
    .send({ email: 'reset-pwless@example.com', password: 'on-device-secret', firstName: 'Remy', passwordless: true });
  await User.updateOne({ email: 'reset-pwless@example.com' }, {
    resetCodeHash: await bcrypt.hash('654321', 12),
    resetCodeExpiresAt: new Date(Date.now() + 15 * 60 * 1000),
    resetCodeAttempts: 0,
  });

  const res = await request().post('/api/auth/reset')
    .send({ email: 'reset-pwless@example.com', code: '654321', newPassword: 'a-real-password' });
  assert.equal(res.status, 200);
  assert.equal(res.body.user.hasPassword, true);
  const doc = await User.findOne({ email: 'reset-pwless@example.com' });
  assert.equal(doc.hasPassword, true);
});
