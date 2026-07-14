// Tests for anchorRecurrence — the anchor-day normalization applied to
// Calen-created tasks/chores (templates, manuals, Ask Calen).
//
// Run: node --test src/services/recurrence.test.js
const test = require('node:test');
const assert = require('node:assert');
const { anchorRecurrence, computeNextDueDate } = require('./recurrence');

// Monday, July 13 2026 at 9am local — a fixed weekday to anchor against.
const MON = new Date(2026, 6, 13, 9, 0, 0);

test('monthly interval anchors to the 1st of the month', () => {
  const r = anchorRecurrence({ type: 'interval', intervalValue: 1, intervalUnit: 'months' }, MON);
  assert.equal(r.dayOfMonth, 1);
  assert.equal(computeNextDueDate({ recurrence: r }, MON).getDate(), 1);
});

test('multi-month (> monthly) interval anchors to the 1st', () => {
  const r = anchorRecurrence({ type: 'interval', intervalValue: 3, intervalUnit: 'months' }, MON);
  const next = computeNextDueDate({ recurrence: r }, MON);
  assert.equal(next.getDate(), 1);
  assert.equal(next.getMonth(), 9); // October
});

test('yearly interval anchors to the 1st', () => {
  const r = anchorRecurrence({ type: 'interval', intervalValue: 1, intervalUnit: 'years' }, MON);
  assert.equal(r.dayOfMonth, 1);
  assert.equal(computeNextDueDate({ recurrence: r }, MON).getDate(), 1);
});

test('calendar recurrence is forced to the 1st, overriding the template day', () => {
  const r = anchorRecurrence({ type: 'calendar', months: [10], dayOfMonth: 15 }, MON);
  assert.equal(r.dayOfMonth, 1);
  assert.equal(computeNextDueDate({ recurrence: r }, MON).getDate(), 1);
});

test('weekly interval anchors to the created weekday', () => {
  const r = anchorRecurrence({ type: 'interval', intervalValue: 1, intervalUnit: 'weeks' }, MON);
  assert.equal(r.dayOfWeek, 1); // Monday
  assert.equal(computeNextDueDate({ recurrence: r }, MON).getDay(), 1);
});

test('multi-week (still < monthly) anchors to the created weekday', () => {
  const r = anchorRecurrence({ type: 'interval', intervalValue: 2, intervalUnit: 'weeks' }, MON);
  assert.equal(r.dayOfWeek, 1);
  assert.equal(computeNextDueDate({ recurrence: r }, MON).getDay(), 1);
});

test('daily interval is left untouched (no weekday/month anchor)', () => {
  const r = anchorRecurrence({ type: 'interval', intervalValue: 3, intervalUnit: 'days' }, MON);
  assert.equal(r.dayOfMonth, undefined);
  assert.equal(r.dayOfWeek, undefined);
});

test('monthly anchoring drops a stale nth-weekday rule', () => {
  const r = anchorRecurrence(
    { type: 'interval', intervalValue: 1, intervalUnit: 'months', weekOfMonth: 2, dayOfWeek: 3 },
    MON
  );
  assert.equal(r.dayOfMonth, 1);
  assert.equal(r.weekOfMonth, undefined);
  assert.equal(r.dayOfWeek, undefined);
});

test('one-time and empty recurrences pass through unchanged', () => {
  assert.deepEqual(anchorRecurrence({ type: 'one-time' }, MON), { type: 'one-time' });
  assert.equal(anchorRecurrence(null, MON), null);
  assert.equal(anchorRecurrence(undefined, MON), undefined);
});

test('does not mutate the input recurrence', () => {
  const input = { type: 'interval', intervalValue: 1, intervalUnit: 'months' };
  anchorRecurrence(input, MON);
  assert.equal(input.dayOfMonth, undefined);
});
