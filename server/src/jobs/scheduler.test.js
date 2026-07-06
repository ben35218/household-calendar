// Tests for the per-user timezone behaviour of the daily 7am alert check.
// Uses the built-in node:test runner (no deps). DB models and the push service
// are replaced in require.cache before the scheduler is loaded, and the clock is
// faked so "now" can be pinned to a real 7am-in-one-zone instant.
//
// Run: node --test src/jobs/scheduler.test.js
const test = require('node:test');
const assert = require('node:assert');
const { mock } = require('node:test');

// ── Scenario-controlled fixture data (reset per test) ───────────────────────
let membersRows = [];
let tasksRows = [];
let choresRows = [];
let personsRows = [];
// Captured push deliveries: { email, payload }.
let pushes = [];

// A Mongoose-ish model whose find() is both awaitable and .populate()/.lean()-chainable.
function makeModel(getRows) {
  const query = () => {
    const q = {
      populate: () => q,
      lean: () => Promise.resolve(getRows()),
      then: (onF, onR) => Promise.resolve(getRows()).then(onF, onR),
    };
    return q;
  };
  return { find: query };
}

// Inject a fake module into require.cache under the path the scheduler resolves.
function mockModule(relPath, exports) {
  const abs = require.resolve(relPath);
  require.cache[abs] = { id: abs, filename: abs, loaded: true, exports };
}

mockModule('../models/MaintenanceTask', makeModel(() => tasksRows));
mockModule('../models/Chore', makeModel(() => choresRows));
mockModule('../models/Person', makeModel(() => personsRows));
mockModule('../models/User', makeModel(() => membersRows));
mockModule('../models/Household', makeModel(() => []));
mockModule('../models/CalendarEvent', makeModel(() => []));
mockModule('../services/notify', {
  pushToUser: async (user, payload) => { pushes.push({ email: user.email, payload }); },
});
mockModule('../services/push', { isConfigured: () => true });

const { runDailyCheckForHousehold, inAudience } = require('./scheduler');

const HH = { _id: 'hh1', timezone: 'America/Toronto' };
const userA = { _id: 'a', email: 'a@x.com', timezone: 'America/Toronto' };  // EDT, UTC-4
const userB = { _id: 'b', email: 'b@x.com', timezone: 'America/Vancouver' }; // PDT, UTC-7

function task(overrides = {}) {
  return {
    _id: 't1', title: 'Furnace filter', userId: 'a',
    nextDueDate: new Date('2026-07-02T12:00:00Z'),
    reminderDaysBefore: 0, alert2DaysBefore: null,
    alertAudience: 'everyone', itemId: null,
    ...overrides,
  };
}

function reset() {
  membersRows = []; tasksRows = []; choresRows = []; personsRows = []; pushes = [];
}

// 11:00 UTC on 2026-07-02 → 07:00 in Toronto (EDT), 04:00 in Vancouver (PDT).
const AT_7AM_TORONTO = Date.UTC(2026, 6, 2, 11, 0, 0);
// 14:00 UTC on 2026-07-02 → 10:00 in Toronto, 07:00 in Vancouver.
const AT_7AM_VANCOUVER = Date.UTC(2026, 6, 2, 14, 0, 0);
// 02:00 UTC on 2026-07-02 → 22:00 Jul 1 Toronto, 19:00 Jul 1 Vancouver — nobody at 7am.
const NOBODY_AT_7AM = Date.UTC(2026, 6, 2, 2, 0, 0);

function withFakeNow(epochMs, fn) {
  mock.timers.enable({ apis: ['Date'], now: epochMs });
  return Promise.resolve(fn()).finally(() => mock.timers.reset());
}

test('fires only for the member whose local time is 7am (Toronto)', async () => {
  reset();
  membersRows = [userA, userB];
  tasksRows = [task()]; // due 2026-07-02, everyone
  await withFakeNow(AT_7AM_TORONTO, () => runDailyCheckForHousehold(HH));
  assert.strictEqual(pushes.length, 1, 'exactly one push');
  assert.strictEqual(pushes[0].email, 'a@x.com', 'Toronto member only');
  assert.match(pushes[0].payload.body, /Furnace filter/);
});

test('same task fires for the Vancouver member three hours later', async () => {
  reset();
  membersRows = [userA, userB];
  tasksRows = [task()];
  await withFakeNow(AT_7AM_VANCOUVER, () => runDailyCheckForHousehold(HH));
  assert.strictEqual(pushes.length, 1);
  assert.strictEqual(pushes[0].email, 'b@x.com', 'Vancouver member only');
});

test('no member at 7am → no alerts', async () => {
  reset();
  membersRows = [userA, userB];
  tasksRows = [task()];
  await withFakeNow(NOBODY_AT_7AM, () => runDailyCheckForHousehold(HH));
  assert.strictEqual(pushes.length, 0);
});

test("owner-audience task reaches only its creator, not other members", async () => {
  reset();
  // Both members in Toronto so both are at 7am simultaneously.
  membersRows = [userA, { ...userB, timezone: 'America/Toronto' }];
  tasksRows = [task({ alertAudience: 'owner', userId: 'a' })];
  await withFakeNow(AT_7AM_TORONTO, () => runDailyCheckForHousehold(HH));
  assert.strictEqual(pushes.length, 1, 'owner only, not the whole household');
  assert.strictEqual(pushes[0].email, 'a@x.com');
});

test('"today" is evaluated in the member\'s own zone (no UTC rollover)', async () => {
  reset();
  // 03:30 UTC Jul 2 is still Jul 1 in Vancouver. Set Vancouver clock to its 7am
  // and a task due "today" in Vancouver terms (Jul 2 local) must match, while a
  // task due Jul 1 must not. Vancouver 7am on Jul 2 = 14:00 UTC (AT_7AM_VANCOUVER).
  membersRows = [{ ...userB }];
  tasksRows = [
    task({ _id: 'due-today', nextDueDate: new Date('2026-07-02T12:00:00Z'), userId: 'b' }),
    task({ _id: 'due-yesterday', nextDueDate: new Date('2026-07-01T12:00:00Z'), userId: 'b' }),
  ];
  await withFakeNow(AT_7AM_VANCOUVER, () => runDailyCheckForHousehold(HH));
  assert.strictEqual(pushes.length, 1, 'only the task due today (local) fires');
});

test('inAudience predicate: owner vs everyone', () => {
  assert.strictEqual(inAudience({ alertAudience: 'owner', userId: 'a' }, userA), true);
  assert.strictEqual(inAudience({ alertAudience: 'owner', userId: 'a' }, userB), false);
  assert.strictEqual(inAudience({ alertAudience: 'everyone', userId: 'a' }, userB), true);
  assert.strictEqual(inAudience({ userId: 'a' }, userB), true, 'defaults to everyone');
});
