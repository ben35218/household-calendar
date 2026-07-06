// Local record replica (mobile) — Phase 4b foundation.
//
// Mirrors client/src/services/replica.js: an offline cache of household records
// so the app can paint instantly and query/sort/filter client-side. Sync is
// last-write-wins on the server's `updatedAt` (decision D6).
//
// Backend note: this interim implementation uses AsyncStorage (already a dep, so
// it runs on the current dev client with no native rebuild). Decision D5 is
// expo-sqlite for the real store — swap it in behind this same interface once a
// dev-client rebuild adds the native module. See docs/E2EE-SYNC-PLAN.md §6.

import AsyncStorage from '@react-native-async-storage/async-storage';

// The minimal shape the replica needs from any record; concrete model types
// (Recipe, Item, …) satisfy it structurally without an index signature.
type Row = { _id: string; updatedAt?: string };
type StoredRow = Row & Record<string, unknown>;

const key = (collection: string) => `hc_replica:${collection}`;

async function readMap(collection: string): Promise<Record<string, StoredRow>> {
  try {
    const raw = await AsyncStorage.getItem(key(collection));
    return raw ? (JSON.parse(raw) as Record<string, StoredRow>) : {};
  } catch {
    return {};
  }
}

// Upsert full records, last-write-wins on `updatedAt` (a stale row never
// overwrites a fresher one).
export async function upsert(collection: string, rows: Row[]): Promise<void> {
  if (!rows?.length) return;
  const map = await readMap(collection);
  for (const row of rows) {
    const existing = map[row._id];
    if (existing && new Date(existing.updatedAt || 0) > new Date(row.updatedAt || 0)) continue;
    map[row._id] = row as StoredRow;
  }
  await AsyncStorage.setItem(key(collection), JSON.stringify(map));
}

export async function getAll<T = Row>(collection: string): Promise<T[]> {
  return Object.values(await readMap(collection)) as unknown as T[];
}

// Client-side query: fetch a collection, then filter/sort in memory.
export async function query<T = Row>(
  collection: string,
  opts: { filter?: (r: T) => boolean; sort?: (a: T, b: T) => number } = {},
): Promise<T[]> {
  let rows = await getAll<T>(collection);
  if (opts.filter) rows = rows.filter(opts.filter);
  if (opts.sort) rows = [...rows].sort(opts.sort);
  return rows;
}

// Offline-first list fetch: run `fetcher` (returns full records), sync into the
// replica, and return it — falling back to the cached copy when the fetch fails.
export async function syncedList<T extends Row>(
  collection: string,
  fetcher: () => Promise<T[]>,
): Promise<T[]> {
  try {
    const rows = await fetcher();
    upsert(collection, rows).catch(() => {});
    return rows;
  } catch (e) {
    const cached = await getAll<T>(collection);
    if (cached.length) return cached;
    throw e;
  }
}

export async function clear(collection: string): Promise<void> {
  await AsyncStorage.removeItem(key(collection));
}
