const jwt = require('jsonwebtoken');
const User = require('../models/User');
const Household = require('../models/Household');

async function requireAuth(req, res, next) {
  const header = req.headers.authorization;
  // Also accept token as a query param for browser-native requests (iframes, download links)
  const token = (header?.startsWith('Bearer ') ? header.slice(7) : null) || req.query.token;
  if (!token) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET);
    const user = await User.findById(payload.userId).select('-passwordHash');
    if (!user) return res.status(401).json({ error: 'Unauthorized' });
    req.user = user;
    // Household scope: ids of all members sharing this household (incl. self).
    // Data is scoped by `userId: { $in: req.scopeIds }`, so a member's own
    // documents are automatically shared once they join a household.
    if (user.householdId) {
      const [members, household] = await Promise.all([
        User.find({ householdId: user.householdId }, '_id').lean(),
        Household.findById(user.householdId),
      ]);
      req.scopeIds = members.map((m) => m._id);
      if (!req.scopeIds.length) req.scopeIds = [user._id];
      req.household = household;   // shared settings (timezone, homeAddress, …) live here
    } else {
      req.scopeIds = [user._id];
      req.household = null;
    }
    next();
  } catch {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

// Gate admin-only surfaces (monetization config, household/plan management).
// Must run AFTER requireAuth so `req.user` is populated.
function requireAdmin(req, res, next) {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Forbidden' });
  }
  next();
}

module.exports = { requireAuth, requireAdmin };
