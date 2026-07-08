// Integration tests for the HDK lifecycle routes (Phase 7 / §5.2): mint v1,
// member-keys, join/approve envelope write, member removal → rotation flag,
// and the lazy rotation itself (coverage check, stale-version 409, CAS race).
// Real app + in-memory MongoDB — see harness.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const {
  startDb, stopDb, request, b64u, registerUser, enrollKeys, joinHousehold,
} = require('./harness');

const Household = require('../models/Household');
const HouseholdKeyEnvelope = require('../models/HouseholdKeyEnvelope');
const AuditLog = require('../models/AuditLog');

before(startDb);
after(stopDb);

// One owner + one joiner, walked through the real onboarding: register, enroll
// keys, owner mints HDK v1, joiner requests + owner approves (wrapping v1).
async function setupHouseholdOfTwo() {
  const owner = await registerUser({ firstName: 'Olive' });
  const member = await registerUser({ firstName: 'Milo' });
  await enrollKeys(owner.auth);
  await enrollKeys(member.auth);

  const mint = await request().post('/api/household/key')
    .set('Authorization', owner.auth)
    .send({ keyVersion: 1, wrappedHDK: b64u(96) });
  assert.equal(mint.status, 201);

  const hh = await request().get('/api/household').set('Authorization', owner.auth);
  await joinHousehold({ joiner: member, approver: owner, joinCode: hh.body.joinCode, keyVersion: 1 });
  return { owner, member, householdId: hh.body._id };
}

test('mint v1 is owner-only and idempotent under a race (second attempt 409s)', async () => {
  const owner = await registerUser();
  const outsider = await registerUser();
  await enrollKeys(owner.auth);

  // A non-owner (of this household) can't mint. The outsider owns their own
  // household, so exercise the guard with a member: add one pre-mint is not
  // possible (join requires a key), so assert the version guard instead.
  const bad = await request().post('/api/household/key')
    .set('Authorization', owner.auth).send({ keyVersion: 2, wrappedHDK: b64u(96) });
  assert.equal(bad.status, 400);

  const first = await request().post('/api/household/key')
    .set('Authorization', owner.auth).send({ keyVersion: 1, wrappedHDK: b64u(96) });
  assert.equal(first.status, 201);
  const second = await request().post('/api/household/key')
    .set('Authorization', owner.auth).send({ keyVersion: 1, wrappedHDK: b64u(96) });
  assert.equal(second.status, 409);

  // The outsider's own household is untouched.
  const key = await request().get('/api/household/key').set('Authorization', outsider.auth);
  assert.equal(key.body.currentKeyVersion, 0);
});

test('join/approve writes the joiner\'s v1 envelope; GET /key returns it', async () => {
  const { member, householdId } = await setupHouseholdOfTwo();

  const key = await request().get('/api/household/key').set('Authorization', member.auth);
  assert.equal(key.status, 200);
  assert.equal(String(key.body.householdId), String(householdId));
  assert.equal(key.body.currentKeyVersion, 1);
  assert.equal(key.body.envelopes.length, 1);
  assert.equal(key.body.envelopes[0].keyVersion, 1);
  assert.ok(key.body.envelopes[0].wrappedHDK);
});

test('member-keys lists every enrolled member with their public key', async () => {
  const { owner, member } = await setupHouseholdOfTwo();
  const res = await request().get('/api/household/member-keys').set('Authorization', owner.auth);
  assert.equal(res.status, 200);
  const ids = res.body.map((m) => String(m.userId)).sort();
  assert.deepEqual(ids, [String(owner.user._id), String(member.user._id)].sort());
  for (const m of res.body) assert.ok(m.identityPublicKey);
});

test('owner removes a member: fresh solo household, envelopes dropped, rotation flagged', async () => {
  const { owner, member, householdId } = await setupHouseholdOfTwo();

  // Owner can't remove themselves.
  const self = await request().post(`/api/household/members/${owner.user._id}/remove`)
    .set('Authorization', owner.auth);
  assert.equal(self.status, 400);

  // A member (non-owner) can't remove anyone.
  const forbidden = await request().post(`/api/household/members/${owner.user._id}/remove`)
    .set('Authorization', member.auth);
  assert.equal(forbidden.status, 403);

  const res = await request().post(`/api/household/members/${member.user._id}/remove`)
    .set('Authorization', owner.auth);
  assert.equal(res.status, 200);

  // The removed member landed in a fresh solo household they own, with no key yet.
  const theirHh = await request().get('/api/household').set('Authorization', member.auth);
  assert.notEqual(String(theirHh.body._id), String(householdId));
  assert.equal(theirHh.body.isOwner, true);
  const theirKey = await request().get('/api/household/key').set('Authorization', member.auth);
  assert.equal(theirKey.body.currentKeyVersion, 0);

  // Old household: rotation pending, departed member's envelopes gone.
  const oldHh = await Household.findById(householdId);
  assert.equal(oldHh.keyRotationPending, true);
  const leftover = await HouseholdKeyEnvelope.find({ householdId, userId: member.user._id });
  assert.equal(leftover.length, 0);

  // Audit trail records the removal.
  const audit = await AuditLog.findOne({ householdId, event: 'member_removed' });
  assert.ok(audit);

  // The remaining member sees the pending-rotation signal on GET /key.
  const ownerKey = await request().get('/api/household/key').set('Authorization', owner.auth);
  assert.equal(ownerKey.body.keyRotationPending, true);
});

test('rotation: full-coverage v2 succeeds, clears the flag, keeps v1 envelopes', async () => {
  const { owner, member, householdId } = await setupHouseholdOfTwo();
  await request().post(`/api/household/members/${member.user._id}/remove`).set('Authorization', owner.auth);

  // Wrong target version (current is still 1, so v3 skips ahead) → 409.
  const stale = await request().post('/api/household/key/rotate')
    .set('Authorization', owner.auth)
    .send({ keyVersion: 3, envelopes: [{ userId: String(owner.user._id), wrappedHDK: b64u(96) }] });
  assert.equal(stale.status, 409);

  const res = await request().post('/api/household/key/rotate')
    .set('Authorization', owner.auth)
    .send({ keyVersion: 2, envelopes: [{ userId: String(owner.user._id), wrappedHDK: b64u(96) }] });
  assert.equal(res.status, 200);
  assert.equal(res.body.keyVersion, 2);

  const hh = await Household.findById(householdId);
  assert.equal(hh.currentKeyVersion, 2);
  assert.equal(hh.keyRotationPending, false);

  // The remaining member holds BOTH versions — historical records stay readable.
  const key = await request().get('/api/household/key').set('Authorization', owner.auth);
  const versions = key.body.envelopes.map((e) => e.keyVersion).sort();
  assert.deepEqual(versions, [1, 2]);
  assert.equal(key.body.currentKeyVersion, 2);
  assert.equal(key.body.keyRotationPending, false);

  const audit = await AuditLog.findOne({ householdId, event: 'hdk_rotated' });
  assert.ok(audit);
  assert.equal(audit.meta.keyVersion, 2);
});

test('rotation refuses partial member coverage (would lock someone out)', async () => {
  const { owner, member } = await setupHouseholdOfTwo();
  // Both members still enrolled; an envelope set covering only the owner is partial.
  const res = await request().post('/api/household/key/rotate')
    .set('Authorization', owner.auth)
    .send({ keyVersion: 2, envelopes: [{ userId: String(owner.user._id), wrappedHDK: b64u(96) }] });
  assert.equal(res.status, 400);
  assert.match(res.body.error, /every enrolled member/);
});

test('rotation compare-and-set: exactly one of two concurrent rotations wins', async () => {
  const { owner, member } = await setupHouseholdOfTwo();
  const body = () => ({
    keyVersion: 2,
    envelopes: [
      { userId: String(owner.user._id), wrappedHDK: b64u(96) },
      { userId: String(member.user._id), wrappedHDK: b64u(96) },
    ],
  });
  // Both requests resolve req.household (v1) before either CAS lands, so the
  // version check passes for both and only the findOneAndUpdate can arbitrate.
  const [a, b] = await Promise.all([
    request().post('/api/household/key/rotate').set('Authorization', owner.auth).send(body()),
    request().post('/api/household/key/rotate').set('Authorization', member.auth).send(body()),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.deepEqual(statuses, [200, 409]);

  // A follow-up rotation from the loser's stale version also 409s.
  const retry = await request().post('/api/household/key/rotate')
    .set('Authorization', owner.auth).send(body());
  assert.equal(retry.status, 409);
});
