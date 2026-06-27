// Lightweight in-memory rate limiter for sensitive endpoints (e.g. join-by-code),
// where the protection that actually matters is throttling guesses, not the code
// length. Keyed per-user (requireAuth runs first), falling back to IP.
//
// In-process only: fine for a single-instance deployment. If this ever runs on
// multiple instances, swap the Map for a shared store (e.g. Redis).
function rateLimit({ windowMs, max, message = 'Too many attempts. Please try again later.' }) {
  const hits = new Map(); // key -> { count, resetAt }

  // Periodic sweep so the Map can't grow unbounded. unref() keeps it from
  // holding the process open.
  const sweep = setInterval(() => {
    const now = Date.now();
    for (const [key, entry] of hits) {
      if (now >= entry.resetAt) hits.delete(key);
    }
  }, windowMs);
  if (typeof sweep.unref === 'function') sweep.unref();

  return function rateLimiter(req, res, next) {
    const key = req.user ? String(req.user._id) : req.ip;
    const now = Date.now();
    let entry = hits.get(key);
    if (!entry || now >= entry.resetAt) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      res.set('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
      return res.status(429).json({ error: message });
    }
    next();
  };
}

module.exports = { rateLimit };
