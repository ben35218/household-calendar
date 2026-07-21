// Integration tests for per-resource CalendarKeys (Signal-parity D1): the
// mechanism that replaces the §9.5 outside-shared-calendar plaintext feed. An
// outside-shared calendar's events seal under a CalendarKey (envelope carries
// `enc.ks === 'cal'`), wrapped to the owning household (via its HDK) and to each
// accepted collaborator (via their identity key) as opaque ResourceKeyEnvelope
// rows. The server is content-blind — these tests drive the envelope lifecycle
// with stand-in blobs, exactly like the HDK-envelope suites. Real app + Mongo.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startDb, stopDb, request, registerUser, enrollKeys, b64u, fakeEnc } = require('./harness');

before(startDb);
after(stopDb);

let seq = 0;
const mintKey = () => `custom-ck${Date.now().toString(36)}${(seq++).toString(36)}`;

// An owner (enrolled + HDK minted) plus an enrolled outsider in a different
// household — the D1 cross-household case.
async function setup() {
  const owner = await registerUser({ firstName: 'Odette' });
  await enrollKeys(owner.auth);
  const mint = await request().post('/api/household/key')
    .set('Authorization', owner.auth).send({ keyVersion: 1, wrappedHDK: b64u(96) });
  assert.equal(mint.status, 201);
  const outsider = await registerUser({ firstName: 'Xander' });
  await enrollKeys(outsider.auth);
  return { owner, outsider };
}

async function createShared(auth, outsiderEmail, overrides = {}) {
  return request().post('/api/calendars').set('Authorization', auth).send({
    key: mintKey(), name: 'Carpool', color: '#1976D2',
    sharedWithOutside: [{ email: outsiderEmail, access: 'view' }], ...overrides,
  });
}

// Accept the calendar invitation as the outsider (seats them as a collaborator).
async function acceptInvite(outsider, calendarKey) {
  const inbox = await request().get('/api/calendars/invitations').set('Authorization', outsider.auth);
  const inv = inbox.body.find((i) => i.calendarKey === calendarKey);
  assert.ok(inv, 'expected a calendar invitation');
  const accept = await request().post(`/api/calendars/invitations/${inv._id}/accept`).set('Authorization', outsider.auth);
  assert.equal(accept.status, 200);
}

test('mint: owner provisions a CalendarKey v1 (household wrap); versioning is compare-and-set', async () => {
  const { owner, outsider } = await setup();
  const cal = await createShared(owner.auth, outsider.user.email);
  assert.equal(cal.status, 201);

  // A version that isn't current+1 is refused.
  const wrong = await request().post(`/api/calendars/${cal.body.key}/keys`)
    .set('Authorization', owner.auth).send({ keyVersion: 2, household: { hdkVersion: 1, wrappedKey: b64u(120) } });
  assert.equal(wrong.status, 409);

  // A household wrap is required.
  const noWrap = await request().post(`/api/calendars/${cal.body.key}/keys`)
    .set('Authorization', owner.auth).send({ keyVersion: 1, household: {} });
  assert.equal(noWrap.status, 400);

  const mint = await request().post(`/api/calendars/${cal.body.key}/keys`)
    .set('Authorization', owner.auth).send({ keyVersion: 1, household: { hdkVersion: 1, wrappedKey: b64u(120) } });
  assert.equal(mint.status, 201);

  // A second mint from v0 now loses the compare-and-set (already at v1).
  const dup = await request().post(`/api/calendars/${cal.body.key}/keys`)
    .set('Authorization', owner.auth).send({ keyVersion: 1, household: { hdkVersion: 1, wrappedKey: b64u(120) } });
  assert.equal(dup.status, 409);

  const keys = await request().get(`/api/calendars/${cal.body.key}/keys`).set('Authorization', owner.auth);
  assert.equal(keys.body.currentKeyVersion, 1);
  assert.equal(keys.body.household.length, 1);
  assert.equal(keys.body.household[0].hdkVersion, 1);
});

test('only the calendar owner manages its key', async () => {
  const { owner, outsider } = await setup();
  const cal = await createShared(owner.auth, outsider.user.email);
  const notOwner = await request().post(`/api/calendars/${cal.body.key}/keys`)
    .set('Authorization', outsider.auth).send({ keyVersion: 1, household: { hdkVersion: 1, wrappedKey: b64u(120) } });
  assert.equal(notOwner.status, 403);
});

test('wrap-on-approve: an accepted collaborator appears in keys/pending, then gets a member wrap', async () => {
  const { owner, outsider } = await setup();
  const cal = await createShared(owner.auth, outsider.user.email);
  await request().post(`/api/calendars/${cal.body.key}/keys`)
    .set('Authorization', owner.auth).send({ keyVersion: 1, household: { hdkVersion: 1, wrappedKey: b64u(120) } });

  // Before accepting, nothing pending (no collaborator yet).
  let pending = await request().get('/api/calendars/keys/pending').set('Authorization', owner.auth);
  assert.ok(!pending.body.some((p) => p.calendarKey === cal.body.key));

  await acceptInvite(outsider, cal.body.key);

  // Now the outsider is a collaborator missing a wrap — the owner's work list
  // includes them with their identity public key to seal to.
  pending = await request().get('/api/calendars/keys/pending').set('Authorization', owner.auth);
  const entry = pending.body.find((p) => p.calendarKey === cal.body.key);
  assert.ok(entry);
  assert.equal(entry.currentKeyVersion, 1);
  assert.equal(entry.needsMint, false);
  const missing = entry.missingMembers.find((m) => String(m.userId) === String(outsider.user._id));
  assert.ok(missing);
  assert.ok(missing.identityPublicKey);

  // Owner seals the CalendarKey to the collaborator and posts the member wrap.
  const wrap = await request().post(`/api/calendars/${cal.body.key}/keys/members`)
    .set('Authorization', owner.auth)
    .send({ keyVersion: 1, members: [{ userId: outsider.user._id, wrappedKey: b64u(120) }] });
  assert.equal(wrap.status, 200);
  assert.equal(wrap.body.wrapped, 1);

  // The collaborator can now fetch their own member envelope.
  const keys = await request().get(`/api/calendars/${cal.body.key}/keys`).set('Authorization', outsider.auth);
  assert.equal(keys.status, 200);
  assert.equal(keys.body.member.length, 1);
  assert.equal(keys.body.member[0].keyVersion, 1);
  assert.equal(keys.body.household.length, 0); // not in the owning household

  // Once wrapped, the collaborator drops off the pending list.
  const after = await request().get('/api/calendars/keys/pending').set('Authorization', owner.auth);
  assert.ok(!after.body.some((p) => p.calendarKey === cal.body.key));
});

test('an owner cannot hand the key to a non-collaborator (member wrap is seated only for collaborators)', async () => {
  const { owner, outsider } = await setup();
  const stranger = await registerUser({ firstName: 'Stranger' });
  await enrollKeys(stranger.auth);
  const cal = await createShared(owner.auth, outsider.user.email);
  await request().post(`/api/calendars/${cal.body.key}/keys`)
    .set('Authorization', owner.auth).send({ keyVersion: 1, household: { hdkVersion: 1, wrappedKey: b64u(120) } });

  const wrap = await request().post(`/api/calendars/${cal.body.key}/keys/members`)
    .set('Authorization', owner.auth)
    .send({ keyVersion: 1, members: [{ userId: stranger.user._id, wrappedKey: b64u(120) }] });
  assert.equal(wrap.status, 200);
  assert.equal(wrap.body.wrapped, 0); // not a collaborator → not seated

  const keys = await request().get(`/api/calendars/${cal.body.key}/keys`).set('Authorization', stranger.auth);
  // Stranger has no access to the calendar at all.
  assert.equal(keys.status, 404);
});

test('CalendarKey-sealed events strip plaintext unconditionally and reach the collaborator as ciphertext', async () => {
  const { owner, outsider } = await setup();
  const cal = await createShared(owner.auth, outsider.user.email);
  await request().post(`/api/calendars/${cal.body.key}/keys`)
    .set('Authorization', owner.auth).send({ keyVersion: 1, household: { hdkVersion: 1, wrappedKey: b64u(120) } });
  await acceptInvite(outsider, cal.body.key);
  await request().post(`/api/calendars/${cal.body.key}/keys/members`)
    .set('Authorization', owner.auth)
    .send({ keyVersion: 1, members: [{ userId: outsider.user._id, wrappedKey: b64u(120) }] });

  // Signal-parity C3b: a CalendarKey-sealed event goes to the unified opaque store
  // with its D1 scope lane (kind:'calendar', resource=<calendarKey>, version). The
  // store is structurally opaque — no plaintext content ever — and a cal-scoped
  // record keeps its plaintext userId (the D1/D2 cross-household routing deviation).
  const created = await request().post('/api/records').set('Authorization', owner.auth).send({
    enc: { ...fakeEnc(), ks: 'cal' }, keyVersion: 1,
    scope: { kind: 'calendar', resource: cal.body.key, version: 1 },
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.title, undefined, 'no plaintext content in the opaque store');
  assert.equal(created.body.enc.ks, 'cal');
  assert.equal(created.body.keyVersion, 1);
  assert.equal(created.body.scope.resource, cal.body.key);
  assert.ok(created.body.userId, 'a cal-scoped record keeps its plaintext author routing (D1 deviation)');

  // The collaborator reads the sealed event via the unified sync — the resource
  // lane delivers it (they hold a member key envelope for this calendar), as
  // ciphertext, regardless of any date window. No plaintext title/date leaks.
  const sync = await request().get('/api/records/sync').set('Authorization', outsider.auth);
  assert.equal(sync.status, 200);
  const ev = sync.body.records.find((e) => String(e._id) === String(created.body._id));
  assert.ok(ev, 'collaborator should see the sealed event via the resource lane');
  assert.ok(ev.enc && ev.enc.ct, 'event should carry ciphertext');
  assert.equal(ev.enc.ks, 'cal');
  assert.equal(ev.title, undefined, 'no plaintext title leaks to the collaborator');
});

test('revoke: removing the outsider flags a rotation; the owner rotates to a new CalendarKey version', async () => {
  const { owner, outsider } = await setup();
  const cal = await createShared(owner.auth, outsider.user.email);
  await request().post(`/api/calendars/${cal.body.key}/keys`)
    .set('Authorization', owner.auth).send({ keyVersion: 1, household: { hdkVersion: 1, wrappedKey: b64u(120) } });
  await acceptInvite(outsider, cal.body.key);
  await request().post(`/api/calendars/${cal.body.key}/keys/members`)
    .set('Authorization', owner.auth)
    .send({ keyVersion: 1, members: [{ userId: outsider.user._id, wrappedKey: b64u(120) }] });

  // Owner un-shares → the calendar is flagged for a CalendarKey rotation.
  const unshare = await request().put(`/api/calendars/${cal.body.key}`)
    .set('Authorization', owner.auth).send({ sharedWithOutside: [] });
  assert.equal(unshare.status, 200);

  const pending = await request().get('/api/calendars/keys/pending').set('Authorization', owner.auth);
  const entry = pending.body.find((p) => p.calendarKey === cal.body.key);
  assert.ok(entry, 'un-shared calendar should surface for rotation');
  assert.equal(entry.rotationPending, true);

  // Owner rotates to v2 (fresh key, re-wrapped to the household). The removed
  // outsider is no longer a collaborator, so no member wrap covers them at v2.
  const rotate = await request().post(`/api/calendars/${cal.body.key}/keys`)
    .set('Authorization', owner.auth).send({ keyVersion: 2, household: { hdkVersion: 1, wrappedKey: b64u(120) } });
  assert.equal(rotate.status, 201);

  const keys = await request().get(`/api/calendars/${cal.body.key}/keys`).set('Authorization', owner.auth);
  assert.equal(keys.body.currentKeyVersion, 2);

  // The removed outsider lost calendar access entirely (revoked collaborator).
  const outKeys = await request().get(`/api/calendars/${cal.body.key}/keys`).set('Authorization', outsider.auth);
  assert.equal(outKeys.status, 404);

  // Rotation flag cleared.
  const after = await request().get('/api/calendars/keys/pending').set('Authorization', owner.auth);
  assert.ok(!after.body.some((p) => p.calendarKey === cal.body.key));
});

test('deleting the calendar removes its CalendarKey envelopes', async () => {
  const { owner, outsider } = await setup();
  const cal = await createShared(owner.auth, outsider.user.email);
  await request().post(`/api/calendars/${cal.body.key}/keys`)
    .set('Authorization', owner.auth).send({ keyVersion: 1, household: { hdkVersion: 1, wrappedKey: b64u(120) } });

  const del = await request().delete(`/api/calendars/${cal.body.key}`).set('Authorization', owner.auth);
  assert.equal(del.status, 200);

  const ResourceKeyEnvelope = require('../models/ResourceKeyEnvelope');
  const remaining = await ResourceKeyEnvelope.countDocuments({ resourceKey: cal.body.key });
  assert.equal(remaining, 0);
});
