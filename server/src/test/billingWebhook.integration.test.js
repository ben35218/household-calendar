// RevenueCat webhook (/api/billing/webhook): shared-secret auth + event → plan
// mapping, including the events that must NOT change the plan (CANCELLATION
// with auto-renew off, TRANSFER, grants with unknown entitlements).

process.env.REVENUECAT_WEBHOOK_SECRET = 'test-rc-secret';

const { test, before, after } = require('node:test');
const assert = require('node:assert');
const { startDb, stopDb, request, registerUser } = require('./harness');
const Household = require('../models/Household');

before(startDb);
after(stopDb);

function post(event, secret = 'test-rc-secret') {
  return request()
    .post('/api/billing/webhook')
    .set('Authorization', `Bearer ${secret}`)
    .send({ api_version: '1.0', event });
}

async function planOf(householdId) {
  const hh = await Household.findById(householdId).lean();
  return hh.plan;
}

test('rejects a bad secret', async () => {
  const res = await post({ type: 'INITIAL_PURCHASE' }, 'wrong');
  assert.equal(res.status, 401);
});

test('grant → revoke lifecycle flips the household plan', async () => {
  const { user } = await registerUser();
  const hh = user.householdId;

  const buy = await post({ type: 'INITIAL_PURCHASE', app_user_id: hh, entitlement_ids: ['premium'] });
  assert.equal(buy.status, 200);
  assert.deepEqual(buy.body, { ok: true, plan: 'premium' });
  assert.equal(await planOf(hh), 'premium');

  // Upgrade picks the highest entitlement.
  const up = await post({ type: 'PRODUCT_CHANGE', app_user_id: hh, entitlement_ids: ['unlimited'] });
  assert.equal(up.body.plan, 'unlimited');
  assert.equal(await planOf(hh), 'unlimited');

  const expire = await post({ type: 'EXPIRATION', app_user_id: hh, entitlement_ids: ['unlimited'] });
  assert.equal(expire.body.plan, 'free');
  assert.equal(await planOf(hh), 'free');
});

test('CANCELLATION keeps the plan until expiration; refunds revoke now', async () => {
  const { user } = await registerUser();
  const hh = user.householdId;
  await post({ type: 'INITIAL_PURCHASE', app_user_id: hh, entitlement_ids: ['premium'] });

  // Auto-renew turned off — paid through the period, so plan stays; only the
  // lifecycle flag records the cancellation.
  const cancel = await post({ type: 'CANCELLATION', app_user_id: hh, cancel_reason: 'UNSUBSCRIBE' });
  assert.equal(cancel.status, 200);
  assert.equal(cancel.body.plan, 'premium');
  assert.equal(await planOf(hh), 'premium');
  assert.equal((await Household.findById(hh).lean()).planAutoRenew, false);

  // Refund via customer support — revoke immediately.
  const refund = await post({ type: 'CANCELLATION', app_user_id: hh, cancel_reason: 'CUSTOMER_SUPPORT' });
  assert.equal(refund.body.plan, 'free');
  assert.equal(await planOf(hh), 'free');
});

test('lifecycle state: grants stamp renewal details, BILLING_ISSUE flags, EXPIRATION clears', async () => {
  const { user } = await registerUser();
  const hh = user.householdId;
  const expiresMs = Date.now() + 30 * 86_400_000;

  await post({
    type: 'INITIAL_PURCHASE',
    app_user_id: hh,
    entitlement_ids: ['premium'],
    expiration_at_ms: expiresMs,
    product_id: 'app.householdcalendar.premium_monthly',
    subscriber_attributes: { purchaser_user_id: { value: String(user._id) } },
  });
  let doc = await Household.findById(hh).lean();
  assert.equal(doc.planAutoRenew, true);
  assert.equal(doc.planBillingIssue, false);
  assert.equal(new Date(doc.planExpiresAt).getTime(), expiresMs);
  assert.equal(doc.planProductId, 'app.householdcalendar.premium_monthly');
  assert.equal(String(doc.planPurchasedBy), String(user._id));

  // Card failed — plan untouched, flag raised for the client banner.
  await post({ type: 'BILLING_ISSUE', app_user_id: hh });
  doc = await Household.findById(hh).lean();
  assert.equal(doc.plan, 'premium');
  assert.equal(doc.planBillingIssue, true);

  // A successful renewal clears the flag.
  await post({ type: 'RENEWAL', app_user_id: hh, entitlement_ids: ['premium'] });
  doc = await Household.findById(hh).lean();
  assert.equal(doc.planBillingIssue, false);

  // Expiration drops to free and clears the renewal state.
  await post({ type: 'EXPIRATION', app_user_id: hh });
  doc = await Household.findById(hh).lean();
  assert.equal(doc.plan, 'free');
  assert.equal(doc.planAutoRenew, undefined);
  assert.equal(doc.planExpiresAt, undefined);
  assert.equal(doc.planProductId, undefined);
});

test('TRANSFER (no app_user_id) and unknown entitlements are acked, not applied', async () => {
  const { user } = await registerUser();
  const hh = user.householdId;
  await post({ type: 'INITIAL_PURCHASE', app_user_id: hh, entitlement_ids: ['premium'] });

  const transfer = await post({ type: 'TRANSFER', transferred_from: ['x'], transferred_to: ['y'] });
  assert.equal(transfer.status, 200);
  assert.equal(transfer.body.ignored, 'TRANSFER');

  // A grant for an entitlement we don't map must not downgrade.
  const odd = await post({ type: 'RENEWAL', app_user_id: hh, entitlement_ids: ['mystery_tier'] });
  assert.equal(odd.body.ignored, 'RENEWAL');
  assert.equal(await planOf(hh), 'premium');
});

test('unknown household is acknowledged so RC stops retrying', async () => {
  const res = await post({
    type: 'INITIAL_PURCHASE',
    app_user_id: '000000000000000000000000',
    entitlement_ids: ['premium'],
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true, matched: false });
});
