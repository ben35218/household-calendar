// Signal-parity C3: the unified opaque-record sync loop (lib/records.syncRecords).
// Exercises the decrypt→bucket→upsert / tombstone→remove / cursor-advance logic
// with injected fakes (no crypto/network/storage), pinning that:
//   - opaque rows decrypt and land in their RECOVERED per-collection bucket;
//   - a tombstone removes the row from its bucket;
//   - rows the session can't decrypt are skipped (and the cursor still advances to
//     the server clock so the pull stays incremental);
//   - the `since` cursor is threaded through and updated to serverTime.

import { syncRecords, RecordSyncDeps } from '../records';
import { RecordRow } from '../../api';

function makeDeps(records: RecordRow[], serverTime = '2026-07-19T00:00:05.000Z') {
  const buckets: Record<string, Record<string, unknown>[]> = {};
  const removed: { collection: string; id: string }[] = [];
  let cursor: string | null = null;
  let sentSince: string | null = null;
  const deps: RecordSyncDeps = {
    fetch: async (since) => { sentSince = since; return { records, serverTime }; },
    // Fake decrypt: the fixture puts the collection + fields under `__dec`.
    decrypt: async (row: any) => (row.__dec ? { collection: row.__dec.collection, record: row.__dec.record } : null),
    upsert: async (collection, rows) => { buckets[collection] = [...(buckets[collection] ?? []), ...rows]; },
    remove: async (collection, id) => { removed.push({ collection, id }); },
    getCursor: async () => cursor,
    setCursor: async (c) => { cursor = c; },
  };
  return { deps, buckets, removed, getCursor: () => cursor, getSentSince: () => sentSince };
}

test('opaque rows decrypt and land in their recovered per-collection bucket', async () => {
  const { deps, buckets } = makeDeps([
    { _id: 'a1', updatedAt: 't1', __dec: { collection: 'MaintenanceTask', record: { title: 'Filter' } } } as any,
    { _id: 'p1', updatedAt: 't2', __dec: { collection: 'Person', record: { name: 'Sam' } } } as any,
    { _id: 'a2', updatedAt: 't3', __dec: { collection: 'MaintenanceTask', record: { title: 'Oil' } } } as any,
  ]);
  const res = await syncRecords(deps);
  expect(res.upserted).toBe(3);
  expect(buckets.MaintenanceTask.map((r) => r._id).sort()).toEqual(['a1', 'a2']);
  expect(buckets.Person[0]).toMatchObject({ _id: 'p1', name: 'Sam', updatedAt: 't2' });
});

test('a tombstone removes the row from its bucket', async () => {
  const { deps, removed } = makeDeps([
    { _id: 'x1', deleted: true, updatedAt: 't4', __dec: { collection: 'Chore', record: {} } } as any,
  ]);
  const res = await syncRecords(deps);
  expect(res.removed).toBe(1);
  expect(removed).toEqual([{ collection: 'Chore', id: 'x1' }]);
});

test('undecryptable rows are skipped, not bucketed', async () => {
  const { deps, buckets } = makeDeps([
    { _id: 'lockedvault', updatedAt: 't5' } as any, // no __dec → decrypt returns null
    { _id: 'ok', updatedAt: 't6', __dec: { collection: 'Recipe', record: { title: 'Soup' } } } as any,
  ]);
  const res = await syncRecords(deps);
  expect(res.skipped).toBe(1);
  expect(res.upserted).toBe(1);
  expect(buckets.Recipe).toHaveLength(1);
  expect(buckets.undefined).toBeUndefined();
});

test('the cursor is threaded through and advanced to serverTime', async () => {
  const { deps, getCursor, getSentSince } = makeDeps([], '2026-07-19T09:00:00.000Z');
  await deps.setCursor('2026-07-19T08:00:00.000Z');
  await syncRecords(deps);
  expect(getSentSince()).toBe('2026-07-19T08:00:00.000Z'); // sent as ?since=
  expect(getCursor()).toBe('2026-07-19T09:00:00.000Z');    // advanced to serverTime
});
