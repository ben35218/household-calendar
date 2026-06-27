const cron = require('node-cron');
const { addDays, addWeeks, addMonths, addYears } = require('date-fns');
const MaintenanceTask = require('../models/MaintenanceTask');
const Chore = require('../models/Chore');
const User = require('../models/User');
const Household = require('../models/Household');
const Person = require('../models/Person');
const CalendarEvent = require('../models/CalendarEvent');
const { pushToUser } = require('../services/notify');
const { isConfigured: pushConfigured } = require('../services/push');
const { cleanupOrphanUploads } = require('./cleanupOrphanUploads');

const APP_URL = () => process.env.APP_URL || 'http://localhost:5173';

// 0-23 hour in a timezone.
function localHour(tz) {
  const parts = new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz })
    .formatToParts(new Date());
  return parseInt(parts.find(p => p.type === 'hour').value, 10) % 24;
}

// "YYYY-MM-DD" in a timezone for a given instant.
function localDateStr(tz, date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(date);
}

// Subtract whole days from a "YYYY-MM-DD" calendar string.
function dateStrMinusDays(isoDateStr, days) {
  const d = new Date(isoDateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - (days || 0));
  return d.toISOString().slice(0, 10);
}

// Resolve the users an item's alert should reach, given its audience and the
// household's members. 'owner' → just the creator; 'everyone' → all members.
function audienceUsers(item, members) {
  if (item.alertAudience === 'owner') {
    return members.filter(m => String(m._id) === String(item.userId));
  }
  return members;
}

async function pushToUsers(users, payload) {
  for (const u of users) await pushToUser(u, payload);
}

// ── Daily per-item alerts (tasks, chores, birthdays) ────────────────────────
// Runs hourly; fires per-household at 07:00 local. Tasks/chores alert on
// (dueDate − reminderDaysBefore) and the optional second alert; birthdays
// always alert on the day, to everyone.
async function runDailyCheck() {
  console.log('[Scheduler] Daily alert check at', new Date().toISOString());
  if (!pushConfigured()) return;   // push is the only channel
  const households = await Household.find({});

  for (const hh of households) {
    try {
      await runDailyCheckForHousehold(hh);
    } catch (err) {
      // One bad household (e.g. an invalid timezone) must not abort the rest.
      console.error(`[Scheduler] Daily check failed for household ${hh._id}:`, err.message);
    }
  }
}

async function runDailyCheckForHousehold(hh) {
  {
    const tz = hh.timezone || 'America/Toronto';
    if (localHour(tz) !== 7) return;
    const todayStr = localDateStr(tz);

    const members = await User.find({ householdId: hh._id });
    if (!members.length) return;
    const memberIds = members.map(m => m._id);

    const [tasks, chores, persons] = await Promise.all([
      MaintenanceTask.find({ userId: { $in: memberIds }, active: true, nextDueDate: { $ne: null } }).populate('itemId', 'name').lean(),
      Chore.find({ userId: { $in: memberIds }, active: true, nextDueDate: { $ne: null } }).lean(),
      Person.find({ userId: { $in: memberIds }, birthday: { $ne: null } }).lean(),
    ]);

    // Tasks
    for (const t of tasks) {
      if (!alertsToday(t, todayStr)) continue;
      const url = `${APP_URL()}/tasks`;
      await pushToUsers(audienceUsers(t, members), {
        title: 'Maintenance due',
        body: t.itemId?.name ? `${t.title} (${t.itemId.name})` : t.title,
        url, tag: `task-${t._id}`,
      });
      console.log(`[Scheduler] Task alert: ${t.title}`);
    }

    // Chores
    for (const c of chores) {
      if (!alertsToday(c, todayStr)) continue;
      await pushToUsers(audienceUsers(c, members), {
        title: 'Chore due', body: c.title, url: `${APP_URL()}/chores`, tag: `chore-${c._id}`,
      });
      console.log(`[Scheduler] Chore alert: ${c.title}`);
    }

    // Birthdays — always, to everyone.
    const [, mo, day] = todayStr.split('-');
    for (const p of persons) {
      const b = new Date(p.birthday);
      const bMo = String(b.getUTCMonth() + 1).padStart(2, '0');
      const bDay = String(b.getUTCDate()).padStart(2, '0');
      if (bMo !== mo || bDay !== day) continue;
      const turning = Number(todayStr.slice(0, 4)) - b.getUTCFullYear();
      await pushToUsers(members, {
        title: '🎂 Birthday today',
        body: turning > 0 ? `${p.name} turns ${turning} today` : `${p.name}'s birthday is today`,
        url: `${APP_URL()}/people`, tag: `bday-${p._id}-${todayStr}`,
      });
      console.log(`[Scheduler] Birthday alert: ${p.name}`);
    }
  }
}

// Does a task/chore have an alert landing on `todayStr`? Checks both the
// primary (reminderDaysBefore) and secondary (alert2DaysBefore) offsets.
// null offset = that alert is off.
function alertsToday(item, todayStr) {
  const dueStr = new Date(item.nextDueDate).toISOString().slice(0, 10);
  for (const off of [item.reminderDaysBefore, item.alert2DaysBefore]) {
    if (off == null) continue;
    if (dateStrMinusDays(dueStr, off) === todayStr) return true;
  }
  return false;
}

// ── Event reminders — every 15 min, precise per-occurrence ──────────────────
async function runEventReminderCheck() {
  if (!pushConfigured()) return;
  const now       = new Date();
  const windowEnd = new Date(now.getTime() + 15 * 60 * 1000);

  await fireOneShotReminders('reminderAt', 'reminderSentAt', now, windowEnd);
  await fireOneShotReminders('alert2At', 'alert2SentAt', now, windowEnd);
  await fireRecurringReminders(now, windowEnd);
}

async function fireOneShotReminders(atField, sentField, now, windowEnd) {
  const events = await CalendarEvent.find({
    [atField]: { $gte: now, $lte: windowEnd },
    [sentField]: { $exists: false },
    'recurrence.freq': { $exists: false },
  }).lean();

  for (const event of events) {
    await fanOutEventReminder(event);
    await CalendarEvent.updateOne({ _id: event._id }, { [sentField]: new Date() });
  }
}

async function fireRecurringReminders(now, windowEnd) {
  const events = await CalendarEvent.find({
    'recurrence.freq': { $exists: true },
    reminderMinutes: { $exists: true, $ne: null },
  }).lean();

  const advance = {
    daily: d => addDays(d, 1), weekly: d => addWeeks(d, 1),
    monthly: d => addMonths(d, 1), yearly: d => addYears(d, 1),
  };

  for (const event of events) {
    const { freq, interval = 1, until } = event.recurrence;
    const step = advance[freq];
    if (!step) continue;
    const untilD = until ? new Date(until) : null;

    for (const minsField of ['reminderMinutes', 'alert2Minutes']) {
      const mins = event[minsField];
      if (mins == null) continue;

      // Walk occurrences whose alert time could fall in [now, windowEnd).
      // Exclusive upper bound so consecutive 15-min windows never double-fire.
      let occ = new Date(event.startDate);
      let guard = 0;
      while (guard++ < 1000) {
        if (untilD && occ > untilD) break;
        const alertAt = new Date(occ.getTime() - mins * 60000);
        if (alertAt >= windowEnd) break;
        if (alertAt >= now) await fanOutEventReminder({ ...event, startDate: occ });
        let n = occ;
        for (let i = 0; i < interval; i++) n = step(n);
        if (n <= occ) break;
        occ = n;
      }
    }
  }
}

// Push an event reminder to its audience across the creator's household.
async function fanOutEventReminder(event) {
  const owner = await User.findById(event.userId).lean();
  if (!owner) return;
  const members = owner.householdId
    ? await User.find({ householdId: owner.householdId })
    : [await User.findById(owner._id)];

  const when = new Date(event.startDate).toLocaleString('en-CA', event.allDay
    ? { weekday: 'short', month: 'short', day: 'numeric' }
    : { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });

  await pushToUsers(audienceUsers(event, members), {
    title: `Reminder: ${event.title}`,
    body: event.location || when,
    url: `${APP_URL()}/calendar`,
    tag: `event-${event._id}-${new Date(event.startDate).toISOString()}`,
  });
  console.log(`[Scheduler] Event alert: ${event.title}`);
}

function startScheduler() {
  cron.schedule('0 * * * *', () => runDailyCheck().catch(err =>
    console.error('[Scheduler] runDailyCheck failed:', err.message)));
  cron.schedule('*/15 * * * *', () => runEventReminderCheck().catch(err =>
    console.error('[Scheduler] runEventReminderCheck failed:', err.message)));
  cron.schedule('30 3 * * *', () => cleanupOrphanUploads().catch(err =>
    console.error('[Scheduler] cleanupOrphanUploads failed:', err.message)));
  console.log('[Scheduler] Per-item push alerts: daily check hourly (fires 07:00 local for tasks/chores/birthdays); event reminders every 15 min; orphan-upload cleanup at 03:30');
}

module.exports = { startScheduler, runDailyCheck, runEventReminderCheck };
