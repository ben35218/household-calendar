---
title: Billing & plans
status: current
last-verified: dad7c5a (2026-07-20)
code:
  - mobile/src/screens/plan/
  - mobile/src/lib/purchases.ts
  - server/src/routes/billing.js
  - server/src/routes/monetizationConfig.js
  - server/src/models/MonetizationConfig.js
  - server/src/services/aiUsage.js
  - admin/
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

### AI-usage metering

- Every AI call records token usage against a weekly budget
  (`services/aiUsage.js` patches the Anthropic SDK; streaming records in
  `chatStream.js`). Limits are plan-dependent — free/premium/unlimited — and gate
  assistant use; the AiUsage screen shows consumption. See
  [ai-assistant.md](ai-assistant.md).

### Monetization config

- `MonetizationConfig` (a single doc) holds `tiers`, `costs`, `models`,
  `activity`, `fees`, and `guards` (e.g. `mapsPerDay`). Edited only through the
  admin app via `/api/monetization-config` (`requireAdmin`). Product-usage
  insights are in `/api/admin/analytics` (content-blind).

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

## Open questions

- Document the exact per-tier limits (AI actions/week, maps/day) as configured in
  `MonetizationConfig`, and the weekly reset boundary.
- Confirm the subscription lifecycle states and their UX (active, grace, expired).
