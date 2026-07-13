// Shared calendar collection + recurrence expansion.
//
// This is the server's fetch-and-populate layer. The actual recurrence
// expansion + CalendarData assembly lives in the shared @household/calendar
// engine, so the server-expanded path (this + routes/calendarChat.js) and the
// client-expanded path (over the decrypted replica) can never diverge.
// See docs/E2EE-SYNC-PLAN.md §9.1 P2.

const MaintenanceTask = require('../models/MaintenanceTask');
const CalendarEvent   = require('../models/CalendarEvent');
const Chore           = require('../models/Chore');
const Person          = require('../models/Person');
const RecipeSchedule  = require('../models/RecipeSchedule');
const Trip            = require('../models/Trip');
const CustomCalendar  = require('../models/CustomCalendar');
const { assembleCalendarData } = require('@household/calendar');

// Fetch the raw source records for a household so a caller can expand them.
// Returns the plain arrays (populated where the CalendarData shape needs names);
// the shared engine does all date filtering + expansion in memory.
async function fetchCalendarSources({ scopeIds, requesterId, fromDate, toDate, allDates = false }) {
  const userId = { $in: scopeIds };
  // Trips mirror trips.js accessFilter: household-owned OR joined as a
  // collaborator via share code, so shared trips appear on the calendar too.
  const tripQuery = requesterId
    ? { $or: [{ userId }, { collaborators: requesterId }] }
    : { userId };
  // Widen the event scope by calendarType key (keys are globally unique — see
  // models/CustomCalendar.js) for two custom-calendar cases:
  //  - calendars this requester joined as an outside collaborator: their
  //    events come from the sharer's household;
  //  - calendars this household OWNS: full-access outside collaborators create
  //    events under their own userId, which the household must still see.
  // (The $in arms of the collaborator query cover legacy plain-id rows.)
  const sharedCalKeys = requesterId
    ? await CustomCalendar.find({
        $or: [{ 'collaborators.userId': requesterId }, { collaborators: requesterId }],
      }).distinct('key')
    : [];
  const ownedCalKeys = await CustomCalendar.find({ userId }).distinct('key');
  const calKeys = [...new Set([...sharedCalKeys, ...ownedCalKeys])];
  const eventScope = calKeys.length
    ? { $or: [{ userId }, { calendarType: { $in: calKeys } }] }
    : { userId };
  // Post-drop (§9.1 P6) the date/birthday fields are encrypted, so the server
  // can't filter on them — it returns every event/person and the client filters
  // via the shared engine. Pre-drop it keeps the efficient bounded queries.
  // (Outside-shared calendar events are exempt from the drop, so their dates
  // stay filterable either way.)
  // Overlap test, not start-only: a multi-day event that began before `fromDate`
  // still touches the window through its endDate, so a tight window (e.g. the day
  // view's ±7 days) must not drop it. Wrapped in $and so it composes with any
  // $or in eventScope. Events with no endDate fall back to their startDate.
  const regularEventQuery = allDates
    ? { ...eventScope, 'recurrence.freq': { $exists: false } }
    : {
        ...eventScope,
        'recurrence.freq': { $exists: false },
        startDate: { $lte: toDate },
        $and: [{ $or: [
          { endDate: { $gte: fromDate } },
          { endDate: null, startDate: { $gte: fromDate } },
        ] }],
      };
  const recurringEventQuery = allDates
    ? { ...eventScope, 'recurrence.freq': { $exists: true } }
    : { ...eventScope, 'recurrence.freq': { $exists: true }, startDate: { $lte: toDate } };
  const peopleQuery = allDates ? { userId } : { userId, birthday: { $exists: true, $ne: null } };

  const [tasks, chores, regularEvents, recurringEvents, people, recipeSchedules, trips] = await Promise.all([
    MaintenanceTask.find({ userId, active: true })
      .populate('itemId', 'name')
      .populate('categoryId', 'name icon color')
      .sort('nextDueDate')
      .lean(),

    Chore.find({ userId, active: true })
      .sort('nextDueDate')
      .lean(),

    CalendarEvent.find(regularEventQuery).sort('startDate').lean(),

    CalendarEvent.find(recurringEventQuery).lean(),

    Person.find(peopleQuery).lean(),

    RecipeSchedule.find({ userId, scheduledDate: { $gte: fromDate, $lte: toDate } })
      .populate('recipeId', 'title description prepTimeMins cookTimeMins servings')
      .sort('scheduledDate')
      .lean(),

    Trip.find(tripQuery).lean(),
  ]);

  return { tasks, chores, events: [...regularEvents, ...recurringEvents], people, recipeSchedules, trips };
}

/**
 * Collect every calendar record visible to a household within [fromDate, toDate],
 * with all recurring tasks, chores, and events expanded into occurrences.
 *
 * Returns: { tasks, chores, events, birthdays, recipes, groceryShopping, trips }.
 */
async function collectCalendarRecords({ scopeIds, fromDate, toDate, user, household }) {
  // Ensure the requesting member has a self-record so their birthday shows up.
  // (No-op once the household is E2EE-active — the client seeds it; see Person.js.)
  if (user) await Person.ensureSelf(user);

  const sources = await fetchCalendarSources({ scopeIds, requesterId: user?._id, fromDate, toDate });

  return assembleCalendarData({
    ...sources,
    fromDate,
    toDate,
    selfId: user ? String(user._id) : null,
    groceryShoppingDay: (household || user)?.groceryShoppingDay ?? 6,
    groceryFrequency: (household || user)?.groceryFrequency ?? 'weekly',
    groceryAnchor: (household || user)?.groceryAnchor ?? null,
  });
}

module.exports = {
  collectCalendarRecords,
  fetchCalendarSources,
};
