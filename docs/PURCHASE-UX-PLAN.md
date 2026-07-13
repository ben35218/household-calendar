# Purchase UX — finish plan

Status doc for completing the in-app purchase experience (iOS first; Android
deferred until the Play app exists). This doc is the source of truth; check
items off as they land.

## What already works (verified 2026-07-09)

- **Server**: `POST /api/billing/webhook` live on Render, secret set, verified
  end-to-end with simulated events (purchase → premium → unlimited → free,
  unknown-user ack). `GET /billing/status` returns plan/usage/catalog.
- **Mobile**: `PaywallScreen` (tier cards from server catalog, package pickers,
  purchase + restore, activation poller that waits for the webhook to flip the
  plan, manage-subscription link, disclosure + legal links). `lib/purchases.ts`
  configures RevenueCat with the household id as `app_user_id`. Upsell surfaces
  (`AiUsageBanner`, `QuotaBlockedNotice`, `StorageBanner`) navigate to Paywall
  and are wired into the AI screens.
- **Store/RC infra**: ASC subscriptions created (group 22220919:
  `premium_monthly` $5.99, `unlimited_monthly` $12.99); RC iOS app
  `app72d007df60`; iOS public key in `eas.json` preview+production; EAS iOS
  builds working.

## P1 — RevenueCat catalog — ✅ DONE 2026-07-09 (via RC API v2 + ASC API)

RC project `proj15e36593`, iOS app `app72d007df60` (ASC API key + subscription
key configured in RC).

- [x] Entitlements `premium` (entlfb59798b6f) and `unlimited` (entl73b86c8fad).
- [x] ASC products imported and attached: `premium_monthly` → premium,
      `unlimited_monthly` → unlimited.
- [x] Default offering `ofrng98c090db32`: added packages `premium_monthly`
      (pkgea90592369c) and `unlimited_monthly` (pkgeb8559f8537) with the App
      Store products attached. The three auto-generated Test Store packages
      ($rc_monthly/$rc_annual/$rc_lifetime) remain, pointing only at Test
      Store products — harmless on iOS (filtered per-app), left for RC
      preview/testing.
- [x] ASC group levels verified correct: unlimited_monthly = 1,
      premium_monthly = 2.
- [x] Group localization was missing (a MISSING_METADATA cause) — added en-US
      "Household Calendar" via ASC API.
- [ ] **Review screenshots**: both subscriptions are `MISSING_METADATA` until
      each has a review screenshot uploaded. Not needed for sandbox dev
      testing, but required before App Review submission — capture the
      paywall during P4 and upload in ASC. (If sandbox products don't load in
      P4, this is the first suspect.)

## P2 — Legal pages — code ✅ DONE 2026-07-09; DNS + deploy pending

- [x] `static/index.html` + `terms.html` + `privacy.html` written (landing,
      Terms incl. auto-renew disclosure, Privacy incl. E2EE/AI/RevenueCat).
- [x] `render.yaml`: new `household-calendar-web` static site (rootDir
      `static/`, `/terms`+`/privacy` rewrites, domains householdcalendar.com
      + www).
- [x] `mobile/src/config.ts` default TERMS_URL/PRIVACY_URL fixed → .com.
- [x] ASC en-US privacyPolicyUrl set to https://householdcalendar.com/privacy
      (via API).
- [x] Pushed to main (7466b16, static/ + render.yaml only, via isolated
      worktree); blueprint sync created `household-calendar-web`
      (srv-d97vq5mrnols73aknuv0).
- [x] DNS done (ALIAS @ + CNAME www), both domains verified, TLS issued —
      https://householdcalendar.com/terms and /privacy live (verified 200,
      2026-07-09). www 301-redirects to the apex.

## P3 — Client + server polish — ✅ DONE 2026-07-09

- [x] Webhook event semantics fixed in `routes/billing.js`: TRANSFER (and any
      unmapped type) is acked with `{ok, ignored}` instead of 400/downgrade;
      CANCELLATION no longer revokes immediately (auto-renew off keeps access
      until EXPIRATION; only `cancel_reason: CUSTOMER_SUPPORT` refunds revoke
      now); grants with unrecognized entitlement ids no longer flip the
      household to free.
- [x] Covered by `src/test/billingWebhook.integration.test.js` (5 tests; full
      suite 125 pass).
- [x] Production builds get the RC iOS key via eas.json (verified present in
      preview + production profiles).
- [ ] Optional: intro-offer/trial display — skip unless a trial is configured
      in ASC.

## P4 — Sandbox end-to-end verification (on device)

2026-07-09: "Purchases coming soon" on the Plan screen was diagnosed — dev
(Metro) sessions had no RC key, so `isPurchasesConfigured()` was false and no
packages loaded. Fixed: `EXPO_PUBLIC_RC_IOS_KEY` added to `mobile/.env.local`
(picked up on next Metro restart) and to the eas.json `development` profile.
Purchases never work in Expo Go; the dev client build includes the native
module. Remaining prerequisite besides the sandbox tester: the **Paid
Applications agreement** must be Active in ASC (Business → Agreements) or
StoreKit returns zero products even in sandbox.

Use the iPhone SE 3 flow in memory (`iphone-device-testing`). Requires a
**Sandbox Apple ID** (ASC → Users and Access → Sandbox Testers).

- [ ] Production-profile build installed on device, signed into sandbox
      account (Settings → App Store → Sandbox Account).
- [ ] Paywall shows both tiers with real localized prices (proves the RC
      offering + ASC products are wired).
- [ ] Buy Premium → Apple sandbox sheet → activation poller shows
      "Activating…" then success; `/billing/status` reports `premium`;
      household doc has plan + `revenueCatId`.
- [ ] Upgrade Premium → Unlimited (tests group-level semantics).
- [ ] Restore purchases on a reinstall/second device.
- [ ] Cancel in sandbox (subscriptions auto-expire quickly in sandbox) →
      webhook `EXPIRATION` → plan back to `free`, upsell banners reappear.
- [ ] Check RC dashboard webhook log: all events 200.

## P5 — Android (deferred)

Blocked on Google Play verification. When the Play app exists: create the RC
Android app, fill `EXPO_PUBLIC_RC_ANDROID_KEY` in eas.json (currently `""` on
purpose — a placeholder breaks builds), mirror the products/offering, re-run
P4 on Android.

## Notes

- Sandbox purchases hit the same production webhook; RC marks them
  `environment: SANDBOX` in the event payload — the server currently ignores
  this, which is acceptable pre-launch but means a sandbox buy flips a real
  household's plan. Post-launch, consider filtering `environment` or using
  RC's separate sandbox webhook URL slot.
- Rotate the Render API key and RC webhook secret if desired post-setup (both
  pasted in chat).
