// Signal-parity A1 — key-change audit events. Factor add/remove and enrollment
// must leave an AuditLog trail (the push fan-out itself no-ops in tests: push
// isn't configured), and the alert path must never break the parent request.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startDb, stopDb, request, registerUser, enrollKeys, b64u } = require('./harness');

before(startDb);
after(stopDb);

const AuditLog = require('../models/AuditLog');

async function events(userId) {
  const rows = await AuditLog.find({ userId }).sort({ at: 1 }).lean();
  return rows.map((r) => r.event);
}

test('key enrollment writes a key_enrolled audit event', async () => {
  const user = await registerUser({ firstName: 'Ada' });
  await enrollKeys(user.auth);
  assert.ok((await events(user.user._id)).includes('key_enrolled'));
});

test('adding a new factor audits factor_added; re-wrap does not', async () => {
  const user = await registerUser({ firstName: 'Bo' });
  await enrollKeys(user.auth);

  const recovery = {
    factor: 'recovery', nonce: b64u(24), ct: b64u(48),
  };
  const add = await request().put('/api/keys/factors').set('Authorization', user.auth).send(recovery);
  assert.equal(add.status, 200);
  assert.equal((await events(user.user._id)).filter((e) => e === 'factor_added').length, 1);

  // Re-wrapping the same factor (regenerated code) replaces the envelope —
  // routine, not a new factor, so no second audit event.
  const rewrap = await request().put('/api/keys/factors').set('Authorization', user.auth)
    .send({ ...recovery, ct: b64u(48) });
  assert.equal(rewrap.status, 200);
  assert.equal((await events(user.user._id)).filter((e) => e === 'factor_added').length, 1);
});

test('removing a factor audits factor_removed (last factor still protected)', async () => {
  const user = await registerUser({ firstName: 'Cy' });
  await enrollKeys(user.auth);
  await request().put('/api/keys/factors').set('Authorization', user.auth)
    .send({ factor: 'recovery', nonce: b64u(24), ct: b64u(48) });

  const del = await request().delete('/api/keys/factors/recovery').set('Authorization', user.auth);
  assert.equal(del.status, 200);
  assert.ok((await events(user.user._id)).includes('factor_removed'));

  // The remaining (password) factor cannot be removed.
  const last = await request().delete('/api/keys/factors/password').set('Authorization', user.auth);
  assert.equal(last.status, 400);
});
