// Client-side calendar loading: fetch raw source records, decrypt them over the
// local replica, and expand into CalendarData with the shared @household/calendar
// engine (the same engine the server runs). Offline-first: falls back to the
// cached source records. See docs/E2EE-SYNC-PLAN.md §9.1 P2.

import { assembleCalendarData } from '@household/calendar';
import { calendarApi, CalendarData } from '../api';
import { openRecord } from './e2ee';
import * as replica from './replica';

// raw-bundle key -> replica collection (also the AEAD collection for decrypt).
const SOURCE_COLLECTIONS: Record<string, string> = {
  events: 'CalendarEvent',
  tasks: 'MaintenanceTask',
  chores: 'Chore',
  people: 'Person',
  trips: 'Trip',
  recipeSchedules: 'RecipeSchedule', // not dual-write; openRecord is a no-op
};

async function decryptAll(collection: string, rows: any[]): Promise<any[]> {
  return Promise.all((rows || []).map((r) => openRecord(collection, r)));
}

export async function loadCalendarData({ from, to }: { from: string; to: string }): Promise<CalendarData> {
  let selfId: string | null = null;
  let groceryShoppingDay = 6;
  let sources: Record<string, any[]> = {};

  try {
    const { data } = await calendarApi.getRaw({ from, to });
    selfId = data.selfId ?? null;
    groceryShoppingDay = data.groceryShoppingDay ?? 6;
    sources = data as unknown as Record<string, any[]>;
    // Best-effort cache the raw source records for offline expansion.
    for (const [key, coll] of Object.entries(SOURCE_COLLECTIONS)) {
      replica.upsert(coll, (data as any)[key] || []).catch(() => {});
    }
  } catch {
    // Offline: rebuild the source set from the cached replica records.
    for (const [key, coll] of Object.entries(SOURCE_COLLECTIONS)) {
      sources[key] = await replica.getAll<any>(coll).catch(() => []);
    }
  }

  // Decrypt content over plaintext (dual-write); no-op without an HDK.
  const [events, tasks, chores, people, trips] = await Promise.all([
    decryptAll('CalendarEvent', sources.events),
    decryptAll('MaintenanceTask', sources.tasks),
    decryptAll('Chore', sources.chores),
    decryptAll('Person', sources.people),
    decryptAll('Trip', sources.trips),
  ]);

  return assembleCalendarData({
    events,
    tasks,
    chores,
    people,
    trips,
    recipeSchedules: sources.recipeSchedules || [],
    fromDate: new Date(from),
    toDate: new Date(to),
    selfId,
    groceryShoppingDay,
  }) as unknown as CalendarData;
}
