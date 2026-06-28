import { CalendarData, CalendarEvent, Task, Chore } from '../api';

// Calendar category colors (mirrors CalendarView's `calendars`).
export const CALENDAR_COLORS: Record<string, string> = {
  maintenance: '#1976D2',
  activities: '#388E3C',
  appointments: '#7B1FA2',
  chores: '#F57C00',
  recipes: '#00897B',
  vacations: '#5E35B1',
  birthdays: '#E91E63',
  'canadian-holidays': '#D32F2F',
};

export const EVENT_CALENDAR_TYPES = [
  { label: 'Activities', value: 'activities' },
  { label: 'Appointments', value: 'appointments' },
];

export function eventColor(e: CalendarEvent): string {
  return CALENDAR_COLORS[e.calendarType] || '#388E3C';
}

function localDate(d: string): string {
  return new Date(d).toISOString().slice(0, 10);
}

export interface DayItems {
  events: CalendarEvent[];
  tasks: Task[];
  chores: Chore[];
  recipes: { title: string; recipeId?: string }[];
  trips: { id: string; name: string; color: string; status?: string }[];
  birthdays: { id: string; name: string }[];
  grocery: boolean;
}

// All calendar records that touch a given yyyy-MM-dd date.
export function itemsForDate(data: CalendarData | undefined, dateStr: string): DayItems {
  if (!data) {
    return { events: [], tasks: [], chores: [], recipes: [], trips: [], birthdays: [], grocery: false };
  }

  const events = (data.events ?? []).filter((e) => {
    const start = localDate(e.startDate);
    const end = e.endDate ? localDate(e.endDate) : start;
    return dateStr >= start && dateStr <= end;
  });

  const tasks = (data.tasks ?? []).filter((t) => t.nextDueDate && localDate(t.nextDueDate) === dateStr);
  const chores = (data.chores ?? []).filter((c) => c.nextDueDate && localDate(c.nextDueDate) === dateStr);

  const recipes = (data.recipes ?? [])
    .filter((r) => localDate(r.scheduledDate) === dateStr)
    .map((r) => ({
      title: typeof r.recipeId === 'object' ? r.recipeId?.title || 'Recipe' : 'Recipe',
      recipeId: typeof r.recipeId === 'object' ? r.recipeId?._id : (r.recipeId as string | undefined),
    }));

  const trips = (data.trips ?? [])
    .filter((t) => (t.ranges ?? []).some((r) => dateStr >= localDate(r.start) && dateStr <= localDate(r.end)))
    .map((t) => ({ id: t.id, name: t.name, color: t.color || CALENDAR_COLORS.vacations, status: t.status }));

  const birthdays = (data.birthdays ?? []).filter((b) => localDate(b.date) === dateStr).map((b) => ({ id: b.id, name: b.name }));

  const grocery = (data.groceryShopping ?? []).some((g) => g.date === dateStr);

  return { events, tasks, chores, recipes, trips, birthdays, grocery };
}

// Up-to-`max` dot colors for a day cell.
export function dayDots(data: CalendarData | undefined, dateStr: string, max = 4): string[] {
  const d = itemsForDate(data, dateStr);
  const dots: string[] = [];
  d.trips.forEach((t) => dots.push(t.color));
  d.events.forEach((e) => dots.push(eventColor(e)));
  if (d.tasks.length) dots.push(CALENDAR_COLORS.maintenance);
  if (d.chores.length) dots.push(CALENDAR_COLORS.chores);
  if (d.recipes.length) dots.push(CALENDAR_COLORS.recipes);
  if (d.birthdays.length) dots.push(CALENDAR_COLORS.birthdays);
  return dots.slice(0, max);
}

// Multi-day spanning bars (trips + multi-day events) for one week row. Each bar
// is lane-packed so overlapping spans stack. Mirrors the web's trip/event bars.
export interface WeekBar {
  key: string;
  color: string;
  label: string;
  startCol: number;
  endCol: number;
  lane: number;
}

export function weekBars(data: CalendarData | undefined, weekDates: string[], maxLanes = 2): WeekBar[] {
  if (!data || weekDates.length !== 7) return [];
  const weekStart = weekDates[0];
  const weekEnd = weekDates[6];
  const colOf = (dateStr: string) => {
    if (dateStr < weekStart) return 0;
    if (dateStr > weekEnd) return 6;
    return weekDates.indexOf(dateStr);
  };

  const spans: { color: string; label: string; start: string; end: string }[] = [];
  for (const t of data.trips ?? []) {
    for (const r of t.ranges ?? []) {
      const s = localDate(r.start);
      const e = localDate(r.end);
      if (e >= weekStart && s <= weekEnd) spans.push({ color: t.color || CALENDAR_COLORS.vacations, label: t.name, start: s, end: e });
    }
  }
  for (const ev of data.events ?? []) {
    const s = localDate(ev.startDate);
    const e = ev.endDate ? localDate(ev.endDate) : s;
    if (e > s && e >= weekStart && s <= weekEnd) spans.push({ color: eventColor(ev), label: ev.title, start: s, end: e });
  }

  spans.sort((a, b) => (a.start < b.start ? -1 : 1));
  const laneEnds: number[] = [];
  const bars: WeekBar[] = [];
  for (const sp of spans) {
    const startCol = colOf(sp.start);
    const endCol = colOf(sp.end);
    let lane = laneEnds.findIndex((end) => startCol > end);
    if (lane === -1) { lane = laneEnds.length; laneEnds.push(endCol); }
    else laneEnds[lane] = endCol;
    if (lane < maxLanes) bars.push({ key: `${sp.label}-${sp.start}-${lane}`, color: sp.color, label: sp.label, startCol, endCol, lane });
  }
  return bars;
}

// Build a calendar month grid (6 weeks, Sunday-first) of yyyy-MM-dd cells.
export interface MonthGrid {
  key: string;
  label: string;
  weeks: { date: string; day: number; currentMonth: boolean; isToday: boolean }[][];
}

export function buildMonth(year: number, month: number): MonthGrid {
  const first = new Date(year, month, 1);
  const todayStr = new Date().toISOString().slice(0, 10);
  const startOffset = first.getDay(); // 0=Sun
  const gridStart = new Date(year, month, 1 - startOffset);

  const cells: MonthGrid['weeks'][number] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(gridStart);
    d.setDate(gridStart.getDate() + i);
    const pad = (n: number) => String(n).padStart(2, '0');
    const dateStr = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    cells.push({
      date: dateStr,
      day: d.getDate(),
      currentMonth: d.getMonth() === month,
      isToday: dateStr === todayStr,
    });
  }

  const weeks: MonthGrid['weeks'] = [];
  for (let w = 0; w < 6; w++) weeks.push(cells.slice(w * 7, w * 7 + 7));

  return {
    key: `${year}-${String(month + 1).padStart(2, '0')}`,
    label: first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' }),
    weeks,
  };
}
