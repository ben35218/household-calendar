// Local record replica (web) — Phase 4b foundation.
//
// An offline cache of household records in IndexedDB, so the app can paint
// instantly and (later) query/sort/filter entirely client-side instead of
// hitting the server for every list. During dual-write the server still returns
// full plaintext records, so the replica stores those as-is; once the plaintext
// drop lands (enc covers every field) this store switches to holding ciphertext
// rows that are decrypted into memory on unlock. Same interface either way.
//
// Sync is last-write-wins on the server's `updatedAt` (decision D6 — no client
// merge engine in v1). See docs/E2EE-SYNC-PLAN.md §6 / Phase 4.

const DB_NAME = 'hc_replica';
const DB_VERSION = 1;
const STORE = 'records'; // one store, keyed by _id, indexed by collection

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') { reject(new Error('IndexedDB unavailable')); return; }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: '_id' });
        store.createIndex('collection', '_collection', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(db, mode) {
  return db.transaction(STORE, mode).objectStore(STORE);
}

// Upsert full records for a collection, last-write-wins on `updatedAt`: an
// incoming row only overwrites an existing one when it's newer (so a stale
// background refresh can't clobber a fresher local copy).
export async function upsert(collection, rows) {
  if (!rows?.length) return;
  const db = await openDB();
  const store = tx(db, 'readwrite');
  await Promise.all(rows.map((row) => new Promise((resolve) => {
    const getReq = store.get(row._id);
    getReq.onsuccess = () => {
      const existing = getReq.result;
      if (existing && new Date(existing.updatedAt || 0) > new Date(row.updatedAt || 0)) { resolve(); return; }
      store.put({ ...row, _collection: collection });
      resolve();
    };
    getReq.onerror = () => resolve();
  })));
}

// All records for a collection (full plaintext rows during dual-write).
export async function getAll(collection) {
  const db = await openDB();
  return new Promise((resolve) => {
    const req = tx(db, 'readonly').index('collection').getAll(collection);
    req.onsuccess = () => resolve((req.result || []).map(stripInternal));
    req.onerror = () => resolve([]);
  });
}

// Client-side query over the replica: fetch a collection, then filter/sort in
// memory (the model that replaces server-side list queries once fields are
// encrypted). `opts.filter` and `opts.sort` are plain array predicates.
export async function query(collection, opts = {}) {
  let rows = await getAll(collection);
  if (opts.filter) rows = rows.filter(opts.filter);
  if (opts.sort) rows = rows.slice().sort(opts.sort);
  return rows;
}

// Offline-first list fetch: run `fetcher` (returns an array of full records),
// sync the result into the replica, and return it — but if the fetch fails and
// the replica has a cached copy, return that instead. Screens stay one-liners.
export async function syncedList(collection, fetcher) {
  try {
    const rows = await fetcher();
    upsert(collection, rows).catch(() => {});
    return rows;
  } catch (e) {
    const cached = await getAll(collection).catch(() => []);
    if (cached.length) return cached;
    throw e;
  }
}

export async function remove(id) {
  const db = await openDB();
  tx(db, 'readwrite').delete(id);
}

export async function clear(collection) {
  const rows = await getAll(collection);
  const db = await openDB();
  const store = tx(db, 'readwrite');
  for (const r of rows) store.delete(r._id);
}

function stripInternal(row) {
  const { _collection, ...rest } = row;
  return rest;
}
