const axios = require('axios');

// Daily exchange rates from a free, no-key API, cached in memory per base
// currency. Rates are mid-market and approximate — good enough for trip budget
// estimates. rates[X] = how many X per 1 unit of base.

const TTL_MS = 12 * 60 * 60 * 1000; // refetch at most twice a day
const cache = new Map();             // base -> { rates, date, fetchedAt }

async function getRates(base = 'CAD') {
  const b = (base || 'CAD').toUpperCase();
  const hit = cache.get(b);
  if (hit && Date.now() - hit.fetchedAt < TTL_MS) return hit;

  try {
    const { data } = await axios.get(`https://open.er-api.com/v6/latest/${b}`, { timeout: 10000 });
    if (data?.result !== 'success' || !data.rates) return hit || null;
    const entry = { rates: data.rates, date: data.time_last_update_utc || new Date().toUTCString(), fetchedAt: Date.now() };
    cache.set(b, entry);
    return entry;
  } catch {
    return hit || null; // serve stale on failure if we have it
  }
}

// Convert an amount from `from` currency into `base`. Returns null if not convertible.
function convert(amount, from, base, rates) {
  if (amount == null || Number.isNaN(amount)) return null;
  const f = (from || base).toUpperCase();
  const b = base.toUpperCase();
  if (f === b) return amount;
  const r = rates?.[f];
  if (!r) return null;        // unknown currency for this base
  return amount / r;          // 1 unit of `f` = (1 / rates[f]) units of base
}

module.exports = { getRates, convert };
