// Per-household weekly quota enforcement for cost-bearing AI actions.
//
// Usage:
//   router.post('/from-photo', meter('scan'), upload.single('photo'), handler)
//
// Runs AFTER requireAuth (so req.household / req.user are set). For each action:
//   1. Resolve the household's plan and the action's quota from MonetizationConfig.
//   2. If the current week's counter is already at/over quota → 402 with an
//      upgrade payload. A `null` quota means unlimited (still tracked).
//   3. Otherwise let the request proceed and, on a 2xx response, atomically
//      $inc the counter (so failed calls don't burn quota).
//
// Config is cached in-process for a short TTL so edits on the temp config page
// take effect quickly without a DB read on every request. There's a small
// check-then-increment race under high concurrency; acceptable for the pre-launch
// phase (the increment is atomic, so counts never corrupt — a user could at most
// slip one extra call past the cap).

const Household = require('../models/Household');
const User = require('../models/User');
const MonetizationConfig = require('../models/MonetizationConfig');

const TIER_ORDER = ['free', 'premium', 'unlimited'];
const CONFIG_TTL_MS = 30 * 1000;

let cached = null;
let cachedAt = 0;

async function getConfig() {
  const now = Date.now();
  if (cached && now - cachedAt < CONFIG_TTL_MS) return cached;
  cached = (await MonetizationConfig.getSingleton()).toObject();
  cachedAt = now;
  return cached;
}

// Allow callers (e.g. the config PUT route) to drop the cache after a write.
function invalidateConfigCache() {
  cached = null;
  cachedAt = 0;
}

// Usage windows reset weekly, every Wednesday at 5:00 PM America/New_York
// (Eastern) — a fixed instant for all users worldwide, regardless of their local
// timezone. The reset weekday/hour is defined in Eastern and stays put across ET
// DST changes (the corresponding UTC instant just shifts by an hour).
const RESET_ZONE = 'America/New_York';
const RESET_WEEKDAY = 3; // 0=Sun … 3=Wed
const RESET_HOUR = 17;   // 5PM

// Wall-clock components of `date` in the reset zone.
function zoneParts(date) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: RESET_ZONE, hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
  });
  const p = Object.fromEntries(dtf.formatToParts(date).map((x) => [x.type, x.value]));
  const hour = p.hour === '24' ? 0 : Number(p.hour); // some ICU builds emit '24' for midnight
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour, minute: Number(p.minute) };
}

// UTC instant (Date) for a given wall-clock time in the reset zone. Anchored at
// 5PM, far from the 2AM DST boundary, so the single offset lookup is exact.
function zoneWallToInstant(year, month, day, hour) {
  const guess = Date.UTC(year, month - 1, day, hour, 0, 0);
  const seen = zoneParts(new Date(guess));
  const asIfUTC = Date.UTC(seen.year, seen.month - 1, seen.day, seen.hour, seen.minute);
  const offsetMs = asIfUTC - guess; // zone = UTC + offset
  return new Date(guess - offsetMs);
}

// ISO date (in the reset zone) of the Wednesday that opened the current window.
function currentPeriodKey(d = new Date()) {
  const p = zoneParts(d);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  let daysBack = (weekday - RESET_WEEKDAY + 7) % 7; // days since the most recent Wednesday
  if (weekday === RESET_WEEKDAY && p.hour < RESET_HOUR) daysBack = 7; // before today's 5PM → last week's window
  const anchor = new Date(Date.UTC(p.year, p.month - 1, p.day - daysBack));
  return anchor.toISOString().slice(0, 10);
}

// The next reset instant (first Wednesday 5PM ET strictly at/after `d`).
function nextPeriodResetAt(d = new Date()) {
  const p = zoneParts(d);
  const weekday = new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay();
  let daysAhead = (RESET_WEEKDAY - weekday + 7) % 7; // days until the next Wednesday
  if (daysAhead === 0 && p.hour >= RESET_HOUR) daysAhead = 7; // today's 5PM already passed
  const target = new Date(Date.UTC(p.year, p.month - 1, p.day + daysAhead));
  return zoneWallToInstant(target.getUTCFullYear(), target.getUTCMonth() + 1, target.getUTCDate(), RESET_HOUR);
}

function nextTier(plan) {
  const i = TIER_ORDER.indexOf(plan);
  return i >= 0 && i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1] : null;
}

// Pooled (paid-tier) usage a household has actually consumed this period: the raw
// counter minus any baseline captured at a mid-week upgrade. The baseline only
// exists for the period an upgrade landed in, so other periods pass through raw.
function effectiveUsage(household, period, action) {
  const raw = household?.usage?.[period]?.[action] || 0;
  const base = household?.usageBaseline?.[period]?.[action] || 0;
  return Math.max(0, raw - base);
}

// Full per-action effective usage map for a period (for billing/status display).
// Drops the `breakdown` analytics sub-object; it isn't a quota bucket.
function effectivePeriodUsage(household, period) {
  const raw = household?.usage?.[period] || {};
  const out = {};
  for (const [action, count] of Object.entries(raw)) {
    if (action === 'breakdown') continue;
    out[action] = effectiveUsage(household, period, action);
  }
  return out;
}

// ── Token metering (the enforced weekly budget) ──────────────────────────────
// Total tokens an API response consumed: input + output + cache read + write.
// This is the literal "tokens used" the app shows and meters against.
function totalTokens(usage) {
  if (!usage) return 0;
  return (usage.input_tokens || 0)
    + (usage.output_tokens || 0)
    + (usage.cache_creation_input_tokens || 0)
    + (usage.cache_read_input_tokens || 0);
}

// Pooled (paid-tier) tokens this period: raw minus any mid-week upgrade baseline.
function effectiveTokens(household, period) {
  const raw = household?.usageTokens?.[period]?.tokens || 0;
  const base = household?.usageTokensBaseline?.[period]?.tokens || 0;
  return Math.max(0, raw - base);
}

// Tokens enforced against this caller for the period: per-user on free, pooled
// on paid — mirrors the count-scope model.
function enforcedTokens(req, period) {
  const plan = req.household?.plan || 'free';
  if (plan === 'free') return req.user?.usageTokens?.[period]?.tokens || 0;
  return effectiveTokens(req.household, period);
}

// Record tokens an AI call consumed. Always bumps the household pool (analytics +
// paid enforcement); on free also bumps the per-user counter (free enforcement).
// `action` gets a per-action token split for analytics. Fire-and-forget; returns
// the token count so handlers can echo `tokensUsed` back to the client.
async function recordTokens(req, usage, action = null) {
  const t = totalTokens(usage);
  if (!t) return 0;
  const period = currentPeriodKey();
  const household = req.household;
  const user = req.user;
  const perUser = (household?.plan || 'free') === 'free';
  if (household?._id) {
    const inc = { [`usageTokens.${period}.tokens`]: t };
    if (action) inc[`usageTokens.${period}.byAction.${action}`] = t;
    Household.updateOne({ _id: household._id }, { $inc: inc })
      .catch((err) => console.error('[recordTokens] household inc failed:', err.message));
  }
  if (perUser && user?._id) {
    User.updateOne({ _id: user._id }, { $inc: { [`usageTokens.${period}.tokens`]: t } })
      .catch((err) => console.error('[recordTokens] user inc failed:', err.message));
  }
  return t;
}

function isUpgrade(oldPlan, newPlan) {
  return TIER_ORDER.indexOf(newPlan) > TIER_ORDER.indexOf(oldPlan);
}

// `$set` fragment that resets the pooled weekly budget when a household moves to a
// higher tier ("fresh pool on upgrade"): baseline the current period to its raw
// counts/tokens so effective usage restarts at 0. Only a strict upgrade qualifies,
// so downgrading can't wipe the counter. Returns {} for non-upgrades.
function upgradeBaselineUpdate(household, newPlan) {
  const oldPlan = household?.plan || 'free';
  if (!isUpgrade(oldPlan, newPlan)) return {};
  const period = currentPeriodKey();
  const snapshot = { ...(household?.usage?.[period] || {}) };
  delete snapshot.breakdown;
  const tokenSnapshot = { ...(household?.usageTokens?.[period] || {}) };
  delete tokenSnapshot.byAction;
  return {
    usageBaseline: { [period]: snapshot },
    usageTokensBaseline: { [period]: tokenSnapshot },
  };
}

// `action` is the quota bucket (chat/scan/generation/manualParse/aiHelper).
// Optional `surface` records a finer-grained analytics label (e.g. which chat
// surface) under a separate `breakdown` path — additive only, it never affects
// quota enforcement, so a metered action's cap is always on the coarse bucket.
//
// Enforcement scope depends on the plan:
//   - free: per USER (req.user.usage). Each member gets their own free allowance,
//     so a family member joining doesn't shrink everyone's quota. Also means solo
//     free users (no household) are tracked properly now.
//   - paid: per HOUSEHOLD (household.usage) — one subscription funds a shared pool.
// The household counter is ALWAYS incremented (even on free) so the admin
// analytics fleet totals/breakdown stay complete regardless of tier.
function meter(action, surface = null) {
  return async function usageMeter(req, res, next) {
    try {
      const household = req.household;
      const user = req.user;
      const plan = household?.plan || 'free';
      const perUser = plan === 'free';

      const config = await getConfig();
      const tier = config.tiers?.[plan] || config.tiers?.free || {};

      const period = currentPeriodKey();

      // The enforced cap is the weekly TOKEN budget (null = unlimited). We only
      // know a call's token cost AFTER it runs, so this is a pre-check on the
      // running total: once at/over budget, the NEXT AI call is blocked. Per-user
      // on free, pooled on paid.
      const limit = tier.weeklyTokenLimit;
      if (limit != null) {
        const used = enforcedTokens(req, period);
        if (used >= limit) {
          return res.status(402).json({
            error: 'You’ve reached your weekly AI limit. Upgrade for more.',
            code: 'TOKENS_EXCEEDED',
            action,
            plan,
            scope: perUser ? 'user' : 'household',
            limit,
            used,
            pct: Math.min(100, Math.round((used / limit) * 100)),
            upgradeTo: nextTier(plan),
          });
        }
      }

      // Increment the per-action COUNT on success (analytics only — no longer a
      // cap). Token consumption is recorded separately by recordTokens() in each
      // AI handler, since token cost is known only after the Claude call returns.
      res.on('finish', () => {
        if (res.statusCode < 200 || res.statusCode >= 300) return;
        // Household counter (analytics fleet totals + paid-tier enforcement).
        if (household?._id) {
          const inc = { [`usage.${period}.${action}`]: 1 };
          // Also track the finer-grained surface, when provided, so the admin
          // app can break "chat" down by feature area without changing quotas.
          if (surface) inc[`usage.${period}.breakdown.${action}.${surface}`] = 1;
          Household.updateOne(
            { _id: household._id },
            { $inc: inc }
          ).catch((err) => console.error('[usageMeter] household increment failed:', err.message));
        }
        // Per-user counter drives free-tier enforcement + display.
        if (perUser && user?._id) {
          User.updateOne(
            { _id: user._id },
            { $inc: { [`usage.${period}.${action}`]: 1 } }
          ).catch((err) => console.error('[usageMeter] user increment failed:', err.message));
        }
      });

      // Auto-attach the tokens this request consumed to JSON responses, so the
      // one-shot AI endpoints report `tokensUsed` without per-handler edits.
      const { withMeter, meteredTokens } = require('../services/aiUsage');
      const origJson = res.json.bind(res);
      res.json = (body) => {
        if (body && typeof body === 'object' && !Array.isArray(body)
            && body.tokensUsed === undefined && meteredTokens() > 0) {
          body.tokensUsed = meteredTokens();
        }
        return origJson(body);
      };
      // Run the rest of the request inside a metering context so the patched
      // Anthropic client records token usage for every AI call it makes.
      withMeter(req, action, () => next());
    } catch (err) {
      console.error('[usageMeter] error:', err.message);
      // Fail open: never let a metering bug take down a feature.
      next();
    }
  };
}

// In-process daily abuse guard for the Google Maps endpoints. Maps is available
// on every tier (it's a fundamental feature), so this is NOT a product limit —
// just a runaway-cost backstop keyed per household per UTC day. In-memory is
// fine for a backstop; on multi-instance deploys swap for a shared store.
const mapsHits = new Map(); // `${householdId}:${day}` -> count

function mapsGuard() {
  return async function guard(req, res, next) {
    try {
      const config = await getConfig();
      const max = config.guards?.mapsPerDay;
      if (!max || max <= 0) return next(); // 0 / unset = disabled
      const day = new Date().toISOString().slice(0, 10);
      const key = `${req.household?._id || req.user?._id || req.ip}:${day}`;
      const n = (mapsHits.get(key) || 0) + 1;
      mapsHits.set(key, n);
      if (n > max) {
        return res.status(429).json({ error: 'Daily location-search limit reached. Please try again tomorrow.' });
      }
      next();
    } catch {
      next(); // fail open
    }
  };
}

// Periodically drop stale day-keys so the map can't grow unbounded.
const mapsSweep = setInterval(() => {
  const today = new Date().toISOString().slice(0, 10);
  for (const key of mapsHits.keys()) if (!key.endsWith(today)) mapsHits.delete(key);
}, 60 * 60 * 1000);
if (typeof mapsSweep.unref === 'function') mapsSweep.unref();

module.exports = {
  meter, mapsGuard, getConfig, invalidateConfigCache, currentPeriodKey, nextPeriodResetAt,
  nextTier, TIER_ORDER, effectivePeriodUsage, upgradeBaselineUpdate,
  // Token metering
  recordTokens, totalTokens, effectiveTokens, enforcedTokens,
};
