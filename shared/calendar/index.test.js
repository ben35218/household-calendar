const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  computeNextDueDate,
  expandRecurringEvent,
  expandRecurringTaskChore,
  birthdayOccurrences,
  assembleCalendarData,
} = require('./index');

const ymd = (d) => new Date(d).toISOString().slice(0, 10);

// ── computeNextDueDate ────────────────────────────────────────────────────────
test('interval days/weeks add correctly', () => {
  const base = new Date('2026-01-01T12:00:00Z');
  assert.equal(ymd(computeNextDueDate({ recurrence: { type: 'interval', intervalUnit: 'days', intervalValue: 10 } }, base)), '2026-01-11');
  assert.equal(ymd(computeNextDueDate({ recurrence: { type: 'interval', intervalUnit: 'weeks', intervalValue: 2 } }, base)), '2026-01-15');
});

test('interval months clamps day to end of target month (Jan 31 + 1mo → Feb 28)', () => {
  const base = new Date('2026-01-31T12:00:00Z');
  const next = computeNextDueDate({ recurrence: { type: 'interval', intervalUnit: 'months', intervalValue: 1 } }, base);
  assert.equal(next.getMonth(), 1);        // February
  assert.equal(next.getDate(), 28);        // clamped (2026 not a leap year)
});

test('one-time returns its stored nextDueDate', () => {
  const d = new Date('2026-05-05');
  assert.equal(computeNextDueDate({ recurrence: { type: 'one-time' }, nextDueDate: d }), d);
});

// ── expandRecurringEvent ──────────────────────────────────────────────────────
test('weekly event expands to the right occurrences and preserves duration', () => {
  const event = {
    _id: 'e1', title: 'Standup',
    startDate: new Date('2026-01-05T09:00:00Z'),
    endDate:   new Date('2026-01-05T09:30:00Z'),
    recurrence: { freq: 'weekly', interval: 1 },
  };
  const out = expandRecurringEvent(event, new Date('2026-01-01'), new Date('2026-01-31'));
  const dates = out.map(o => ymd(o.startDate));
  assert.deepEqual(dates, ['2026-01-05', '2026-01-12', '2026-01-19', '2026-01-26']);
  // 30-minute duration tracks each occurrence.
  assert.equal(new Date(out[0].endDate) - new Date(out[0].startDate), 30 * 60000);
});

test('recurring event respects the until bound', () => {
  const event = {
    startDate: new Date('2026-01-05T09:00:00Z'),
    recurrence: { freq: 'weekly', interval: 1, until: new Date('2026-01-15') },
  };
  const out = expandRecurringEvent(event, new Date('2026-01-01'), new Date('2026-12-31'));
  assert.deepEqual(out.map(o => ymd(o.startDate)), ['2026-01-05', '2026-01-12']);
});

// ── expandRecurringTaskChore ──────────────────────────────────────────────────
test('interval task expands forward within range', () => {
  const task = {
    _id: 't1', title: 'Filter',
    nextDueDate: new Date('2026-01-01T12:00:00'),
    recurrence: { type: 'interval', intervalUnit: 'months', intervalValue: 1 },
  };
  const out = expandRecurringTaskChore(task, new Date('2026-01-01'), new Date('2026-03-31'));
  assert.deepEqual(out.map(o => ymd(o.nextDueDate)), ['2026-01-01', '2026-02-01', '2026-03-01']);
});

test('calendar-type task fires in listed months only', () => {
  const task = {
    recurrence: { type: 'calendar', months: [3, 9], dayOfMonth: 15 },
  };
  const out = expandRecurringTaskChore(task, new Date('2026-01-01'), new Date('2026-12-31'));
  assert.deepEqual(out.map(o => o._instanceDate), ['2026-03-15', '2026-09-15']);
});

// ── birthdayOccurrences ───────────────────────────────────────────────────────
test('birthday recurs yearly on the anniversary', () => {
  const out = birthdayOccurrences(new Date('1990-07-04'), new Date('2026-01-01'), new Date('2027-12-31'));
  assert.deepEqual(out, ['2026-07-04', '2027-07-04']);
});

// ── assembleCalendarData ──────────────────────────────────────────────────────
test('assemble filters, expands, and shapes the full CalendarData', () => {
  const fromDate = new Date('2026-01-01');
  const toDate   = new Date('2026-01-31');
  const data = assembleCalendarData({
    fromDate, toDate, selfId: 'u1', groceryShoppingDay: 6,
    events: [
      { _id: 'reg', title: 'One-off', startDate: new Date('2026-01-10T10:00:00Z') },
      { _id: 'out', title: 'Out of range', startDate: new Date('2026-03-10T10:00:00Z') },
      { _id: 'rec', title: 'Weekly', startDate: new Date('2026-01-05T09:00:00Z'), recurrence: { freq: 'weekly', interval: 1 } },
    ],
    tasks: [
      { _id: 't1', title: 'Active', active: true, nextDueDate: new Date('2026-01-15T12:00:00'), recurrence: { type: 'one-time' } },
      { _id: 't2', title: 'Inactive', active: false, nextDueDate: new Date('2026-01-16T12:00:00'), recurrence: { type: 'one-time' } },
    ],
    chores: [],
    people: [
      { _id: 'p1', name: 'Me', accountId: 'u1', birthday: new Date('1990-01-20') },
      { _id: 'p2', name: 'NoBday' },
    ],
    recipeSchedules: [
      { _id: 's1', scheduledDate: new Date('2026-01-14') },
    ],
    trips: [
      { _id: 'tr1', name: 'Ski', status: 'planned', startDate: new Date('2026-01-08'), endDate: new Date('2026-01-12') },
    ],
  });

  // Regular in-range + expanded weekly, out-of-range dropped.
  assert.equal(data.events.filter(e => e._id === 'out').length, 0);
  assert.ok(data.events.some(e => e._id === 'reg'));
  assert.equal(data.events.filter(e => e._id === 'rec').length, 4);
  // Inactive task filtered out.
  assert.deepEqual(data.tasks.map(t => t._id), ['t1']);
  // Birthday: self labelled "you", people without a birthday dropped.
  assert.equal(data.birthdays.length, 1);
  assert.equal(data.birthdays[0].relationship, 'you');
  // Recipe schedule kept.
  assert.equal(data.recipes.length, 1);
  // Grocery day recurs weekly across the range: Saturdays Jan 3,10,17,24,31.
  assert.equal(data.groceryShopping.length, 5);
  assert.deepEqual(
    data.groceryShopping.map(g => g.date),
    ['2026-01-03', '2026-01-10', '2026-01-17', '2026-01-24', '2026-01-31'],
  );
  // Trip overlay present.
  assert.equal(data.trips.length, 1);
  assert.equal(data.trips[0].ranges.length, 1);
});
