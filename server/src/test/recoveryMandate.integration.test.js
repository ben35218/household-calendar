// Integration tests for the recovery mandate (docs/PASSWORDLESS-E2EE-PLAN.md §2):
// a freshly enrolled account reports recoverySetupAt == null; POST
// /keys/recovery-complete sets it (idempotently), and the flag surfaces on
// /keys/me. Gates the §5 password retirement. Real app + in-memory MongoDB.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startDb, stopDb, request, registerUser, enrollKeys } = require('./harness');

before(startDb);
after(stopDb);

test('enrolled account starts with recoverySetupAt unset', async () => {
  const user = await registerUser({ firstName: 'Rae' });
  await enrollKeys(user.auth);
  const me = await request().get('/api/keys/me').set('Authorization', user.auth);
  assert.equal(me.status, 200);
  assert.equal(me.body.enrolled, true);
  assert.equal(me.body.recoverySetupAt, null);
});

test('recovery-complete sets the flag and is idempotent', async () => {
  const user = await registerUser({ firstName: 'Sol' });
  await enrollKeys(user.auth);

  const first = await request().post('/api/keys/recovery-complete').set('Authorization', user.auth);
  assert.equal(first.status, 200);
  assert.ok(first.body.recoverySetupAt, 'flag should be set');

  // Idempotent: a second call must not move the timestamp.
  const second = await request().post('/api/keys/recovery-complete').set('Authorization', user.auth);
  assert.equal(second.status, 200);
  assert.equal(second.body.recoverySetupAt, first.body.recoverySetupAt);

  const me = await request().get('/api/keys/me').set('Authorization', user.auth);
  assert.equal(me.body.recoverySetupAt, first.body.recoverySetupAt);
});

test('recovery-complete is rejected before key enrollment', async () => {
  const user = await registerUser({ firstName: 'Tess' });
  const res = await request().post('/api/keys/recovery-complete').set('Authorization', user.auth);
  assert.equal(res.status, 409);
});
