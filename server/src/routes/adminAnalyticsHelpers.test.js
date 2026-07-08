const test = require('node:test');
const assert = require('node:assert');
const {
  AI_ACTIONS, ACTIVITY_ACTIONS,
  activeCounts, weeklyGrowth, rollupByPeriod, toSeries,
  chatSurfaceTotals, adoption, distribution, cohortRetention,
} = require('./adminAnalyticsHelpers');

const NOW = Date.UTC(2026, 6, 15, 12, 0, 0); // fixed clock for determinism
const daysAgo = (n) => new Date(NOW - n * 24 * 60 * 60 * 1000);

test('activeCounts buckets DAU/WAU/MAU and computes stickiness', () => {
  const r = activeCounts(
    [daysAgo(0), daysAgo(3), daysAgo(20), daysAgo(60), null],
    { now: NOW }
  );
  assert.equal(r.dau, 1);            // today only
  assert.equal(r.wau, 2);            // today + 3d
  assert.equal(r.mau, 3);            // + 20d (60d excluded, null ignored)
  assert.equal(r.stickiness, Number((1 / 3).toFixed(3)));
});

test('activeCounts ignores future/invalid timestamps', () => {
  const r = activeCounts([new Date(NOW + 5 * 86400000), 'not-a-date'], { now: NOW });
  assert.deepEqual([r.dau, r.wau, r.mau], [0, 0, 0]);
});

test('weeklyGrowth buckets by week and cumulates with an older baseline', () => {
  const ts = [
    daysAgo(0), daysAgo(1),   // this week → last bucket
    daysAgo(8),               // 1 week ago
    daysAgo(30),              // older than a 3-week window → baseline
  ];
  const g = weeklyGrowth(ts, { weeks: 3, now: NOW });
  assert.equal(g.counts.length, 3);
  assert.equal(g.counts[2], 2);          // newest week
  assert.equal(g.counts[1], 1);          // one week ago
  assert.equal(g.total, 4);
  // cumulative starts from the older baseline (1) and adds each week.
  assert.deepEqual(g.cumulative, [1, 2, 4]);
});

test('rollupByPeriod sums across households and skips nested breakdown', () => {
  const maps = [
    { '2026-07-01': { chat: 3, scan: 1, breakdown: { chat: { calendar: 3 } } } },
    { '2026-07-01': { chat: 2 }, '2026-07-08': { scan: 5 } },
  ];
  const per = rollupByPeriod(maps, { actions: AI_ACTIONS });
  assert.equal(per['2026-07-01'].chat, 5);
  assert.equal(per['2026-07-01'].scan, 1);
  assert.equal(per['2026-07-08'].scan, 5);
  assert.ok(!('breakdown' in per['2026-07-01']));
});

test('toSeries takes the most recent N periods oldest→newest', () => {
  const per = {
    '2026-06-17': { chat: 1 }, '2026-06-24': { chat: 2 },
    '2026-07-01': { chat: 3 }, '2026-07-08': { chat: 4 },
  };
  const s = toSeries(per, ['chat'], { weeks: 2 });
  assert.deepEqual(s.periods, ['2026-07-01', '2026-07-08']);
  assert.deepEqual(s.series.chat, [3, 4]);
  assert.equal(s.totals.chat, 7);
});

test('chatSurfaceTotals aggregates nested breakdown, sorted desc', () => {
  const maps = [
    { p1: { breakdown: { chat: { calendar: 3, maintenance: 1 } } } },
    { p2: { breakdown: { chat: { calendar: 2, vacation: 5 } } } },
  ];
  const out = chatSurfaceTotals(maps);
  assert.deepEqual(out[0], { surface: 'calendar', count: 5 });
  assert.deepEqual(out.find((x) => x.surface === 'vacation'), { surface: 'vacation', count: 5 });
  assert.equal(out.find((x) => x.surface === 'maintenance').count, 1);
});

test('adoption counts households that ever performed each action', () => {
  const maps = [
    { p1: { eventCreated: 2 }, p2: { choreCreated: 1 } },
    { p1: { eventCreated: 0 } },              // count 0 → not adopted
    { p1: { eventCreated: 5, tripCreated: 1 } },
  ];
  const out = adoption(maps, ['eventCreated', 'choreCreated', 'tripCreated']);
  const byAction = Object.fromEntries(out.map((o) => [o.action, o]));
  assert.equal(byAction.eventCreated.households, 2);
  assert.equal(byAction.eventCreated.pct, Number(((2 / 3) * 100).toFixed(1)));
  assert.equal(byAction.choreCreated.households, 1);
  assert.equal(byAction.tripCreated.households, 1);
});

test('distribution counts categories, labels blanks, sorts desc', () => {
  const d = distribution(['ios', 'ios', 'android', null, '']);
  assert.deepEqual(d[0], { key: 'ios', count: 2 });
  assert.equal(d.find((x) => x.key === 'unknown').count, 2);
});

test('cohortRetention groups by signup week and measures still-active share', () => {
  const users = [
    // this-week cohort: 2 signups, 1 still active in last 7d
    { createdAt: daysAgo(1), lastActiveAt: daysAgo(0) },
    { createdAt: daysAgo(2), lastActiveAt: daysAgo(20) },
    // 1-week-ago cohort: 1 signup, active in last 30d but not 7d
    { createdAt: daysAgo(9), lastActiveAt: daysAgo(10) },
  ];
  const cohorts = cohortRetention(users, { weeks: 2, now: NOW });
  const newest = cohorts.at(-1); // weeksAgo 0
  assert.equal(newest.size, 2);
  assert.equal(newest.active7, 1);
  assert.equal(newest.retention7, 50);
  const prev = cohorts[0]; // weeksAgo 1
  assert.equal(prev.size, 1);
  assert.equal(prev.active7, 0);
  assert.equal(prev.active30, 1);
});

test('action lists are the expected buckets', () => {
  assert.deepEqual(AI_ACTIONS, ['chat', 'scan', 'generation', 'manualParse', 'aiHelper']);
  assert.ok(ACTIVITY_ACTIONS.includes('eventCreated') && ACTIVITY_ACTIONS.includes('taskCompleted'));
});
