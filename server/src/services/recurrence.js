const { addDays, differenceInDays } = require('date-fns');
// Recurrence next-due computation now lives in the shared calendar engine so the
// server, web, and mobile expand identically (docs/E2EE-SYNC-PLAN.md §9.1 P2).
// The km-based estimation helpers below stay server-only.
const { computeNextDueDate } = require('@household/calendar');

// Give a Calvin-generated recurrence (from a template, a manual, or Ask Calvin) a
// clean anchor day so it doesn't land on an arbitrary date:
//   • monthly or longer (months/years intervals, or calendar) → the 1st of the
//     month it occurs in.
//   • weekly → the same weekday it's created on.
//   • daily → left alone (it just fires every N days).
// User-authored recurrences (the Repeat screen) are never routed through here.
function anchorRecurrence(recurrence, fromDate = new Date()) {
  if (!recurrence || !recurrence.type) return recurrence;
  const r = { ...recurrence };

  if (r.type === 'calendar') {
    r.dayOfMonth = 1;
    return r;
  }

  if (r.type === 'interval') {
    if (r.intervalUnit === 'months' || r.intervalUnit === 'years') {
      r.dayOfMonth = 1;
      // Anchor by calendar day, not an nth-weekday rule.
      delete r.weekOfMonth;
      delete r.dayOfWeek;
    } else if (r.intervalUnit === 'weeks') {
      r.dayOfWeek = new Date(fromDate).getDay();
      delete r.weekOfMonth;
      delete r.dayOfMonth;
    }
  }

  return r;
}

// Calculate average km/day from an array of odometer log entries.
function avgKmPerDay(logs) {
  if (!logs || logs.length < 2) return null;
  const sorted = [...logs].sort((a, b) => new Date(a.recordedAt) - new Date(b.recordedAt));
  const days = differenceInDays(new Date(sorted[sorted.length - 1].recordedAt), new Date(sorted[0].recordedAt));
  if (days === 0) return null;
  return (sorted[sorted.length - 1].reading - sorted[0].reading) / days;
}

// Estimate the calendar date a task will come due based on remaining km.
function estimateDateFromKm(nextDueKm, currentKm, kmPerDay) {
  if (!kmPerDay || kmPerDay <= 0) return null;
  const remainingKm = nextDueKm - currentKm;
  if (remainingKm <= 0) return new Date();
  return addDays(new Date(), Math.ceil(remainingKm / kmPerDay));
}

// Compute next due km threshold after completing a mileage task.
function computeNextDueKm(task, serviceKm) {
  if (!task.intervalKm || serviceKm == null) return null;
  return serviceKm + task.intervalKm;
}

module.exports = { computeNextDueDate, anchorRecurrence, avgKmPerDay, estimateDateFromKm, computeNextDueKm };
