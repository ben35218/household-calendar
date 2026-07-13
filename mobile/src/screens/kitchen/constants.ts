// Start the week on the grocery shopping day (0=Sun..6=Sat): the most recent
// occurrence of that weekday on or before `d`. The Planner and Grocery panes
// both key their data to this week start.
export function startOfWeek(d: Date, weekStartDay: number): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const diff = (x.getDay() - weekStartDay + 7) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}

export const iso = (d: Date) => d.toISOString().slice(0, 10);

export type GroceryFrequency = 'weekly' | 'biweekly';

export const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// One-line summary of the schedule for cards/badges: "Every week on Saturday".
export function scheduleSummary(day: number, frequency: GroceryFrequency): string {
  return `${frequency === 'biweekly' ? 'Every 2 weeks' : 'Every week'} on ${DAY_NAMES_FULL[day]}`;
}

// Days covered by one shopping trip: the planner/grocery "week" is really
// this period.
export const periodDaysOf = (frequency: GroceryFrequency) => (frequency === 'biweekly' ? 14 : 7);

// Start of the shopping period containing `d` — weekly this is startOfWeek;
// biweekly it also snaps back to the anchor's parity (anchor = any known
// shopping day, YYYY-MM-DD) so off-weeks fold into the period that bought them.
export function periodStartOf(d: Date, weekStartDay: number, frequency: GroceryFrequency, anchor?: string | null): Date {
  const w = startOfWeek(d, weekStartDay);
  if (frequency !== 'biweekly' || !anchor) return w;
  const a = startOfWeek(new Date(`${anchor}T00:00:00`), weekStartDay);
  const weeks = Math.round((w.getTime() - a.getTime()) / 604800000);
  if (((weeks % 2) + 2) % 2 === 1) w.setDate(w.getDate() - 7);
  return w;
}
