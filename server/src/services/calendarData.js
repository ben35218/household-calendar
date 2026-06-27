// Shared calendar collection + recurrence expansion.
//
// This is the single source of truth for "what shows on the calendar in a date
// range". Both the calendar API (routes/calendar.js) and the Calendar Assistant
// (routes/calendarChat.js) build on it, so the assistant sees exactly the same
// records — including every expanded occurrence of recurring tasks, chores, and
// events — that the user sees on the /calendar page.

const { addDays, addWeeks, addMonths, addYears, setDate, getDaysInMonth } = require('date-fns');
const MaintenanceTask = require('../models/MaintenanceTask');
const CalendarEvent   = require('../models/CalendarEvent');
const Chore           = require('../models/Chore');
const Person          = require('../models/Person');
const RecipeSchedule  = require('../models/RecipeSchedule');
const Trip            = require('../models/Trip');
const { computeNextDueDate } = require('./recurrence');

// Expand a single recurring event into instances that fall within [fromDate, toDate].
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
  // Preserve the event's duration so each occurrence's endDate tracks its startDate.
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

// Convert any stored date to local noon on the same UTC calendar date.
function toLocalNoon(d) {
  const s = new Date(d).toISOString().slice(0, 10);
  const [y, mo, day] = s.split('-').map(Number);
  return new Date(y, mo - 1, day, 12, 0, 0);
}

// Expand a recurring maintenance task or chore into all instances within [fromDate, toDate].
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

// Return all anniversary occurrences of a birthday within [fromDate, toDate].
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

/**
 * Collect every calendar record visible to a household within [fromDate, toDate],
 * with all recurring tasks, chores, and events expanded into occurrences.
 *
 * Returns: { tasks, chores, events, birthdays, recipes, groceryShopping, trips }
 * (trips are date-range overlays only — no itinerary items.)
 */
async function collectCalendarRecords({ scopeIds, fromDate, toDate, user, household }) {
  const userId = { $in: scopeIds };

  // Ensure the requesting member has a self-record so their birthday shows up.
  if (user) await Person.ensureSelf(user);

  const [tasks, chores, regularEvents, recurringEvents, people, recipeSchedules, trips] = await Promise.all([
    MaintenanceTask.find({ userId, active: true })
      .populate('itemId', 'name')
      .populate('categoryId', 'name icon color')
      .sort('nextDueDate')
      .lean(),

    Chore.find({ userId, active: true })
      .sort('nextDueDate')
      .lean(),

    CalendarEvent.find({
      userId,
      'recurrence.freq': { $exists: false },
      startDate: { $gte: fromDate, $lte: toDate },
    }).sort('startDate').lean(),

    CalendarEvent.find({
      userId,
      'recurrence.freq': { $exists: true },
      startDate: { $lte: toDate },
    }).lean(),

    Person.find({ userId, birthday: { $exists: true, $ne: null } }).lean(),

    RecipeSchedule.find({ userId, scheduledDate: { $gte: fromDate, $lte: toDate } })
      .populate('recipeId', 'title description prepTimeMins cookTimeMins servings')
      .sort('scheduledDate')
      .lean(),

    Trip.find({ userId }).lean(),
  ]);

  const expandedTasks  = tasks.flatMap(t => expandRecurringTaskChore(t, fromDate, toDate));
  const expandedChores = chores.flatMap(c => expandRecurringTaskChore(c, fromDate, toDate));
  const expandedRecurring = recurringEvents.flatMap(e => expandRecurringEvent(e, fromDate, toDate));

  const events = [...regularEvents, ...expandedRecurring]
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate));

  const selfId = user ? String(user._id) : null;
  const birthdaySources = people.map(p => ({
    id:           String(p._id),
    name:         p.name,
    relationship: selfId && String(p.accountId) === selfId ? 'you' : (p.relationship || p.type),
    birthday:     p.birthday,
  }));
  const birthdays = birthdaySources.flatMap(src =>
    birthdayOccurrences(src.birthday, fromDate, toDate).map(date => ({
      id:           `birthday-${src.id}-${date}`,
      name:         src.name,
      relationship: src.relationship,
      date,
      birthYear:    new Date(src.birthday).getUTCFullYear(),
    }))
  ).sort((a, b) => a.date.localeCompare(b.date));

  // Grocery shopping: one cart event per "meal week".
  const groceryShoppingDay = (household || user)?.groceryShoppingDay ?? 6;
  const weeksSeen = new Set();
  const groceryShopping = [];
  for (const s of recipeSchedules) {
    const d = new Date(s.scheduledDate);
    const diff = (d.getDay() - groceryShoppingDay + 7) % 7;
    const groceryDate = new Date(d);
    groceryDate.setDate(d.getDate() - diff);
    groceryDate.setHours(0, 0, 0, 0);
    const weekKey = groceryDate.toISOString().slice(0, 10);
    if (!weeksSeen.has(weekKey)) {
      weeksSeen.add(weekKey);
      if (groceryDate >= fromDate && groceryDate <= toDate) {
        groceryShopping.push({ id: `grocery-${weekKey}`, date: weekKey, weekStart: weekKey });
      }
    }
  }

  // Trip overlays: date ranges only (no itinerary).
  const overlaps = (s, e) => s && e && new Date(s) <= toDate && new Date(e) >= fromDate;
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
    events,
    birthdays,
    recipes: recipeSchedules,
    groceryShopping,
    trips: tripOverlays,
  };
}

module.exports = {
  collectCalendarRecords,
  expandRecurringEvent,
  expandRecurringTaskChore,
  birthdayOccurrences,
};
