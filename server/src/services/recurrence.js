const {
  addDays, addWeeks, addMonths, addYears,
  setDate, setMonth, getDay, getDaysInMonth,
  isAfter, startOfDay, differenceInDays,
} = require('date-fns');

// Advance `date` forward to the nearest occurrence of `targetWeekday` (0=Sun…6=Sat).
// If `date` already falls on that weekday, returns `date` unchanged.
function snapToWeekday(date, targetWeekday) {
  const diff = (targetWeekday - getDay(date) + 7) % 7;
  return diff === 0 ? date : addDays(date, diff);
}

// Clamp day-of-month to the actual number of days in the month (e.g. Feb 30 → Feb 28).
function clampDay(date, day) {
  return setDate(date, Math.min(day, getDaysInMonth(date)));
}

// Return the nth occurrence of dayOfWeek (0=Sun…6=Sat) within the month of `date`.
// weekOfMonth: 1=first, 2=second, 3=third, 4=fourth, -1=last.
function nthWeekdayOfMonth(date, weekOfMonth, dayOfWeek) {
  const year = date.getFullYear();
  const month = date.getMonth();

  if (weekOfMonth === -1) {
    // Walk back from the last day of the month.
    let d = new Date(year, month + 1, 0);
    while (getDay(d) !== dayOfWeek) d = addDays(d, -1);
    return d;
  }

  // Find the first occurrence of dayOfWeek in this month, then jump by weeks.
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

module.exports = { computeNextDueDate, avgKmPerDay, estimateDateFromKm, computeNextDueKm };
