const { addDays, differenceInDays } = require('date-fns');
// Recurrence next-due computation now lives in the shared calendar engine so the
// server, web, and mobile expand identically (docs/E2EE-SYNC-PLAN.md §9.1 P2).
// The km-based estimation helpers below stay server-only.
const { computeNextDueDate } = require('@household/calendar');

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
