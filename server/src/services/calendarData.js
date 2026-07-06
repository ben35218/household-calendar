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
const { assembleCalendarData } = require('@household/calendar');

// Fetch the raw source records for a household so a caller can expand them.
// Returns the plain arrays (populated where the CalendarData shape needs names);
// the shared engine does all date filtering + expansion in memory.
async function fetchCalendarSources({ scopeIds, fromDate, toDate }) {
  const userId = { $in: scopeIds };
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

  const sources = await fetchCalendarSources({ scopeIds, fromDate, toDate });

  return assembleCalendarData({
    ...sources,
    fromDate,
    toDate,
    selfId: user ? String(user._id) : null,
    groceryShoppingDay: (household || user)?.groceryShoppingDay ?? 6,
  });
}

module.exports = {
  collectCalendarRecords,
  fetchCalendarSources,
};
