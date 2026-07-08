const test = require('node:test');
const assert = require('node:assert');
const {
  PURGE_WINDOW_DAYS,
  purgeDateFrom,
  canGoLocal,
  isDueForPurge,
  cyrb53,
  buildManifest,
  manifestsMatch,
  isReplicaVerificationFresh,
} = require('./cloudDeletion');

// Pins the hash output so the mobile mirror (lib/storageMode.ts) can't drift
// silently — if this fixed vector changes, the client would compute a different
// fingerprint and every verify would fail.
test('cyrb53 fixed vector (keep mobile mirror in lockstep)', () => {
  assert.equal(cyrb53('CalendarEvent:1:2026-07-01T00:00:00.000Z'), '0bd49fc22e4f41');
});

test('purgeDateFrom lands PURGE_WINDOW_DAYS ahead', () => {
  const now = new Date('2026-07-06T12:00:00Z');
  const due = purgeDateFrom(now);
  const days = (due.getTime() - now.getTime()) / (24 * 60 * 60 * 1000);
  assert.equal(days, PURGE_WINDOW_DAYS);
});

test('canGoLocal only for a solo user', () => {
  assert.equal(canGoLocal({ memberCount: 1 }), true);
  assert.equal(canGoLocal({ memberCount: 0 }), true); // keyless edge
  assert.equal(canGoLocal({ memberCount: 2 }), false);
});

test('isDueForPurge requires scheduled state and a past deadline', () => {
  const now = new Date('2026-07-20T00:00:00Z');
  assert.equal(isDueForPurge({ cloudDeletionState: 'scheduled', cloudDeletionScheduledAt: new Date('2026-07-19') }, now), true);
  assert.equal(isDueForPurge({ cloudDeletionState: 'scheduled', cloudDeletionScheduledAt: new Date('2026-07-21') }, now), false);
  assert.equal(isDueForPurge({ cloudDeletionState: 'none', cloudDeletionScheduledAt: new Date('2026-07-19') }, now), false);
  assert.equal(isDueForPurge({ cloudDeletionState: 'purged', cloudDeletionScheduledAt: new Date('2026-07-19') }, now), false);
  assert.equal(isDueForPurge(null, now), false);
});

test('buildManifest is order-independent and content-free', () => {
  const a = buildManifest([
    { _id: '1', collection: 'Person', updatedAt: '2026-07-01T00:00:00Z' },
    { _id: '2', collection: 'Recipe', updatedAt: '2026-07-02T00:00:00Z' },
  ]);
  const b = buildManifest([
    { _id: '2', collection: 'Recipe', updatedAt: '2026-07-02T00:00:00Z' },
    { _id: '1', collection: 'Person', updatedAt: '2026-07-01T00:00:00Z' },
  ]);
  assert.equal(a.hash, b.hash);
  assert.equal(a.total, 2);
  assert.deepEqual(a.counts, { Person: 1, Recipe: 1 });
});

test('manifestsMatch flags a hash match and reports count deltas', () => {
  const server = buildManifest([
    { _id: '1', collection: 'Person', updatedAt: '2026-07-01T00:00:00Z' },
    { _id: '2', collection: 'Recipe', updatedAt: '2026-07-02T00:00:00Z' },
  ]);
  const complete = buildManifest([
    { _id: '2', collection: 'Recipe', updatedAt: '2026-07-02T00:00:00Z' },
    { _id: '1', collection: 'Person', updatedAt: '2026-07-01T00:00:00Z' },
  ]);
  assert.equal(manifestsMatch(complete, server).match, true);

  const missing = buildManifest([{ _id: '1', collection: 'Person', updatedAt: '2026-07-01T00:00:00Z' }]);
  const r = manifestsMatch(missing, server);
  assert.equal(r.match, false);
  assert.match(r.reasons.join(' '), /Recipe: client has 0, server has 1/);
});

test('manifestsMatch rejects a missing manifest', () => {
  assert.equal(manifestsMatch(null, buildManifest([])).match, false);
});

test('isReplicaVerificationFresh honors the freshness window', () => {
  const now = new Date('2026-07-06T12:00:00Z');
  assert.equal(isReplicaVerificationFresh({ localReplicaVerifiedAt: new Date('2026-07-06T11:59:00Z') }, now), true);
  assert.equal(isReplicaVerificationFresh({ localReplicaVerifiedAt: new Date('2026-07-06T10:00:00Z') }, now), false);
  assert.equal(isReplicaVerificationFresh({ localReplicaVerifiedAt: null }, now), false);
});
