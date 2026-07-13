// Regression for the multi-day event window bug: a non-recurring event that
// starts BEFORE the query window but whose endDate reaches into it must still be
// returned by /calendar/raw. The day view fetches a tight ±7-day window, so a
// start-only filter dropped a multi-day event once "today" slid past its start.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startDb, stopDb, request, registerUser } = require('./harness');
const CalendarEvent = require('../models/CalendarEvent');

before(startDb);
after(stopDb);

test('/calendar/raw keeps a multi-day event whose start precedes the window', async () => {
  const owner = await registerUser({ firstName: 'Ravi' });

  // Spans Jul 5 → Jul 18 (all-day, stored at noon UTC).
  const spanning = await CalendarEvent.create({
    userId: owner.user._id, calendarType: 'appointments', title: 'Hardwood refinishing',
    allDay: true, startDate: new Date('2026-07-05T12:00:00Z'), endDate: new Date('2026-07-18T12:00:00Z'),
  });
  // Ends before the window — must NOT come back.
  await CalendarEvent.create({
    userId: owner.user._id, calendarType: 'appointments', title: 'Old job',
    allDay: true, startDate: new Date('2026-07-01T12:00:00Z'), endDate: new Date('2026-07-04T12:00:00Z'),
  });

  // The day view's window for Jul 13: from Jul 6 (AFTER the event's Jul 5 start).
  const res = await request().get('/api/calendar/raw')
    .set('Authorization', owner.auth)
    .query({ from: '2026-07-06T00:00:00.000Z', to: '2026-07-20T00:00:00.000Z' });

  assert.equal(res.status, 200);
  const titles = res.body.events.map((e) => e.title);
  assert.ok(titles.includes('Hardwood refinishing'), 'multi-day event dropped from window');
  assert.ok(!titles.includes('Old job'), 'event ending before the window leaked in');
  assert.ok(res.body.events.some((e) => String(e._id) === String(spanning._id)));
});
