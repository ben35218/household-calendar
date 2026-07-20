---
title: Release & build
status: current
last-verified: dad7c5a (2026-07-20)
code:
  - mobile/RELEASE.md
  - mobile/eas.json
  - mobile/app.json
  - render.yaml
---

# Release & build

How Calen ships: the API to Render, the mobile app to the App Store / Play via
EAS. `mobile/RELEASE.md` holds the detailed store-prep checklist and credential
blockers; this spec is the current-state overview.

## Server (API)

- Deployed via the Render Blueprint ([`render.yaml`](../../render.yaml),
  `rootDir: server`). Set the production env (see the README env table:
  `MONGODB_URI`, `JWT_SECRET`, `ANTHROPIC_API_KEY`, `SMTP_*`, `EXPO_ACCESS_TOKEN`,
  `VAPI_*`, `REVENUECAT_WEBHOOK_SECRET`, `PASSKEY_*`, `CORS_ORIGINS`, and point
  `UPLOAD_DIR` at a persistent volume).

## Mobile (EAS)

- Profiles in [`mobile/eas.json`](../../mobile/eas.json): `development`
  (dev client), `preview` (internal distribution), `production` (store).
  `appVersionSource: remote` + `autoIncrement` — EAS manages build numbers.
- Client code is config-driven and degrades gracefully when external values are
  missing (push, purchases, API URL all have safe fallbacks — see `RELEASE.md`).
- **Credential blockers** (external, one-time): Expo/EAS project (`eas init`
  writes `projectId`), Apple Developer + App Store Connect record, Google Play
  Console + service-account JSON, RevenueCat project with the `premium` /
  `unlimited` entitlements + webhook, and the production HTTPS API URL. Details
  in `RELEASE.md`.

```bash
cd mobile
eas build --profile production --platform all
eas submit --profile production --platform ios       # TestFlight / App Store
eas submit --profile production --platform android   # Play internal track
```

## Pre-submit smoke pass

A native **dev/store build** is required whenever native modules change
(`expo-file-system`, `expo-sqlite`, `expo-notifications`, `react-native-passkeys`,
`react-native-purchases`) — they don't run in Expo Go. Minimum on-device pass:

- Sign in (token in SecureStore) → lists load from the live API; the sqlite
  replica is in use (no AsyncStorage fallback warning).
- Create + edit a record; confirm it syncs (`/records/sync`) and reads back.
- Encrypted attachment roundtrip: upload a manual/booking PDF → reopen (decrypts).
- Passkey (if configured): add a passkey → relaunch → Face ID unlocks without a
  password.
- Reminder: create an event with a near reminder, background the app, it arrives.
- Complete a sandbox IAP → plan flips via the webhook.
- Stream one assistant response (SSE).

## Deliberately NOT in scope

- The old **"per-household plaintext drop"** go-live is obsolete: E2EE is now
  mandatory and born-encrypted, so there is no plaintext to drop. (The former
  `docs/RELEASE-SMOKE-CHECKLIST.md` was written around that flow — it should be
  retired or rewritten to this pass.)
- Cross-household trip-attachment encryption (design gap — see [trips.md](../features/trips.md)).

## Open questions

- Retire/replace `docs/RELEASE-SMOKE-CHECKLIST.md` (E2EE-go-live specific).
- Document the Android release track status (currently iOS-first).
