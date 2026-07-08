// Storage-mode / download-first client logic (Phase 6, §6.2).
//
// Before the server will schedule a cloud purge, the client must prove it holds
// a COMPLETE local copy of the user's records. This module does the download-
// first replication (fetch every covered collection into the local replica) and
// builds the manifest the server compares against its own.
//
// The manifest fingerprint is cyrb53 — a deterministic pure-JS hash MIRRORED
// exactly from server/src/services/cloudDeletion.js (pinned by a fixed-vector
// test there). It is a completeness fingerprint over the user's own records, not
// an adversarial integrity check, so a non-crypto hash is the right fit and it
// needs no native module.
//
// Coverage note: attachments (manuals/photos) and any not-yet-replicated data
// are NOT in this manifest, so this is a partial local copy — which is one
// reason the destructive server purge stays deferred (dry-run) for now (§9.2).

import {
  peopleApi,
  tasksApi,
  choresApi,
  recipesApi,
  tripsApi,
  itemsApi,
  inventoryApi,
  calendarApi,
} from '../api';
import * as replica from './replica';

type Row = { _id: string; updatedAt?: string };

// Mirror of server cloudDeletion.cyrb53 — KEEP IN LOCKSTEP (see the fixed-vector
// test in cloudDeletion.test.js).
export function cyrb53(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, '0');
}

// Mirror of server cloudDeletion.buildManifest.
export function buildManifest(records: { _id: string; collection: string; updatedAt?: string }[]) {
  const counts: Record<string, number> = {};
  const lines: string[] = [];
  for (const r of records) {
    const collection = r.collection || 'Unknown';
    counts[collection] = (counts[collection] || 0) + 1;
    const updated = r.updatedAt ? new Date(r.updatedAt).toISOString() : '';
    lines.push(`${collection}:${String(r._id)}:${updated}`);
  }
  lines.sort();
  return { total: records.length, counts, hash: cyrb53(lines.join('\n')) };
}

// Each covered collection and how to fetch ALL of its records for this user.
// MUST enumerate the same collections as MANIFEST_MODELS on the server, fully
// (no status/range filters — completeness is the point). FoodInventory needs
// every status; CalendarEvent has no plain list, so pull raw source rows over a
// window wide enough to include every event.
const CALENDAR_WINDOW = { from: '1900-01-01', to: '2200-01-01' };

async function fetchAll(): Promise<{ collection: string; rows: Row[] }[]> {
  const [people, tasks, chores, recipes, trips, items, invActive, invUsed, invTossed, raw] =
    await Promise.all([
      peopleApi.list().then((r) => r.data),
      tasksApi.list().then((r) => r.data),
      choresApi.list().then((r) => r.data),
      recipesApi.list().then((r) => r.data),
      tripsApi.list().then((r) => r.data),
      itemsApi.list().then((r) => r.data),
      inventoryApi.list({ status: 'active' }).then((r) => r.data),
      inventoryApi.list({ status: 'used' }).then((r) => r.data),
      inventoryApi.list({ status: 'thrown_out' }).then((r) => r.data),
      calendarApi.getRaw(CALENDAR_WINDOW).then((r) => r.data),
    ]);
  // Trips are cross-household: tripsApi.list() also returns trips you're only a
  // COLLABORATOR on (owned by another household). Those aren't your data to take
  // device-only or purge, and the server manifest counts only trips you own
  // (userId === you) — so exclude collaborator trips here to keep the client and
  // server manifests in lockstep. Going-local is solo-only, so "owned" is simply
  // userId === self (from /calendar/raw's selfId).
  const selfId = raw.selfId ? String(raw.selfId) : null;
  const ownedTrips = selfId
    ? (trips as Array<Row & { userId?: unknown }>).filter((t) => String(t.userId) === selfId)
    : (trips as Row[]);
  return [
    { collection: 'CalendarEvent', rows: (raw.events || []) as Row[] },
    { collection: 'Person', rows: people as Row[] },
    { collection: 'MaintenanceTask', rows: tasks as Row[] },
    { collection: 'Chore', rows: chores as Row[] },
    { collection: 'Recipe', rows: recipes as Row[] },
    { collection: 'Trip', rows: ownedTrips as Row[] },
    { collection: 'Item', rows: items as Row[] },
    { collection: 'FoodInventory', rows: [...invActive, ...invUsed, ...invTossed] as Row[] },
  ];
}

// Download-first: fetch every covered collection, persist it into the local
// replica, and return the manifest to send to the server. Throws if any fetch
// fails (so we never claim a complete copy on a partial download).
export async function replicateAndBuildManifest() {
  const groups = await fetchAll();
  const records: { _id: string; collection: string; updatedAt?: string }[] = [];
  for (const { collection, rows } of groups) {
    await replica.upsert(collection, rows);
    for (const r of rows) records.push({ _id: r._id, collection, updatedAt: r.updatedAt });
  }
  return buildManifest(records);
}
