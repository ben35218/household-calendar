// Recurrence + mileage scheduling now live in the shared calendar engine so the
// server, web, and mobile compute identically (docs/E2EE-SYNC-PLAN.md §9.1 P2;
// Signal-parity D4/D5 moved the km helpers there too — the client owns the
// nextDueDate lifecycle and odometer math; the server only re-exports these for
// the plaintext-lane paths and its own tests).
const {
  computeNextDueDate,
  anchorRecurrence,
  seedDueDate,
  avgKmPerDay,
  estimateDateFromKm,
  computeNextDueKm,
} = require('@household/calendar');

module.exports = { computeNextDueDate, anchorRecurrence, seedDueDate, avgKmPerDay, estimateDateFromKm, computeNextDueKm };
