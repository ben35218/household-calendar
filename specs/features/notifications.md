---
title: Notifications & reminders
status: current
last-verified: 4d68a39 (2026-07-21)
code:
  - mobile/src/lib/notifications.ts
  - mobile/src/lib/push.ts
  - server/src/routes/notifications.js
  - server/src/services/{push,notify}.js
  - server/src/jobs/scheduler.js
---

# Notifications & reminders

## Purpose

Two distinct channels: **event/task reminders** (whose content is encrypted, so
they're scheduled on-device) and **household security alerts** (server-driven
push). The root README's old "Web Push / daily Gmail digest" description is
obsolete.

## Behavior (normative)

### On-device reminders

- Reminder content (event titles, task names) is E2EE, so the server cannot
  build a reminder. The client schedules **local notifications**
  (`lib/notifications.ts`) from decrypted records, over a **rolling window**
  (respecting iOS' cap on pending notifications).
- Reminders honor a `remindersEnabled` pref (Privacy toggle); disabling
  cancels all scheduled ones.
- Events support up to two alerts; `alertAudience` (`everyone`/`owner`) chooses
  who is reminded in a shared household. Birthdays always alert everyone.
- **Day-based reminders** (chores, maintenance tasks, birthdays) fire at a
  wall-clock time of day rather than at an event start. The default is **7am
  local** (`ALERT_HOUR`). A chore or maintenance task may override this with its
  own `reminderTime` (`"HH:mm"`, sealed content) — both of its alerts
  (`reminderDaysBefore` and the optional `alert2DaysBefore`) fire at that time.
  Unset falls back to 7am. Birthdays have no per-item config and always fire at
  the 7am default.
- The server cron (`jobs/scheduler.js`) is a **duplicate guard**, not a sender:
  it uses `User.localReminders` to avoid also emitting a server-side reminder for
  something the device already schedules. The device registers its local-reminder
  state via `POST /notifications/local-reminders`.

### Push (security alerts)

- Real server→device push is used for security-lifecycle alerts (member/key/
  device/factor changes; see [households-sharing.md](households-sharing.md)),
  delivered through Expo (`services/push.js`, `services/notify.js`).
- Device registration: `POST /notifications/push/register-native` /
  `unregister-native` (Expo token on `User.pushSubscriptions`);
  `push/subscribe`/`unsubscribe` + `push/key` are the legacy Web-Push endpoints.

## Data & API surface

- **State:** `User.pushSubscriptions` (platform, endpoint/keys, `expoToken`,
  label), `User.localReminders`.
- **Endpoints:** `notifications.js` (push register/unregister, local-reminders).
- **Client:** `lib/push.ts` (registration), `lib/notifications.ts` (scheduling).
- **Config:** `EXPO_ACCESS_TOKEN` (server → Expo Push API); push needs the EAS
  `projectId` to mint tokens.

## Encryption boundary

Reminder content never reaches the server (scheduled on-device from decrypted
records). Security-alert pushes carry no content — only that a lifecycle event
occurred.

## Open questions

- Confirm whether the legacy Web-Push endpoints are still wired to any client or
  are dead code to remove.
- Document the rolling-window size and refresh trigger (background fetch).
