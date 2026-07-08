// Content-blind feature-activity tracking. Sibling to usageMeter, but with no
// quotas and no blocking: it just records that a non-AI action happened, so the
// admin analytics/adoption views can answer "which features do households
// actually use" — without ever seeing the payload (E2EE-safe).
//
// Usage (runs AFTER requireAuth so req.household is set):
//   router.post('/events', activity('eventCreated'), handler)
//
// On a 2xx response it atomically $inc's activity.<period>.<action> on the
// household, keyed by the same weekly window as usage counters. No household
// (solo user) → skip: adoption is measured per household.

const Household = require('../models/Household');
const { currentPeriodKey } = require('./usageMeter');

function activity(action) {
  return function activityMeter(req, res, next) {
    const household = req.household;
    if (!household?._id) return next();
    const period = currentPeriodKey();
    res.on('finish', () => {
      if (res.statusCode >= 200 && res.statusCode < 300) {
        Household.updateOne(
          { _id: household._id },
          { $inc: { [`activity.${period}.${action}`]: 1 } }
        ).catch((err) => console.error('[activity] increment failed:', err.message));
      }
    });
    next();
  };
}

module.exports = { activity };
