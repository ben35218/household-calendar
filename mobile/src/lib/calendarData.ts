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

export interface CalendarSources {
  events: any[]; tasks: any[]; chores: any[]; people: any[]; trips: any[];
  recipeSchedules: any[]; selfId: string | null; groceryShoppingDay: number;
}

// Fetch + decrypt the raw calendar sources (offline-first). Reused by the
// Calendar Assistant so list_events/call_business run without server plaintext
// (§9.1 P4c).
export async function loadCalendarSources({ from, to }: { from: string; to: string }): Promise<CalendarSources> {
  let selfId: string | null = null;
  let groceryShoppingDay = 6;
  let raw: Record<string, any[]> = {};

  try {
    const { data } = await calendarApi.getRaw({ from, to });
    selfId = data.selfId ?? null;
    groceryShoppingDay = data.groceryShoppingDay ?? 6;
    raw = data as unknown as Record<string, any[]>;
    for (const [key, coll] of Object.entries(SOURCE_COLLECTIONS)) {
      replica.upsert(coll, (data as any)[key] || []).catch(() => {});
    }
  } catch {
    for (const [key, coll] of Object.entries(SOURCE_COLLECTIONS)) {
      raw[key] = await replica.getAll<any>(coll).catch(() => []);
    }
  }

  const [events, tasks, chores, people, trips] = await Promise.all([
    decryptAll('CalendarEvent', raw.events),
    decryptAll('MaintenanceTask', raw.tasks),
    decryptAll('Chore', raw.chores),
    decryptAll('Person', raw.people),
    decryptAll('Trip', raw.trips),
  ]);

  return { events, tasks, chores, people, trips, recipeSchedules: raw.recipeSchedules || [], selfId, groceryShoppingDay };
}

export async function loadCalendarData({ from, to }: { from: string; to: string }): Promise<CalendarData> {
  const s = await loadCalendarSources({ from, to });
  return assembleCalendarData({
    events: s.events,
    tasks: s.tasks,
    chores: s.chores,
    people: s.people,
    trips: s.trips,
    recipeSchedules: s.recipeSchedules,
    fromDate: new Date(from),
    toDate: new Date(to),
    selfId: s.selfId,
    groceryShoppingDay: s.groceryShoppingDay,
  }) as unknown as CalendarData;
}
