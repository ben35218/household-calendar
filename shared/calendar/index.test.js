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

test('custom interval event skips the in-between periods', () => {
  const event = {
    startDate: new Date('2026-01-05T09:00:00Z'),
    recurrence: { freq: 'weekly', interval: 2 },
  };
  const out = expandRecurringEvent(event, new Date('2026-01-01'), new Date('2026-02-15'));
  assert.deepEqual(out.map(o => ymd(o.startDate)), ['2026-01-05', '2026-01-19', '2026-02-02']);
});

test('weekly event on chosen weekdays emits each selected day', () => {
  // 2026-01-05 is a Monday. Mon/Wed/Fri, every week.
  const event = {
    startDate: new Date('2026-01-05T09:00:00Z'),
    recurrence: { freq: 'weekly', interval: 1, daysOfWeek: [1, 3, 5] },
  };
  const out = expandRecurringEvent(event, new Date('2026-01-01'), new Date('2026-01-17'));
  assert.deepEqual(out.map(o => ymd(o.startDate)), [
    '2026-01-05', '2026-01-07', '2026-01-09',
    '2026-01-12', '2026-01-14', '2026-01-16',
  ]);
});

test('biweekly event on chosen weekdays skips the off week', () => {
  const event = {
    startDate: new Date('2026-01-05T09:00:00Z'),
    recurrence: { freq: 'weekly', interval: 2, daysOfWeek: [1, 5] },
  };
  const out = expandRecurringEvent(event, new Date('2026-01-01'), new Date('2026-01-31'));
  assert.deepEqual(out.map(o => ymd(o.startDate)), ['2026-01-05', '2026-01-09', '2026-01-19', '2026-01-23']);
});

test('monthly event on numbered dates emits each date and skips short months', () => {
  const event = {
    startDate: new Date('2026-01-05T09:00:00Z'),
    recurrence: { freq: 'monthly', interval: 1, daysOfMonth: [5, 31] },
  };
  const out = expandRecurringEvent(event, new Date('2026-01-01'), new Date('2026-04-01'));
  // February has no 31st.
  assert.deepEqual(out.map(o => ymd(o.startDate)), ['2026-01-05', '2026-01-31', '2026-02-05', '2026-03-05', '2026-03-31']);
});

test('monthly ordinal rules: second Tuesday, last weekday, next-to-last day', () => {
  const range = [new Date('2026-01-01'), new Date('2026-02-28')];
  const base = { startDate: new Date('2026-01-01T09:00:00Z') };

  const secondTue = expandRecurringEvent(
    { ...base, recurrence: { freq: 'monthly', interval: 1, weekOfMonth: 2, weekdayKind: 'tue' } }, ...range);
  assert.deepEqual(secondTue.map(o => ymd(o.startDate)), ['2026-01-13', '2026-02-10']);

  const lastWeekday = expandRecurringEvent(
    { ...base, recurrence: { freq: 'monthly', interval: 1, weekOfMonth: -1, weekdayKind: 'weekday' } }, ...range);
  // Jan 31 2026 is a Saturday → last weekday is Fri Jan 30; Feb 27 is a Friday.
  assert.deepEqual(lastWeekday.map(o => ymd(o.startDate)), ['2026-01-30', '2026-02-27']);

  const nextToLastDay = expandRecurringEvent(
    { ...base, recurrence: { freq: 'monthly', interval: 1, weekOfMonth: -2, weekdayKind: 'day' } }, ...range);
  assert.deepEqual(nextToLastDay.map(o => ymd(o.startDate)), ['2026-01-30', '2026-02-27']);
});

test('monthly ordinal rule skips months without a match (no 5th Friday)', () => {
  const event = {
    startDate: new Date('2026-01-01T09:00:00Z'),
    recurrence: { freq: 'monthly', interval: 1, weekOfMonth: 5, weekdayKind: 'fri' },
  };
  const out = expandRecurringEvent(event, new Date('2026-01-01'), new Date('2026-06-30'));
  // Only Jan (Jan 30) and May (May 29) 2026 have five Fridays.
  assert.deepEqual(out.map(o => ymd(o.startDate)), ['2026-01-30', '2026-05-29']);
});

test('pattern days before the event start are not emitted', () => {
  // Starts Wed 2026-01-07 with Mon+Wed selected: Mon Jan 5 precedes the start.
  const event = {
    startDate: new Date('2026-01-07T09:00:00Z'),
    recurrence: { freq: 'weekly', interval: 1, daysOfWeek: [1, 3] },
  };
  const out = expandRecurringEvent(event, new Date('2026-01-01'), new Date('2026-01-15'));
  assert.deepEqual(out.map(o => ymd(o.startDate)), ['2026-01-07', '2026-01-12', '2026-01-14']);
});

test('yearly event in chosen months repeats on the start day of each month', () => {
  const event = {
    startDate: new Date('2026-03-15T09:00:00Z'),
    recurrence: { freq: 'yearly', interval: 1, months: [3, 6, 11] },
  };
  const out = expandRecurringEvent(event, new Date('2026-01-01'), new Date('2027-12-31'));
  assert.deepEqual(out.map(o => ymd(o.startDate)), [
    '2026-03-15', '2026-06-15', '2026-11-15',
    '2027-03-15', '2027-06-15', '2027-11-15',
  ]);
});

test('yearly event with an ordinal rule applies it within each chosen month', () => {
  // First Monday of March and September.
  const event = {
    startDate: new Date('2026-01-01T09:00:00Z'),
    recurrence: { freq: 'yearly', interval: 1, months: [3, 9], weekOfMonth: 1, weekdayKind: 'mon' },
  };
  const out = expandRecurringEvent(event, new Date('2026-01-01'), new Date('2027-12-31'));
  assert.deepEqual(out.map(o => ymd(o.startDate)), [
    '2026-03-02', '2026-09-07', '2027-03-01', '2027-09-06',
  ]);
});

test('biennial event in chosen months skips the off years', () => {
  const event = {
    startDate: new Date('2026-05-10T09:00:00Z'),
    recurrence: { freq: 'yearly', interval: 2, months: [5] },
  };
  const out = expandRecurringEvent(event, new Date('2026-01-01'), new Date('2029-12-31'));
  assert.deepEqual(out.map(o => ymd(o.startDate)), ['2026-05-10', '2028-05-10']);
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

test('biweekly grocery days follow the anchor parity', () => {
  const base = {
    fromDate: new Date('2026-01-01'), toDate: new Date('2026-01-31'),
    groceryShoppingDay: 6, groceryFrequency: 'biweekly',
  };
  // Anchored on Sat Jan 10: shopping Saturdays are Jan 10 and 24.
  assert.deepEqual(
    assembleCalendarData({ ...base, groceryAnchor: '2026-01-10' }).groceryShopping.map(g => g.date),
    ['2026-01-10', '2026-01-24'],
  );
  // Anchor on the opposite week (Jan 3, also valid as any past/future shopping
  // day, e.g. Jan 17): Saturdays Jan 3, 17, 31.
  assert.deepEqual(
    assembleCalendarData({ ...base, groceryAnchor: '2026-01-17' }).groceryShopping.map(g => g.date),
    ['2026-01-03', '2026-01-17', '2026-01-31'],
  );
});
