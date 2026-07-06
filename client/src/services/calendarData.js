// Client-side calendar loading: fetch raw source records, decrypt them over the
// local replica, and expand into CalendarData with the shared @household/calendar
// engine (the same engine the server runs). Offline-first: falls back to the
// cached source records. See docs/E2EE-SYNC-PLAN.md §9.1 P2.

import { calendarApi } from './api';
import { openRecord } from './e2ee';
import * as replica from './replica';
import { assembleCalendarData } from '@household/calendar';

// raw-bundle key -> replica collection (also the AEAD collection for decrypt).
const SOURCE_COLLECTIONS = {
  events:          'CalendarEvent',
  tasks:           'MaintenanceTask',
  chores:          'Chore',
  people:          'Person',
  trips:           'Trip',
  recipeSchedules: 'RecipeSchedule', // not dual-write; openRecord is a no-op
};

async function decryptAll(collection, rows) {
  return Promise.all((rows || []).map((r) => openRecord(collection, r)));
}

// Fetch + decrypt the raw calendar source records (offline-first). Returns the
// decrypted sources ready for the shared engine — also sent to the Calendar
// Assistant so list_events/call_business run without server plaintext (§9.1 P4c).
export async function loadCalendarSources({ from, to }) {
  let selfId = null;
  let groceryShoppingDay = 6;
  let raw;

  try {
    const { data } = await calendarApi.getRaw({ from, to });
    selfId = data.selfId ?? null;
    groceryShoppingDay = data.groceryShoppingDay ?? 6;
    raw = data;
    // Best-effort cache the raw source records for offline expansion.
    for (const [key, coll] of Object.entries(SOURCE_COLLECTIONS)) {
      replica.upsert(coll, data[key] || []).catch(() => {});
    }
  } catch (e) {
    // Offline: rebuild the source set from the cached replica records.
    raw = {};
    for (const [key, coll] of Object.entries(SOURCE_COLLECTIONS)) {
      raw[key] = await replica.getAll(coll).catch(() => []);
    }
  }

  // Decrypt content over plaintext (dual-write); no-op without an HDK.
  const [events, tasks, chores, people, trips] = await Promise.all([
    decryptAll('CalendarEvent', raw.events),
    decryptAll('MaintenanceTask', raw.tasks),
    decryptAll('Chore', raw.chores),
    decryptAll('Person', raw.people),
    decryptAll('Trip', raw.trips),
  ]);

  return { events, tasks, chores, people, trips, recipeSchedules: raw.recipeSchedules || [], selfId, groceryShoppingDay };
}

export async function loadCalendarData({ from, to }) {
  const s = await loadCalendarSources({ from, to });
  return assembleCalendarData({
    events: s.events, tasks: s.tasks, chores: s.chores, people: s.people, trips: s.trips,
    recipeSchedules: s.recipeSchedules,
    fromDate: new Date(from),
    toDate: new Date(to),
    selfId: s.selfId,
    groceryShoppingDay: s.groceryShoppingDay,
  });
}
