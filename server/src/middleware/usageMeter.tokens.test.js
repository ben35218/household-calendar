const test = require('node:test');
const assert = require('node:assert');
const {
  totalTokens, effectiveTokens, enforcedTokens, upgradeBaselineUpdate, currentPeriodKey,
  effectiveCallSeconds, enforcedCallSeconds, recordCallSecondsById, adminUnlimited,
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

test('effectiveCallSeconds subtracts the mid-week upgrade baseline, floored at 0', () => {
  const hh = {
    usageCallSeconds: { [P]: { seconds: 500 } },
    usageCallSecondsBaseline: { [P]: { seconds: 200 } },
  };
  assert.equal(effectiveCallSeconds(hh, P), 300);
  assert.equal(effectiveCallSeconds({ usageCallSeconds: { [P]: { seconds: 80 } } }, P), 80);
  assert.equal(effectiveCallSeconds({}, P), 0);
});

test('enforcedCallSeconds: per-user on free, pooled (effective) on paid', () => {
  const user = { usageCallSeconds: { [P]: { seconds: 42 } } };
  const household = {
    plan: 'premium',
    usageCallSeconds: { [P]: { seconds: 900 } },
    usageCallSecondsBaseline: { [P]: { seconds: 100 } },
  };
  assert.equal(enforcedCallSeconds({ user, household: { plan: 'free' } }, P), 42);
  assert.equal(enforcedCallSeconds({ user: {}, household: null }, P), 0);
  assert.equal(enforcedCallSeconds({ user, household }, P), 800);
});

test('recordCallSecondsById returns the rounded seconds (0/negative → no-op)', () => {
  // No ids → nothing to write, but the rounded seconds are reported back.
  assert.equal(recordCallSecondsById({}, 71.4), 71);
  assert.equal(recordCallSecondsById({}, 0), 0);
  assert.equal(recordCallSecondsById({}, -5), 0);
});

test('adminUnlimited: only admins, and only while the config toggle allows it', () => {
  const admin = { role: 'admin' };
  const member = { role: 'user' };
  // Default / toggle on → admins exempt, non-admins never.
  assert.equal(adminUnlimited({ admin: { unlimitedAi: true } }, admin), true);
  assert.equal(adminUnlimited({ admin: { unlimitedAi: true } }, member), false);
  // Missing section defaults to exempt (backfilled to true elsewhere).
  assert.equal(adminUnlimited({}, admin), true);
  // Toggle off → admins are metered like everyone else.
  assert.equal(adminUnlimited({ admin: { unlimitedAi: false } }, admin), false);
  // No user → never exempt.
  assert.equal(adminUnlimited({ admin: { unlimitedAi: true } }, null), false);
});

test('upgradeBaselineUpdate snapshots tokens on a strict upgrade only', () => {
  const household = {
    plan: 'free',
    usage: { [P]: { chat: 5, breakdown: { chat: { calendar: 5 } } } },
    usageTokens: { [P]: { tokens: 1234, byAction: { chat: 1234 } } },
    usageCallSeconds: { [P]: { seconds: 90 } },
  };
  const up = upgradeBaselineUpdate(household, 'premium');
  assert.equal(up.usageTokensBaseline[P].tokens, 1234);
  // byAction is analytics detail, not part of the enforced pool baseline.
  assert.ok(!('byAction' in up.usageTokensBaseline[P]));
  // Count baseline drops the analytics breakdown sub-object.
  assert.ok(!('breakdown' in up.usageBaseline[P]));
  // Call-time pool is also baselined so it restarts fresh on upgrade.
  assert.equal(up.usageCallSecondsBaseline[P].seconds, 90);

  // Same tier or downgrade → no baseline (can't be used to wipe the counter).
  assert.deepEqual(upgradeBaselineUpdate({ ...household, plan: 'premium' }, 'premium'), {});
  assert.deepEqual(upgradeBaselineUpdate({ ...household, plan: 'unlimited' }, 'free'), {});
});
