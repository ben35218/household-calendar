const test = require('node:test');
const assert = require('node:assert');
const { isTripShared, excludeSharedFilter, SHARED_TRIP_MATCH } = require('./tripSharing');

test('isTripShared: true when a shareCode is set', () => {
  assert.equal(isTripShared({ shareCode: 'ABC123' }), true);
});

test('isTripShared: true when there is at least one collaborator', () => {
  assert.equal(isTripShared({ collaborators: ['u1'] }), true);
});

test('isTripShared: false for a private trip', () => {
  assert.equal(isTripShared({ collaborators: [] }), false);
  assert.equal(isTripShared({}), false);
  assert.equal(isTripShared(null), false);
});

test('excludeSharedFilter: Trip excludes by _id, TripItem by tripId', () => {
  const ids = ['t1', 't2'];
  assert.deepEqual(excludeSharedFilter('Trip', ids), { _id: { $nin: ids } });
  assert.deepEqual(excludeSharedFilter('TripItem', ids), { tripId: { $nin: ids } });
});

test('excludeSharedFilter: other collections and empty id lists are no-ops', () => {
  assert.deepEqual(excludeSharedFilter('Person', ['t1']), {});
  assert.deepEqual(excludeSharedFilter('Trip', []), {});
  assert.deepEqual(excludeSharedFilter('TripItem', undefined), {});
});

test('SHARED_TRIP_MATCH targets shareCode or non-empty collaborators', () => {
  assert.ok(Array.isArray(SHARED_TRIP_MATCH.$or));
  assert.equal(SHARED_TRIP_MATCH.$or.length, 2);
});
