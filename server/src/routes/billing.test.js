const test = require('node:test');
const assert = require('node:assert');
const { planUpdateForEvent } = require('./billing');

const OID = '65f0c1a2b3d4e5f601234567'; // any valid ObjectId string

test('grant events set the tier and refresh lifecycle state', () => {
  const { plan, set, unset } = planUpdateForEvent({
    type: 'INITIAL_PURCHASE',
    entitlement_ids: ['premium'],
    expiration_at_ms: 1780000000000,
    product_id: 'app.householdcalendar.premium_monthly',
    subscriber_attributes: { purchaser_user_id: { value: OID } },
  });
  assert.equal(plan, 'premium');
  assert.equal(set.planAutoRenew, true);
  assert.equal(set.planBillingIssue, false);
  assert.equal(set.planExpiresAt.getTime(), 1780000000000);
  assert.equal(set.planProductId, 'app.householdcalendar.premium_monthly');
  assert.equal(set.planPurchasedBy, OID);
  assert.deepEqual(unset, {});
});

test('grant picks the highest entitlement and tolerates missing extras', () => {
  const { plan, set } = planUpdateForEvent({
    type: 'RENEWAL',
    entitlement_ids: ['premium', 'unlimited'],
  });
  assert.equal(plan, 'unlimited');
  assert.equal(set.planAutoRenew, true);
  assert.ok(!('planExpiresAt' in set));
  assert.ok(!('planProductId' in set));
  assert.ok(!('planPurchasedBy' in set));
});

test('a garbage purchaser attribute is ignored, not stored', () => {
  const { set } = planUpdateForEvent({
    type: 'INITIAL_PURCHASE',
    entitlement_ids: ['premium'],
    subscriber_attributes: { purchaser_user_id: { value: 'not-an-object-id' } },
  });
  assert.ok(!('planPurchasedBy' in set));
});

test('unrecognized entitlements never downgrade — event is a no-op', () => {
  const { plan, set, unset } = planUpdateForEvent({
    type: 'INITIAL_PURCHASE',
    entitlement_ids: ['mystery_tier'],
  });
  assert.equal(plan, null);
  assert.deepEqual(set, {});
  assert.deepEqual(unset, {});
});

test('CANCELLATION flips only autoRenew; plan and expiry stay', () => {
  const { plan, set, unset } = planUpdateForEvent({
    type: 'CANCELLATION',
    cancel_reason: 'UNSUBSCRIBE',
    entitlement_ids: ['premium'],
  });
  assert.equal(plan, null); // access continues until EXPIRATION
  assert.deepEqual(set, { planAutoRenew: false });
  assert.deepEqual(unset, {});
});

test('refund (CUSTOMER_SUPPORT cancellation) revokes immediately', () => {
  const { plan, set, unset } = planUpdateForEvent({
    type: 'CANCELLATION',
    cancel_reason: 'CUSTOMER_SUPPORT',
  });
  assert.equal(plan, 'free');
  assert.equal(set.planBillingIssue, false);
  assert.deepEqual(unset, { planAutoRenew: 1, planExpiresAt: 1, planProductId: 1 });
});

test('EXPIRATION and SUBSCRIPTION_PAUSED drop to free and clear lifecycle state', () => {
  for (const type of ['EXPIRATION', 'SUBSCRIPTION_PAUSED']) {
    const { plan, set, unset } = planUpdateForEvent({ type });
    assert.equal(plan, 'free', type);
    assert.equal(set.planBillingIssue, false, type);
    assert.deepEqual(unset, { planAutoRenew: 1, planExpiresAt: 1, planProductId: 1 }, type);
  }
});

test('BILLING_ISSUE flags the household without touching the plan', () => {
  const { plan, set, unset } = planUpdateForEvent({ type: 'BILLING_ISSUE' });
  assert.equal(plan, null);
  assert.deepEqual(set, { planBillingIssue: true });
  assert.deepEqual(unset, {});
});

test('irrelevant events (TRANSFER etc.) produce no update', () => {
  const { plan, set, unset } = planUpdateForEvent({ type: 'TRANSFER' });
  assert.equal(plan, null);
  assert.deepEqual(set, {});
  assert.deepEqual(unset, {});
});
