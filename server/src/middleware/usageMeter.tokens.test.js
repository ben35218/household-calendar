const test = require('node:test');
const assert = require('node:assert');
const {
  totalTokens, effectiveTokens, enforcedTokens, upgradeBaselineUpdate, currentPeriodKey,
} = require('./usageMeter');

const P = currentPeriodKey();

test('totalTokens sums input + output + cache read + write', () => {
  assert.equal(totalTokens({
    input_tokens: 100, output_tokens: 50,
    cache_creation_input_tokens: 20, cache_read_input_tokens: 30,
  }), 200);
  assert.equal(totalTokens({ input_tokens: 10 }), 10); // missing fields → 0
  assert.equal(totalTokens(null), 0);
  assert.equal(totalTokens(undefined), 0);
});

test('effectiveTokens subtracts the mid-week upgrade baseline, floored at 0', () => {
  const hh = {
    usageTokens: { [P]: { tokens: 500 } },
    usageTokensBaseline: { [P]: { tokens: 200 } },
  };
  assert.equal(effectiveTokens(hh, P), 300);
  // No baseline → raw passes through.
  assert.equal(effectiveTokens({ usageTokens: { [P]: { tokens: 80 } } }, P), 80);
  // Baseline above raw (shouldn't happen) → floored at 0, never negative.
  assert.equal(effectiveTokens({
    usageTokens: { [P]: { tokens: 10 } },
    usageTokensBaseline: { [P]: { tokens: 50 } },
  }, P), 0);
  // Empty → 0.
  assert.equal(effectiveTokens({}, P), 0);
});

test('enforcedTokens: per-user on free, pooled (effective) on paid', () => {
  const user = { usageTokens: { [P]: { tokens: 42 } } };
  const household = {
    plan: 'premium',
    usageTokens: { [P]: { tokens: 900 } },
    usageTokensBaseline: { [P]: { tokens: 100 } },
  };
  // Free → the user's own counter (household pool ignored).
  assert.equal(enforcedTokens({ user, household: { plan: 'free' } }, P), 42);
  // Solo free user, no household → 0 when unset.
  assert.equal(enforcedTokens({ user: {}, household: null }, P), 0);
  // Paid → pooled effective (raw 900 − baseline 100).
  assert.equal(enforcedTokens({ user, household }, P), 800);
});

test('upgradeBaselineUpdate snapshots tokens on a strict upgrade only', () => {
  const household = {
    plan: 'free',
    usage: { [P]: { chat: 5, breakdown: { chat: { calendar: 5 } } } },
    usageTokens: { [P]: { tokens: 1234, byAction: { chat: 1234 } } },
  };
  const up = upgradeBaselineUpdate(household, 'premium');
  assert.equal(up.usageTokensBaseline[P].tokens, 1234);
  // byAction is analytics detail, not part of the enforced pool baseline.
  assert.ok(!('byAction' in up.usageTokensBaseline[P]));
  // Count baseline drops the analytics breakdown sub-object.
  assert.ok(!('breakdown' in up.usageBaseline[P]));

  // Same tier or downgrade → no baseline (can't be used to wipe the counter).
  assert.deepEqual(upgradeBaselineUpdate({ ...household, plan: 'premium' }, 'premium'), {});
  assert.deepEqual(upgradeBaselineUpdate({ ...household, plan: 'unlimited' }, 'free'), {});
});
