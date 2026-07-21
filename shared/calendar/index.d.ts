// Type declarations for the shared calendar engine (@household/calendar).
// The engine is pure JS; these types keep TS consumers (mobile) honest at the
// boundary. Record shapes are intentionally loose (Record<string, any>) since
// each platform passes its own model objects through.

export type AnyRecord = Record<string, any>;

export interface AssembleInput {
  events?: AnyRecord[];
  tasks?: AnyRecord[];
  chores?: AnyRecord[];
  people?: AnyRecord[];
  recipeSchedules?: AnyRecord[];
  trips?: AnyRecord[];
  fromDate: Date | string | number;
  toDate: Date | string | number;
  selfId?: string | null;
  groceryShoppingDay?: number | null;
  groceryFrequency?: 'weekly' | 'biweekly';
  groceryAnchor?: string | null;
}

export interface CalendarBirthday {
  id: string;
  name: string;
  relationship: string;
  date: string;
  birthYear: number;
}

export interface CalendarTripOverlay {
  id: string;
  name?: string;
  destination?: string;
  color?: string;
  status?: string;
  ranges: { start: any; end: any; label?: string }[];
}

export interface CalendarData {
  tasks: AnyRecord[];
  chores: AnyRecord[];
  events: AnyRecord[];
  birthdays: CalendarBirthday[];
  recipes: AnyRecord[];
  groceryShopping: { id: string; date: string; weekStart: string }[];
  trips: CalendarTripOverlay[];
}

export function computeNextDueDate(task: AnyRecord, fromDate?: Date | string | number | null): Date | null;
export function anchorRecurrence<T extends AnyRecord | null | undefined>(recurrence: T, fromDate?: Date | string | number): T;
export function seedDueDate(recurrence: AnyRecord | null | undefined, fromDate?: Date | string | number): Date | null;
export function avgKmPerDay(logs: Array<{ reading: number; recordedAt: Date | string }> | null | undefined): number | null;
export function estimateDateFromKm(nextDueKm: number, currentKm: number, kmPerDay: number | null | undefined): Date | null;
export function computeNextDueKm(task: { intervalKm?: number | null }, serviceKm: number | null | undefined): number | null;
export function expandRecurringEvent(event: AnyRecord, fromDate: Date, toDate: Date): AnyRecord[];
export function expandRecurringTaskChore(item: AnyRecord, fromDate: Date, toDate: Date): AnyRecord[];
export function birthdayOccurrences(birthdayDate: Date | string, fromDate: Date, toDate: Date): string[];
export function assembleCalendarData(input: AssembleInput): CalendarData;
