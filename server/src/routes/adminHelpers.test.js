const test = require('node:test');
const assert = require('node:assert');
const {
  escapeRegex, buildUserFilter, paginate, summarizeReadiness, readinessRank,
  validateRoleChange, blockingMembers, metaToString,
} = require('./adminHelpers');

test('escapeRegex neutralizes regex metacharacters', () => {
  assert.equal(escapeRegex('a.b*c'), 'a\\.b\\*c');
  assert.equal(escapeRegex('plain'), 'plain');
  // The escaped string, used as a RegExp, only matches the literal text.
  const rx = new RegExp(escapeRegex('a.b'), 'i');
  assert.ok(rx.test('A.B'));
  assert.ok(!rx.test('axb'));
});

test('buildUserFilter: blank query matches all', () => {
  assert.deepEqual(buildUserFilter(''), {});
  assert.deepEqual(buildUserFilter('   '), {});
  assert.deepEqual(buildUserFilter(undefined), {});
});

test('buildUserFilter: builds a case-insensitive $or over email + name', () => {
  const f = buildUserFilter('ann');
  assert.ok(Array.isArray(f.$or) && f.$or.length === 3);
  assert.ok(f.$or[0].email instanceof RegExp);
  assert.ok(f.$or[0].email.flags.includes('i'));
  assert.ok(f.$or[0].email.test('ANN@example.com'));
});

test('paginate: defaults, clamping, and skip math', () => {
  assert.deepEqual(paginate({}), { page: 1, pageSize: 50, skip: 0 });
  assert.deepEqual(paginate({ page: 3, pageSize: 20 }), { page: 3, pageSize: 20, skip: 40 });
  // Below-range values are clamped up (page→1, size→1); above-max clamped down.
  assert.deepEqual(paginate({ page: 0, pageSize: -5 }), { page: 1, pageSize: 1, skip: 0 });
  assert.equal(paginate({ pageSize: 9999 }).pageSize, 200);
  assert.equal(paginate({ pageSize: 9999 }, { maxSize: 500 }).pageSize, 500);
  // Non-numeric input falls back to defaults.
  assert.deepEqual(paginate({ page: 'x', pageSize: 'y' }), { page: 1, pageSize: 50, skip: 0 });
});

const member = (id, pub, ver) => ({ _id: id, email: `${id}@x`, identityPublicKey: pub, clientVersion: ver });
const env = (userId, keyVersion) => ({ userId, keyVersion });

test('summarizeReadiness: rolls computeReadiness into compact counts', () => {
  const s = summarizeReadiness({
    members: [member('a', 'PKa'), member('b', 'PKb')],
    envelopes: [env('a', 1), env('b', 1)],
    currentKeyVersion: 1,
  });
  assert.equal(s.ready, true);
  assert.equal(s.enrolled, 2);
  assert.equal(s.total, 2);
  assert.equal(s.blockers, 0);
});

test('summarizeReadiness: counts blockers when a member is not enrolled', () => {
  const s = summarizeReadiness({
    members: [member('a', 'PKa'), member('b', null)],
    envelopes: [env('a', 1)],
    currentKeyVersion: 1,
  });
  assert.equal(s.ready, false);
  assert.equal(s.enrolled, 1);
  assert.equal(s.total, 2);
  assert.ok(s.blockers >= 1);
});

test('readinessRank orders not-ready < ready < live', () => {
  assert.equal(readinessRank({ e2eeActive: false, ready: false }), 0);
  assert.equal(readinessRank({ e2eeActive: false, ready: true }), 1);
  assert.equal(readinessRank({ e2eeActive: true, ready: true }), 2);
  const rows = [
    { name: 'live', e2eeActive: true, ready: true },
    { name: 'notready', e2eeActive: false, ready: false },
    { name: 'ready', e2eeActive: false, ready: true },
  ].sort((a, b) => readinessRank(a) - readinessRank(b));
  assert.deepEqual(rows.map((r) => r.name), ['notready', 'ready', 'live']);
});

test('validateRoleChange: rejects unknown roles', () => {
  const r = validateRoleChange({ targetId: 'a', actorId: 'b', role: 'superuser' });
  assert.equal(r.ok, false);
  assert.equal(r.status, 400);
});

test('validateRoleChange: blocks self-demotion but allows self-grant and other changes', () => {
  assert.equal(validateRoleChange({ targetId: 'a', actorId: 'a', role: 'user' }).ok, false);
  assert.equal(validateRoleChange({ targetId: 'a', actorId: 'a', role: 'admin' }).ok, true);
  assert.equal(validateRoleChange({ targetId: 'a', actorId: 'b', role: 'user' }).ok, true);
});

test('blockingMembers: returns members lacking enrollment, a current envelope, or a compatible build', () => {
  const members = [
    { _id: 'a', identityPublicKey: 'PKa', clientVersion: '2.0.0' }, // ok
    { _id: 'b', identityPublicKey: null, clientVersion: '2.0.0' },  // not enrolled
    { _id: 'c', identityPublicKey: 'PKc', clientVersion: '1.0.0' }, // stale build
  ];
  const envByUser = { a: 1, b: 1, c: 1 };
  const out = blockingMembers({
    members, envByUser, currentKeyVersion: 1,
    versionOk: (m) => m.clientVersion === '2.0.0',
  });
  assert.deepEqual(out.map((m) => m._id).sort(), ['b', 'c']);
});

test('blockingMembers: everyone blocks when no HDK exists yet', () => {
  const members = [{ _id: 'a', identityPublicKey: 'PKa' }];
  const out = blockingMembers({ members, envByUser: { a: 0 }, currentKeyVersion: 0 });
  assert.equal(out.length, 1);
});

test('metaToString formats and tolerates empties', () => {
  assert.equal(metaToString({ from: 'free', to: 'premium' }), 'from: free, to: premium');
  assert.equal(metaToString({}), '');
  assert.equal(metaToString(null), '');
});
