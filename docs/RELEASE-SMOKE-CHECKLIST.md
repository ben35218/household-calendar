# Release smoke checklist — E2EE go-live

The code path from here to the stores: **one EAS build → ~30 min on-device
smoke pass → submit → per-household drop after users update.** Everything on
this list is the part only a human with a device/prod access can do; all the
logic behind it is unit/integration-tested (server suite 100, incl. the full
drop journey against in-memory Mongo).

## 0. One-time setup before the build

- [ ] **Passkey domain association** (only if shipping passkey unlock in this
      build; otherwise the card simply won't appear and this can wait):
      - Serve `https://<domain>/.well-known/apple-app-site-association` with a
        `webcredentials` block listing the app ID, and
        `assetlinks.json` for Android.
      - Add `"associatedDomains": ["webcredentials:<domain>"]` under `ios` in
        `mobile/app.json`, and set `expo.extra.passkeyRpId` (or
        `EXPO_PUBLIC_PASSKEY_RP_ID`) to that domain.
      - PRF needs iOS 18+ (or Android with a PRF-capable provider).
- [ ] `E2EE_MIN_APP_VERSION` env on the server = the version you're about to
      ship (the readiness gate then blocks the drop for households with older
      clients).
- [ ] SMTP env (`GMAIL_USER`/`GMAIL_APP_PASSWORD` or transport of choice) if
      you want real storage-mode emails; harmless no-op otherwise.
      Leave `CLOUD_PURGE_LIVE` **unset** — purge stays dry-run.

## 1. Build

- [ ] `eas build` (dev-client first if you want to iterate, then the store
      profile). This build is required regardless of E2EE: `expo-file-system`,
      `expo-sqlite`, `expo-background-fetch`, `expo-task-manager`, and
      `react-native-passkeys` are new native modules that have never run.

## 2. On-device smoke pass (dual-write mode, ~30 min)

Sign in with a real test account (household of 2 if possible: owner + member).

- [ ] **Boot + replica:** app starts, lists load. Console should show the
      sqlite replica in use (no AsyncStorage fallback warning).
- [ ] **Manual crypto roundtrip:** Item → upload a PDF manual (encrypted path
      runs when unlocked) → open it back (downloads, decrypts, share sheet
      shows the readable PDF).
- [ ] **Trip attachment roundtrip:** private trip → booking → "Attach
      confirmation" → pick a PDF/image → reopen it (lock icon shows on the
      row). Then share the trip and confirm attaching to a shared booking
      still works (plaintext path).
- [ ] **Export → restore:** Privacy → Export encrypted backup (passphrase) →
      Restore from backup with the same file + passphrase → "records imported".
      Wrong passphrase must fail cleanly.
- [ ] **Member removal + rotation self-heal:** owner removes the member in
      Household → removed member lands in their own household; owner's next
      unlock rotates the key (readiness shows v2; old records still readable).
- [ ] **Passkey (if configured):** Account → Add a passkey → Face ID sheet →
      "Passkey added". Kill the app, relaunch → Face ID prompt unlocks without
      a password.
- [ ] **Background refresh:** just confirm registration didn't error (Console/
      Xcode log); the OS decides when it actually fires.
- [ ] **Reminders:** create an event with a reminder a few minutes out,
      background the app, notification arrives.

## 3. Submit to the stores

Nothing E2EE-visible changes for users until their household drops.

## 4. Per-household plaintext drop (post-publish, irreversible)

Start with your own household.

- [ ] Every member updated to the new build and signed in (they auto-report
      client versions).
- [ ] In-app migration screen (Profile → encryption migration) shows readiness
      green; run the straggler re-encrypt if it lists any.
- [ ] `node src/scripts/dropPlaintext.js <householdId>` (dry run) → READY,
      0 missing enc.
- [ ] On-device read-back FIRST (§9.2): unlocked member sees calendar, people,
      recipes, trips, items — all decrypting from `enc`.
- [ ] `node src/scripts/dropPlaintext.js <householdId> --commit`
- [ ] Post-drop on-device pass: everything still reads; create + edit a record;
      assistants still answer (client-supplied context); trip share prompts the
      decrypt-on-share confirmation.
- [ ] Check the `plaintext_dropped` AuditLog row and the admin E2EE ops view.

## 5. Deliberately NOT in this release

- Live purge (`CLOUD_PURGE_LIVE`) — flip only after a staging run with a full
  replica including attachments.
- Cross-household trip attachment crypto — design gap, shared trips stay
  plaintext by design (§9.3).
- Replica-driven list queries/pagination — perf work, post-launch.
- Re-encrypting a departed member's own moved data — accepted §5.2 limitation.
