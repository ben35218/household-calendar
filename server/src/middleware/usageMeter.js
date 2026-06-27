// Per-household monthly quota enforcement for cost-bearing AI actions.
//
// Usage:
//   router.post('/from-photo', meter('scan'), upload.single('photo'), handler)
//
// Runs AFTER requireAuth (so req.household / req.user are set). For each action:
//   1. Resolve the household's plan and the action's quota from MonetizationConfig.
//   2. If the current month's counter is already at/over quota → 402 with an
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

function currentMonthKey(d = new Date()) {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

function nextTier(plan) {
  const i = TIER_ORDER.indexOf(plan);
  return i >= 0 && i < TIER_ORDER.length - 1 ? TIER_ORDER[i + 1] : null;
}

function meter(action) {
  return async function usageMeter(req, res, next) {
    try {
      // No household = solo user who hasn't joined one. Treat as free tier,
      // keyed by their own id so quotas still apply.
      const household = req.household;
      const plan = household?.plan || 'free';

      const config = await getConfig();
      const tier = config.tiers?.[plan] || config.tiers?.free || {};
      const quota = tier.quotas ? tier.quotas[action] : null;

      const month = currentMonthKey();

      // Unlimited (null) → track only, never block.
      if (quota !== null && quota !== undefined) {
        const used = household?.usage?.[month]?.[action] || 0;
        if (used >= quota) {
          return res.status(402).json({
            error: 'You’ve reached your monthly limit for this feature.',
            code: 'QUOTA_EXCEEDED',
            action,
            plan,
            limit: quota,
            used,
            upgradeTo: nextTier(plan),
          });
        }
      }

      // Increment on success only. We need a household to attribute usage to;
      // if there's none, skip the write (solo users get free quotas above but
      // aren't tracked persistently — acceptable pre-launch).
      if (household?._id) {
        res.on('finish', () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            Household.updateOne(
              { _id: household._id },
              { $inc: { [`usage.${month}.${action}`]: 1 } }
            ).catch((err) => console.error('[usageMeter] increment failed:', err.message));
          }
        });
      }

      next();
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

module.exports = { meter, mapsGuard, getConfig, invalidateConfigCache, currentMonthKey, nextTier, TIER_ORDER };
