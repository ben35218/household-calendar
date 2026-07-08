// Shared calendar range-expansion engine.
//
// Pure, dependency-free (no date-fns, no DB, no network) so the SAME code runs
// on the server (CommonJS require), web (Vite), and mobile (Metro). This is the
// single source of truth for "recurrence -> occurrences in a date range" and the
// assembled CalendarData shape, so the server-expanded path (routes/calendar.js
// + the Calendar Assistant) and the client-expanded path (over the decrypted
// local replica, post-§9-drop) can never diverge.
//
// See docs/E2EE-SYNC-PLAN.md §9.1 P2.

// ── Date helpers (match date-fns semantics used by the former server engine) ──
function getDaysInMonth(d) {
  return new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
}
function addDays(d, n) {
  const r = new Date(d);
  r.setDate(r.getDate() + n);
  return r;
}
function addWeeks(d, n) { return addDays(d, n * 7); }
// date-fns clamps the day to the last day of the target month (Jan 31 + 1mo → Feb 28).
function addMonths(d, n) {
  const r = new Date(d);
  const day = r.getDate();
  r.setDate(1);
  r.setMonth(r.getMonth() + n);
  r.setDate(Math.min(day, getDaysInMonth(r)));
  return r;
}
function addYears(d, n) { return addMonths(d, n * 12); }
function setMonth(d, month) {
  const r = new Date(d);
  const day = r.getDate();
  r.setDate(1);
  r.setMonth(month);
  r.setDate(Math.min(day, getDaysInMonth(r)));
  return r;
}
function setDate(d, day) {
  const r = new Date(d);
  r.setDate(day);
  return r;
}
function getDay(d) { return d.getDay(); }
function isAfter(a, b) { return a.getTime() > b.getTime(); }
function startOfDay(d) {
  const r = new Date(d);
  r.setHours(0, 0, 0, 0);
  return r;
}

// ── Next-due-date computation (task/chore recurrence) ────────────────────────
function snapToWeekday(date, targetWeekday) {
  const diff = (targetWeekday - getDay(date) + 7) % 7;
  return diff === 0 ? date : addDays(date, diff);
}
function clampDay(date, day) {
  return setDate(date, Math.min(day, getDaysInMonth(date)));
}
// nth occurrence of dayOfWeek within date's month. weekOfMonth: 1..4, -1=last.
function nthWeekdayOfMonth(date, weekOfMonth, dayOfWeek) {
  const year = date.getFullYear();
  const month = date.getMonth();
  if (weekOfMonth === -1) {
    let d = new Date(year, month + 1, 0);
    while (getDay(d) !== dayOfWeek) d = addDays(d, -1);
    return d;
  }
  let d = new Date(year, month, 1);
  while (getDay(d) !== dayOfWeek) d = addDays(d, 1);
  return addWeeks(d, weekOfMonth - 1);
}

function computeNextDueDate(task, fromDate) {
  const base = fromDate ? new Date(fromDate) : new Date();
  const r = task.recurrence;

  if (!r || r.type === 'one-time') return task.nextDueDate || null;

  if (r.type === 'interval') {
    const { intervalValue: v, intervalUnit: u, dayOfWeek, dayOfMonth, months } = r;
    if (u === 'days') return addDays(base, v);
    if (u === 'weeks') {
      const next = addWeeks(base, v);
      return dayOfWeek != null ? snapToWeekday(next, dayOfWeek) : next;
    }
    if (u === 'months') {
      const next = addMonths(base, v);
      if (r.weekOfMonth != null && dayOfWeek != null) return nthWeekdayOfMonth(next, r.weekOfMonth, dayOfWeek);
      return dayOfMonth ? clampDay(next, dayOfMonth) : next;
    }
    if (u === 'years') {
      let next = addYears(base, v);
      if (months && months.length) next = setMonth(next, months[0] - 1);
      if (dayOfMonth) next = clampDay(next, dayOfMonth);
      return next;
    }
  }

  if (r.type === 'calendar') {
    const months = r.months && r.months.length ? r.months : null;
    const day = r.dayOfMonth || 1;
    const today = startOfDay(new Date());
    if (months) {
      const candidates = months
        .map(m => {
          let d = clampDay(setMonth(new Date(today.getFullYear(), 0, 1), m - 1), day);
          if (!isAfter(d, base)) d = clampDay(setMonth(new Date(today.getFullYear() + 1, 0, 1), m - 1), day);
          return d;
        })
        .sort((a, b) => a - b);
      return candidates[0];
    }
  }

  return null;
}

// ── Recurring-event expansion (calendar events) ──────────────────────────────
function expandRecurringEvent(event, fromDate, toDate) {
  const { freq, interval = 1, until } = event.recurrence;
  const advance = {
    daily:   d => addDays(d, interval),
    weekly:  d => addWeeks(d, interval),
    monthly: d => addMonths(d, interval),
    yearly:  d => addYears(d, interval),
  }[freq];
  if (!advance) return [];

  const endBound = (until && new Date(until) < toDate) ? new Date(until) : new Date(toDate);
  const durationMs = event.endDate ? new Date(event.endDate) - new Date(event.startDate) : null;
  const instances = [];
  let cursor = new Date(event.startDate);

  while (cursor < fromDate) cursor = advance(cursor);
  while (cursor <= endBound) {
    const startDate = new Date(cursor);
    instances.push({
      ...event,
      startDate,
      endDate: durationMs != null ? new Date(startDate.getTime() + durationMs) : event.endDate,
      _instanceDate: cursor.toISOString().slice(0, 10),
    });
    cursor = advance(new Date(cursor));
  }
  return instances;
}

function toLocalNoon(d) {
  const s = new Date(d).toISOString().slice(0, 10);
  const [y, mo, day] = s.split('-').map(Number);
  return new Date(y, mo - 1, day, 12, 0, 0);
}

function expandRecurringTaskChore(item, fromDate, toDate) {
  const r = item.recurrence;

  if (!r || r.type === 'one-time') {
    const d = item.nextDueDate ? new Date(item.nextDueDate) : null;
    if (d && d >= fromDate && d <= toDate) {
      return [{ ...item, _instanceDate: d.toISOString().slice(0, 10) }];
    }
    return [];
  }

  if (r.type === 'calendar') {
    const months = r.months && r.months.length ? r.months : null;
    const day = r.dayOfMonth || 1;
    if (!months) return [];

    const instances = [];
    for (let year = fromDate.getFullYear(); year <= toDate.getFullYear(); year++) {
      for (const m of months) {
        const base = new Date(year, m - 1, 1);
        const d = setDate(base, Math.min(day, getDaysInMonth(base)));
        if (d >= fromDate && d <= toDate) {
          instances.push({ ...item, nextDueDate: d, _instanceDate: d.toISOString().slice(0, 10) });
        }
      }
    }
    return instances.sort((a, b) => new Date(a.nextDueDate) - new Date(b.nextDueDate));
  }

  // interval type: iterate forward from nextDueDate using computeNextDueDate.
  if (!item.nextDueDate) return [];

  const instances = [];
  let cursor = toLocalNoon(item.nextDueDate);

  let safety = 0;
  while (cursor < fromDate && safety < 1000) {
    safety++;
    const next = computeNextDueDate(item, cursor);
    if (!next) break;
    const nextNoon = toLocalNoon(next);
    if (nextNoon <= cursor) break;
    cursor = nextNoon;
  }

  safety = 0;
  while (cursor <= toDate && safety < 500) {
    safety++;
    if (cursor >= fromDate) {
      instances.push({ ...item, nextDueDate: new Date(cursor), _instanceDate: cursor.toISOString().slice(0, 10) });
    }
    const next = computeNextDueDate(item, cursor);
    if (!next) break;
    const nextNoon = toLocalNoon(next);
    if (nextNoon <= cursor) break;
    cursor = nextNoon;
  }

  return instances;
}

// ── Birthdays ────────────────────────────────────────────────────────────────
function birthdayOccurrences(birthdayDate, fromDate, toDate) {
  const d = new Date(birthdayDate);
  const month = d.getUTCMonth();
  const day   = d.getUTCDate();
  const results = [];
  for (let y = fromDate.getFullYear(); y <= toDate.getFullYear(); y++) {
    const occ = new Date(y, month, day);
    if (occ >= fromDate && occ <= toDate) {
      results.push(occ.toISOString().slice(0, 10));
    }
  }
  return results;
}

// ── Assemble the full CalendarData shape from raw records ─────────────────────
//
// Pure: pass already-fetched raw records (server: Mongo + populate; client:
// decrypted replica). Owns ALL date filtering in memory so no server-side index
// on the (soon-encrypted) date fields is needed. Returns the exact shape the
// clients already render: { tasks, chores, events, birthdays, recipes,
// groceryShopping, trips }.
function assembleCalendarData({
  events = [], tasks = [], chores = [], people = [],
  recipeSchedules = [], trips = [],
  fromDate, toDate, selfId = null, groceryShoppingDay = 6,
}) {
  const from = new Date(fromDate);
  const to   = new Date(toDate);

  const regularEvents = events
    .filter(e => !e.recurrence || !e.recurrence.freq)
    .filter(e => e.startDate && new Date(e.startDate) >= from && new Date(e.startDate) <= to);
  const recurringEvents = events
    .filter(e => e.recurrence && e.recurrence.freq)
    .filter(e => e.startDate && new Date(e.startDate) <= to);

  const activeTasks  = tasks.filter(t => t.active !== false);
  const activeChores = chores.filter(c => c.active !== false);

  const expandedTasks  = activeTasks.flatMap(t => expandRecurringTaskChore(t, from, to));
  const expandedChores = activeChores.flatMap(c => expandRecurringTaskChore(c, from, to));
  const expandedRecurring = recurringEvents.flatMap(e => expandRecurringEvent(e, from, to));

  const evented = [...regularEvents, ...expandedRecurring]
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

  const birthdaySources = people
    .filter(p => p.birthday != null)
    .map(p => ({
      id:           String(p._id),
      name:         p.name,
      relationship: selfId && String(p.accountId) === selfId ? 'you' : (p.relationship || p.type),
      birthday:     p.birthday,
    }));
  const birthdays = birthdaySources.flatMap(src =>
    birthdayOccurrences(src.birthday, from, to).map(date => ({
      id:           `birthday-${src.id}-${date}`,
      name:         src.name,
      relationship: src.relationship,
      date,
      birthYear:    new Date(src.birthday).getUTCFullYear(),
    }))
  ).sort((a, b) => a.date.localeCompare(b.date));

  const scheduledInRange = recipeSchedules
    .filter(s => s.scheduledDate && new Date(s.scheduledDate) >= from && new Date(s.scheduledDate) <= to)
    .sort((a, b) => new Date(a.scheduledDate) - new Date(b.scheduledDate));

  // Grocery shopping day: a weekly marker on the configured weekday for every
  // week in view — it recurs regardless of whether meals are scheduled that week
  // (mirrors the planner, which always badges the grocery day). Local-midnight
  // dates match the birthday/day-cell convention.
  const groceryShopping = [];
  {
    // First grocery weekday on or after `from` (UTC, matching the range bounds
    // and the toISOString date keys used throughout this engine).
    const g = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate()));
    g.setUTCDate(g.getUTCDate() + ((groceryShoppingDay - g.getUTCDay() + 7) % 7));
    for (; g <= to; g.setUTCDate(g.getUTCDate() + 7)) {
      const weekKey = g.toISOString().slice(0, 10);
      groceryShopping.push({ id: `grocery-${weekKey}`, date: weekKey, weekStart: weekKey });
    }
  }

  // Trip overlays: date ranges only (no itinerary).
  const overlaps = (s, e) => s && e && new Date(s) <= to && new Date(e) >= from;
  const tripOverlays = trips.flatMap(t => {
    let ranges = [];
    if (t.status === 'considering') {
      ranges = (t.candidateRanges ?? [])
        .filter(r => overlaps(r.start, r.end))
        .map(r => ({ start: r.start, end: r.end, label: r.label }));
    } else if (overlaps(t.startDate, t.endDate || t.startDate)) {
      ranges = [{ start: t.startDate, end: t.endDate || t.startDate }];
    }
    if (!ranges.length) return [];
    return [{ id: String(t._id), name: t.name, destination: t.destination, color: t.color, status: t.status, ranges }];
  });

  return {
    tasks: expandedTasks,
    chores: expandedChores,
    events: evented,
    birthdays,
    recipes: scheduledInRange,
    groceryShopping,
    trips: tripOverlays,
  };
}

module.exports = {
  computeNextDueDate,
  expandRecurringEvent,
  expandRecurringTaskChore,
  birthdayOccurrences,
  assembleCalendarData,
};
