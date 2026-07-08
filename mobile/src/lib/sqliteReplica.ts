// SQLite-backed local record replica (Decision D5) — the real store behind the
// same interface replica.ts exposes. One `records(collection, id)` table holds
// the raw server rows (ciphertext post-drop; full plaintext during dual-write —
// either way opaque JSON here, decrypted in memory on read by openRecord).
//
// Needs `expo-sqlite` (native). replica.ts loads this lazily and falls back to
// the AsyncStorage backend if the native module isn't linked yet (pre dev-client
// rebuild), so behavior is identical either way. See docs/E2EE-SYNC-PLAN.md §6 / P7.

import { openDatabaseSync, type SQLiteDatabase } from 'expo-sqlite';

type Row = { _id: string; updatedAt?: string };
type StoredRow = Row & Record<string, unknown>;

let db: SQLiteDatabase | null = null;

// Open (once) and ensure the schema. Throws if the native module is unavailable —
// replica.ts catches that and uses the AsyncStorage backend instead.
function conn(): SQLiteDatabase {
  if (!db) {
    db = openDatabaseSync('hc_replica.db');
    db.execSync(
      'CREATE TABLE IF NOT EXISTS records (' +
      ' collection TEXT NOT NULL, id TEXT NOT NULL, updatedAt TEXT, json TEXT NOT NULL,' +
      ' PRIMARY KEY (collection, id));' +
      'CREATE INDEX IF NOT EXISTS idx_records_collection ON records (collection);',
    );
  }
  return db;
}

export function isAvailable(): boolean {
  try { conn(); return true; } catch { return false; }
}

// Upsert full rows, last-write-wins on updatedAt (a stale row never clobbers a
// fresher one — enforced by the WHERE on conflict).
export async function upsert(collection: string, rows: Row[]): Promise<void> {
  if (!rows?.length) return;
  const d = conn();
  d.withTransactionSync(() => {
    for (const row of rows) {
      d.runSync(
        'INSERT INTO records (collection, id, updatedAt, json) VALUES (?, ?, ?, ?) ' +
        'ON CONFLICT(collection, id) DO UPDATE SET updatedAt=excluded.updatedAt, json=excluded.json ' +
        'WHERE excluded.updatedAt IS NULL OR records.updatedAt IS NULL OR excluded.updatedAt >= records.updatedAt',
        [collection, row._id, row.updatedAt ?? null, JSON.stringify(row)],
      );
    }
  });
}

export async function getAll<T = Row>(collection: string): Promise<T[]> {
  const rows = conn().getAllSync<{ json: string }>('SELECT json FROM records WHERE collection = ?', [collection]);
  return rows.map((r) => JSON.parse(r.json) as StoredRow) as unknown as T[];
}

export async function query<T = Row>(
  collection: string,
  opts: { filter?: (r: T) => boolean; sort?: (a: T, b: T) => number } = {},
): Promise<T[]> {
  let rows = await getAll<T>(collection);
  if (opts.filter) rows = rows.filter(opts.filter);
  if (opts.sort) rows = [...rows].sort(opts.sort);
  return rows;
}

export async function clear(collection: string): Promise<void> {
  conn().runSync('DELETE FROM records WHERE collection = ?', [collection]);
}

export async function clearAll(): Promise<void> {
  conn().runSync('DELETE FROM records');
}
