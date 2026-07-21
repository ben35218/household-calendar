// Pure aggregation helpers for the admin analytics endpoints. No DB/HTTP — all
// functions take plain arrays/objects so they're unit-testable (node:test),
// matching adminHelpers.test.js / dropReadiness.test.js.
//
// "counter maps" are the per-household `usage` / `activity` objects:
//   { 'YYYY-MM-DD': { action: count, ..., breakdown?: { chat: { surface: n } } } }

const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

// The metered AI buckets and the content-blind activity buckets we surface.
const AI_ACTIONS = ['chat', 'scan', 'generation', 'manualParse', 'aiHelper'];
const ACTIVITY_ACTIONS = [
  'eventCreated', 'choreCreated', 'taskCompleted', 'recipeAdded',
  'itemAdded', 'tripCreated',
];

// DAU/WAU/MAU from a list of lastActiveAt values (Date | string | null).
function activeCounts(lastActiveDates, { now = Date.now() } = {}) {
  let dau = 0, wau = 0, mau = 0;
  for (const d of lastActiveDates) {
    if (!d) continue;
    const age = now - new Date(d).getTime();
    if (age < 0 || Number.isNaN(age)) continue;
    if (age <= DAY_MS) dau++;
    if (age <= WEEK_MS) wau++;
    if (age <= 30 * DAY_MS) mau++;
  }
  return { dau, wau, mau, stickiness: mau ? Number((dau / mau).toFixed(3)) : 0 };
}

// Weekly new-count buckets (oldest→newest) + running cumulative that includes a
// baseline of everything older than the window.
function weeklyGrowth(timestamps, { weeks = 12, now = Date.now() } = {}) {
  const counts = new Array(weeks).fill(0);
  let older = 0;
  for (const ts of timestamps) {
    const t = new Date(ts).getTime();
    if (Number.isNaN(t)) continue;
    const weeksAgo = Math.floor((now - t) / WEEK_MS);
    if (weeksAgo < 0) counts[weeks - 1]++;      // future/skew → newest bucket
    else if (weeksAgo < weeks) counts[weeks - 1 - weeksAgo]++;
    else older++;
  }
  const cumulative = [];
  let run = older;
  for (const c of counts) { run += c; cumulative.push(run); }
  return { counts, cumulative, total: older + counts.reduce((a, b) => a + b, 0) };
}

// Sum counter maps across households into { period: { action: total } }.
// Skips the nested `breakdown` analytics object (it's not an action count).
function rollupByPeriod(counterMaps, { actions = null } = {}) {
  const perPeriod = {};
  for (const map of counterMaps) {
    for (const [period, actionsObj] of Object.entries(map || {})) {
      const dest = (perPeriod[period] ||= {});
      for (const [action, count] of Object.entries(actionsObj || {})) {
        if (action === 'breakdown') continue;
        if (actions && !actions.includes(action)) continue;
        if (typeof count === 'number') dest[action] = (dest[action] || 0) + count;
      }
    }
  }
  return perPeriod;
}

// Turn a { period: {action:count} } rollup into the most-recent `weeks` periods
// (oldest→newest) as { periods:[...], series: { action: [counts] }, totals }.
function toSeries(perPeriod, actions, { weeks = 8 } = {}) {
  const periods = Object.keys(perPeriod).sort().slice(-weeks);
  const series = {};
  const totals = {};
  for (const a of actions) {
    series[a] = periods.map((p) => perPeriod[p]?.[a] || 0);
    totals[a] = series[a].reduce((x, y) => x + y, 0);
  }
  return { periods, series, totals };
}

// Fleet-wide chat-by-surface totals from usage maps' nested breakdown.
function chatSurfaceTotals(usageMaps) {
  const totals = {};
  for (const map of usageMaps) {
    for (const period of Object.keys(map || {})) {
      const bySurface = map[period]?.breakdown?.chat || {};
      for (const [s, c] of Object.entries(bySurface)) {
        if (typeof c === 'number') totals[s] = (totals[s] || 0) + c;
      }
    }
  }
  return Object.entries(totals).map(([surface, count]) => ({ surface, count }))
    .sort((a, b) => b.count - a.count);
}

// Feature adoption: how many households ever performed each action.
function adoption(counterMaps, actions) {
  const households = counterMaps.length;
  const did = Object.fromEntries(actions.map((a) => [a, 0]));
  for (const map of counterMaps) {
    const seen = new Set();
    for (const period of Object.keys(map || {})) {
      for (const [action, count] of Object.entries(map[period] || {})) {
        if (action !== 'breakdown' && typeof count === 'number' && count > 0) seen.add(action);
      }
    }
    for (const a of actions) if (seen.has(a)) did[a]++;
  }
  return actions.map((a) => ({
    action: a,
    households: did[a],
    pct: households ? Number(((did[a] / households) * 100).toFixed(1)) : 0,
  }));
}

// ── Per-user token usage + abuse signals ────────────────────────────────────

// Abuse-flag thresholds. Deliberately coarse: this view surfaces users worth a
// human look, it doesn't take action.
const HAMMER_MIN_BLOCKED = 10;   // ≥ this many 402s in the period → 'hammering'
const SPIKE_FACTOR = 3;          // current ≥ 3× the user's prior-week average…
const SPIKE_MIN_TOKENS = 50_000; // …and at least this many tokens → 'spike'

// The last `weeks` weekly period keys (oldest→newest) ending at `currentKey`
// (a 'YYYY-MM-DD' Wednesday anchor from usageMeter.currentPeriodKey). Pure date
// math on the UTC anchor, so it never re-derives the reset timezone.
function periodKeysBack(currentKey, weeks) {
  const [y, m, d] = currentKey.split('-').map(Number);
  const keys = [];
  for (let i = weeks - 1; i >= 0; i--) {
    keys.push(new Date(Date.UTC(y, m - 1, d - 7 * i)).toISOString().slice(0, 10));
  }
  return keys;
}

// Per-period token counts (oldest→newest) from a { period: { tokens } } map.
function tokenSeries(usageTokens, periods) {
  return periods.map((p) => usageTokens?.[p]?.tokens || 0);
}

// Total 402-blocked attempts in one period from { period: { action: count } }.
function blockedCount(usageBlocked, period) {
  return Object.values(usageBlocked?.[period] || {})
    .reduce((n, c) => n + (typeof c === 'number' ? c : 0), 0);
}

// Abuse flags for one user. `series` is their token series oldest→newest (the
// last entry is the current period); `used`/`limit` are what enforcement sees
// (per-user on free, pooled household on paid); `blocked` is this period's 402s.
//   overLimit — hit the weekly budget (enforcement is refusing them)
//   hammering — kept calling well past the refusal (the real abuse tell)
//   spike     — current week is a large multiple of their own recent baseline
function abuseFlags({ series = [], used = 0, limit = null, blocked = 0 } = {}) {
  const flags = [];
  if (limit != null && used >= limit) flags.push('overLimit');
  if (blocked >= HAMMER_MIN_BLOCKED) flags.push('hammering');
  const current = series.at(-1) || 0;
  const prior = series.slice(0, -1);
  const priorAvg = prior.length ? prior.reduce((a, b) => a + b, 0) / prior.length : 0;
  if (priorAvg > 0 && current >= SPIKE_FACTOR * priorAvg && current >= SPIKE_MIN_TOKENS) {
    flags.push('spike');
  }
  return flags;
}

// Count distinct occurrences of a categorical field (e.g. platform, version).
function distribution(values, { unknownLabel = 'unknown' } = {}) {
  const counts = {};
  for (const v of values) {
    const k = v == null || v === '' ? unknownLabel : String(v);
    counts[k] = (counts[k] || 0) + 1;
  }
  return Object.entries(counts).map(([key, count]) => ({ key, count }))
    .sort((a, b) => b.count - a.count);
}

// Retention by signup-week cohort: for each of the last `weeks` cohorts, how
// many members are still active in the last 7 / 30 days. (A single-snapshot view
// from lastActiveAt — not a full return-by-week triangle, which would need
// per-period activity history.)
function cohortRetention(users, { weeks = 8, now = Date.now() } = {}) {
  const cohorts = {};
  for (const u of users) {
    const created = new Date(u.createdAt).getTime();
    if (Number.isNaN(created)) continue;
    const weeksAgo = Math.floor((now - created) / WEEK_MS);
    if (weeksAgo < 0 || weeksAgo >= weeks) continue;
    const c = (cohorts[weeksAgo] ||= { size: 0, active7: 0, active30: 0 });
    c.size++;
    if (u.lastActiveAt) {
      const age = now - new Date(u.lastActiveAt).getTime();
      if (age >= 0 && age <= WEEK_MS) c.active7++;
      if (age >= 0 && age <= 30 * DAY_MS) c.active30++;
    }
  }
  const out = [];
  for (let i = weeks - 1; i >= 0; i--) {
    const c = cohorts[i] || { size: 0, active7: 0, active30: 0 };
    out.push({
      weeksAgo: i,
      size: c.size,
      active7: c.active7,
      active30: c.active30,
      retention7: c.size ? Number(((c.active7 / c.size) * 100).toFixed(1)) : 0,
      retention30: c.size ? Number(((c.active30 / c.size) * 100).toFixed(1)) : 0,
    });
  }
  return out;
}

module.exports = {
  AI_ACTIONS, ACTIVITY_ACTIONS,
  activeCounts, weeklyGrowth, rollupByPeriod, toSeries,
  chatSurfaceTotals, adoption, distribution, cohortRetention,
  // Per-user token usage + abuse signals
  HAMMER_MIN_BLOCKED, SPIKE_FACTOR, SPIKE_MIN_TOKENS,
  periodKeysBack, tokenSeries, blockedCount, abuseFlags,
};
