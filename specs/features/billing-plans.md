---
title: Billing & plans
status: current
last-verified: d7c71e0 (2026-07-22)
code:
  - mobile/src/screens/plan/
  - mobile/src/lib/purchases.ts
  - server/src/routes/billing.js
  - server/src/routes/monetizationConfig.js
  - server/src/models/MonetizationConfig.js
  - server/src/services/aiUsage.js
  - admin/
tests:
  - server/src/test/billingWebhook.integration.test.js
  - server/src/routes/billing.test.js
  - server/src/middleware/usageMeter.tokens.test.js
---

# Billing & plans

## Purpose

Subscription plans via RevenueCat, AI-action metering that gates premium
features, and the in-app plan hub. The admin app configures the monetization
catalog centrally.

## Behavior (normative)

### Plans & purchase

- Entitlements are **`premium`** and **`unlimited`** (RevenueCat), surfaced on
  device through `react-native-purchases` (`lib/purchases.ts`). The paywall
  degrades to a "not configured" state until the RC keys exist.
- RevenueCat is the source of truth for subscription state. On any change it
  calls `POST /api/billing/webhook` (public, verified by
  `REVENUECAT_WEBHOOK_SECRET`), which flips the user's plan server-side.
- `GET /api/billing/status` returns the current plan; `POST /api/billing/select`
  is an admin-only override.

### Plan hub (client)

- The plan surfaces are split (`screens/plan/`): a hub, **ComparePlans**,
  **AiUsage**, and an **UpsellSheet** shown contextually when a gated action is
  attempted.
- **ProfileHome** shows a compact AI-usage summary card — the weekly-reset line, a
  "Manage AI usage and plans" heading that drills into **AiUsage**, and two
  at-a-glance mini-gauges (AI-token % and assistant call-time used/limit). The full
  gauges/breakdowns and the free-plan **See plans** CTA (into **ComparePlans**)
  live on the AiUsage screen.
- Both enforced budgets are surfaced as gauges: **AiUsage** shows the weekly token
  gauge AND a separate assistant **call-time** gauge (`callSecondsUsed` /
  `weeklyCallSecondsLimit`, in minutes), and **ComparePlans** lists each tier's
  weekly call-time allowance from the catalog (`weeklyCallSecondsLimit`;
  unlimited/`null` reads as "Unlimited assistant phone calls").

### AI-usage metering

- Every AI call records token usage against a weekly budget
  (`services/aiUsage.js` patches the Anthropic SDK; streaming records in
  `chatStream.js`). Limits are plan-dependent — free/premium/unlimited — and gate
  assistant use; the AiUsage screen shows consumption. See
  [ai-assistant.md](ai-assistant.md).
- **Assistant phone calls have their own weekly budget, measured in seconds of
  connected call time** (`tiers.<plan>.weeklyCallSecondsLimit`; `null` =
  unlimited) — a SEPARATE resource from the token budget, because Vapi bills calls
  per-minute (STT + TTS + telephony dominate; the LLM tokens are negligible). Same
  scope model as tokens: per-user on free, pooled household on paid, with a
  fresh-pool-on-upgrade baseline (`usageCallSeconds` / `usageCallSecondsBaseline`).
  A call's `durationSeconds` is charged against this budget once, when Vapi reports
  the finished call (`services/phoneCalls` → `recordCallSecondsById`;
  `PhoneCall.metered` guards re-counting). Placing a call is pre-checked against
  the seconds budget (`meterCallSeconds` on `/calls/cancel-event` and
  `/calls/event-action`; the chat `call_business` tool pre-checks inline via
  `callSecondsStatus`) → `402 CALL_SECONDS_EXCEEDED` when exhausted.
  `GET /billing/status` reports `callSecondsUsed` / `weeklyCallSecondsLimit` /
  `callSecondsPct` alongside the token gauge.
- The AiUsage "By feature" breakdown lists per-action **counts** for the scope
  (this user on free, the household pool on paid). Phone calls get their own
  feature line as a placement count from `PhoneCall` (kept separate from the chat
  bucket — `GET /billing/status` folds it into `usage.call`); their enforced cost
  is the call-time budget above, not this count row.

### Monetization config

- `MonetizationConfig` (a single doc) holds `tiers`, `costs`, `models`,
  `activity`, `fees`, `guards` (e.g. `mapsPerDay`), and `admin`. Per tier the admin
  config page edits both enforced caps: **Weekly token limit** and **Weekly call
  limit** (entered in minutes, stored as `weeklyCallSecondsLimit`). Edited only
  through the admin app via `/api/monetization-config` (`requireAdmin`).
- **Admin-account AI policy** (`admin.unlimitedAi`, default `true`) controls
  whether users with the `admin` role are exempt from the weekly token and
  call-time budgets. It is an admin-config toggle (an "Admin accounts" card on the
  monetization config page), not a hardcoded email/account allowlist. When on,
  admins skip enforcement (internal team + testing); when off, admins are metered
  like everyone else. Usage is tracked regardless. Read by the usageMeter
  middleware (`adminUnlimited`) and the `GET /billing/status` gauge, so the gauge
  reports admins as unlimited exactly when the toggle exempts them.
- Product-usage insights are in `/api/admin/analytics` (content-blind). The admin
  **AiUsage** view surfaces both budgets: fleet tokens AND fleet call-time this
  week, plus a per-user call-time column (used / limit, pooled on paid) — from
  `/analytics/tokens`, which returns `callSeconds` (own) / `callSecondsUsed`
  (enforced) / `callSecondsLimit` per user and `fleet.callSecondsThisPeriod`.

## Data & API surface

- **Model:** `MonetizationConfig`; plan/usage state lives on `User`.
- **Endpoints:** `billing.js` (`webhook`, `status`, `select`),
  `monetizationConfig.js` (admin), `/api/admin/analytics`.
- **Client:** `screens/plan/*`, `lib/purchases.ts`; admin app for catalog config.
- **Config:** `REVENUECAT_WEBHOOK_SECRET`; `EXPO_PUBLIC_RC_IOS_KEY` /
  `EXPO_PUBLIC_RC_ANDROID_KEY` (build env).

## Encryption boundary

Plan status and AI-usage counts are server-visible by necessity (counts only,
never prompt content). See [operations/transparency.md](../operations/transparency.md).

## Verification

- Webhook: secret verification, grant → revoke lifecycle, cancellation vs.
  refund timing, lifecycle state stamping (renewal, billing-issue, expiration),
  transfer/unknown-entitlement acks, unknown-household ack —
  `billingWebhook.integration.test.js`.
- Billing route helpers (status/gauge shaping) — `routes/billing.test.js`.
- Token metering (weekly budget accounting in the usage meter) —
  `middleware/usageMeter.tokens.test.js`; the AI-side enforcement view is in
  [ai-assistant.md](ai-assistant.md).
- The paywall/purchase client path (`react-native-purchases`) is exercised
  on-device only.

## Open questions

- Document the exact per-tier limits (AI actions/week, maps/day) as configured in
  `MonetizationConfig`, and the weekly reset boundary.
- Confirm the subscription lifecycle states and their UX (active, grace, expired).
