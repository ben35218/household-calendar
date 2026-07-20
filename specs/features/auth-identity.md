---
title: Auth & identity
status: current
last-verified: dad7c5a (2026-07-20)
code:
  - mobile/src/screens/auth/
  - mobile/src/store/auth.tsx
  - server/src/routes/auth.js
  - server/src/routes/authPasskey.js
  - server/src/routes/keys.js
  - server/src/models/User.js
  - server/src/models/DeviceLink.js
  - mobile/src/lib/{passkeys,secureToken,deviceLink,deviceKey}.ts
---

# Auth & identity

## Purpose

Account sign-in and the identity/unlock factors that gate E2EE. Because content
is encrypted under keys derived from these factors, **authentication and
key-unlock are the same event** — a login must both prove who you are and open
your private key. The key primitives are in
[platform/crypto-e2ee.md](../platform/crypto-e2ee.md).

## Behavior (normative)

### Registration

- `POST /auth/register` creates the `User`, seeds default categories, and
  provisions the E2EE identity: an X25519 keypair whose private key is wrapped by
  a **password** factor (Argon2id). Registration flows into mandatory
  **recovery-code** enrollment (`RecoveryCodeModal`) and prompts passkey setup.
- Every account MUST have at least one non-password recovery path (recovery code
  and/or passkey) so a forgotten password isn't total data loss.

### Sign-in paths

- **Password:** `POST /auth/login` → JWT; the client derives the KEK and unwraps
  the private key (`store/auth.tsx`).
- **Passkey:** a single Face ID assertion both signs in and unlocks E2EE.
  `POST /auth/passkey/challenge` returns each credential's `prfSalt`;
  `POST /auth/passkey/login` verifies the WebAuthn assertion; the PRF output
  derives the KEK. Passkeys are also registered as sign-in credentials
  (`/auth/passkey/register-options` + `/register`, `@simplewebauthn/server`,
  stored on `User.passkeyCredentials`).
- **Email-OTP / forgot-password:** `POST /auth/forgot` emails a 6-digit code;
  `POST /auth/reset` consumes it. A reset deliberately leaves the stale password
  envelope in place — the client re-wraps the private key after a passkey/recovery
  unlock (it cannot unwrap from a new password alone).

### New-device protection

- A password reset from an unrecognized device is **held** (`resetHoldUntil`,
  `RESET_COOLDOWN_HOURS`) and loudly announced to existing devices + email; the
  user can cancel it with `POST /auth/reset/cancel`.
- Auth endpoints are per-IP rate-limited; sessions slide via `X-Refreshed-Token`.

### Factors, sessions, devices

- Factor management: `GET /keys/me`, `POST /keys/enroll`,
  `POST /keys/recovery-complete`, `PUT /keys/factors`,
  `DELETE /keys/factors/:factor`. Adding/removing a factor re-wraps only the
  private key, never household data.
- **Device linking:** `POST /keys/link/start` + `/link/complete` (+ public
  `GET /keys/link/:linkId`) hand the identity key to a second device without a
  password round-trip (`lib/deviceLink.ts`, `LinkDeviceScreen`).
- Sessions: `GET /auth/sessions`, `DELETE /auth/sessions/:sid`. Account
  self-service: `GET /auth/me`, `PUT /auth/email`, `PUT /auth/password`,
  `DELETE /auth/account` (immediate full deletion).
- The JWT lives in `expo-secure-store` (`lib/secureToken.ts`); an automatic Face
  ID unlock is attempted on token-restore relaunch.

## Data & API surface

- **Model:** `User` (email, name, `passwordHash`, `identityPublicKey`,
  `wrappedPrivateKey[]` factor envelopes, `passkeyCredentials[]`, recovery/reset
  state, `sessions{}`, `householdId`, `personId`), `DeviceLink`.
- **Endpoints:** `server/src/routes/auth.js`, `authPasskey.js` (mounted under
  `/api/auth`), `keys.js` (`/api/keys`).
- **Client:** `screens/auth/*` (Login, Register, ForgotPassword), `store/auth.tsx`,
  `lib/passkeys.ts`, `LinkDeviceScreen`, `AccountScreen`.

## Encryption boundary

Email/name and public key are server-visible; the private key is stored only as
per-factor ciphertext and every factor KEK is derived client-side. Config:
`PASSKEY_RP_ID`, `PASSKEY_ORIGINS`, `JWT_SECRET`, `RESET_COOLDOWN_HOURS`.

## Open questions

- Document the exact "recovery-health guard" thresholds that force re-enrollment.
- Confirm behavior for passkeys enrolled before public-key storage (no sign-in
  until re-added).
