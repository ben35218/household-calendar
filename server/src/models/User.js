const mongoose = require('mongoose');

// One push subscription per device the user opted in from. Two flavours:
//   - web:    Web Push (browser) — has `endpoint` + `keys`.
//   - native: a mobile app (Expo) — has `expoToken`.
// `platform` discriminates them so the push service can pick a transport.
const pushSubscriptionSchema = new mongoose.Schema({
  platform:  { type: String, enum: ['web', 'ios', 'android'], default: 'web' },
  endpoint:  { type: String },                      // web push only
  keys:      { p256dh: String, auth: String },      // web push only
  expoToken: { type: String },                      // native (Expo) only
  label:     String,        // user-agent / device hint for management
}, { _id: false, timestamps: true });

// A user's X25519 identity private key, stored server-side ONLY as ciphertext,
// wrapped independently by each enrolled unlock factor so any one can recover it
// (password-Argon2id / passkey-PRF / recovery-code). The server never holds a
// key that can decrypt these — it just persists opaque envelopes produced by the
// client (@household/crypto). See docs/E2EE-SYNC-PLAN.md §3.4.
const factorEnvelopeSchema = new mongoose.Schema({
  factor:   { type: String, enum: ['password', 'passkey', 'recovery'], required: true },
  nonce:    { type: String, required: true },   // secretbox nonce (b64url)
  ct:       { type: String, required: true },   // wrapped private key (b64url)
  // password (Argon2id) parameters — needed to re-derive the KEK on unlock.
  kdf:      { type: String, enum: ['argon2id'] },
  salt:     String,
  opslimit: Number,
  memlimit: Number,
  // passkey binding: which platform credential's PRF output unwraps this, plus
  // the PRF salt used. Multiple passkey factors may coexist (one per device),
  // keyed by credentialId.
  credentialId: String,
  prfSalt:      String,
}, { _id: false, timestamps: true });

const userSchema = new mongoose.Schema({
  email:             { type: String, required: true, unique: true, lowercase: true },
  passwordHash:      { type: String, required: true },

  // ── E2EE key material (Phase 1) ──────────────────────────────────────────
  // Plaintext public half of the identity keypair; used by household members to
  // wrap the Household Data Key to this user (Phase 2). Absent until enrolled.
  identityPublicKey: { type: String },
  wrappedPrivateKey: { type: [factorEnvelopeSchema], default: [] },
  keyEnrolledAt:     { type: Date },
  keySchemaVersion:  { type: Number, default: 1 },
  // Access role. 'admin' unlocks the monetization/admin web app surfaces.
  role:              { type: String, enum: ['user', 'admin'], default: 'user', index: true },
  householdId:       { type: mongoose.Schema.Types.ObjectId, ref: 'Household' }, // family the user belongs to
  personId:          { type: mongoose.Schema.Types.ObjectId, ref: 'Person' },    // optional link to the People roster
  firstName:         { type: String, required: true, trim: true },
  lastName:          { type: String, trim: true, default: '' },
  birthday:          { type: Date },
  // Lead-time (days) used by the tasks/chores "due-soon" list filter. Not a
  // notification setting — alerts are configured per item now.
  reminderLeadDays:  { type: Number, default: 7 },
  // Push opt-ins (web + native) — push is the only notification delivery channel.
  pushSubscriptions: { type: [pushSubscriptionSchema], default: [] },
  // Set by a client that schedules reminders on-device (Phase 5): the server
  // reminder cron then skips this user to avoid double-notifying. See §7.
  localReminders:    { type: Boolean, default: false },
  // Last app version this user reported (§9 readiness gate: the whole-household
  // migration requires every member on a compatible app before the drop).
  clientVersion:     { type: String },
  clientPlatform:    { type: String },  // 'web' | 'ios' | 'android'
  clientVersionAt:   { type: Date },
  // Last authenticated request from this user, stamped (throttled) by
  // requireAuth. Content-blind engagement signal powering the admin analytics
  // DAU/WAU/MAU + retention views. Absent until the user's first request post-deploy.
  lastActiveAt:      { type: Date, index: true },

  // Per-user weekly AI-action usage: { 'YYYY-MM-DD': { chat, scan, ... } }, same
  // shape/keying as Household.usage. On the FREE tier each member gets their own
  // quota, so metering enforces + displays against this counter rather than the
  // shared household pool (a family member joining shouldn't shrink everyone's
  // free allowance). Paid tiers stay pooled on the household. See usageMeter.
  // NOTE: these per-action counts are analytics-only now — enforcement is by the
  // weekly TOKEN budget (usageTokens below).
  usage: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  // Per-user weekly TOKEN usage (the enforced metric on the FREE tier):
  // { 'YYYY-MM-DD': { tokens } } where tokens = input+output+cache read+write.
  usageTokens: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },

  // ── Storage mode + cloud-purge lifecycle (Phase 6, §4.1/§6) ──────────────
  // Server-authoritative mirror of the device "store on this device only" pref.
  // Only settable to 'local' when the user is solo (§6.1). Going local schedules
  // a 7-day purge of this user's cloud ciphertext, with an undo window.
  storageMode:              { type: String, enum: ['cloud', 'local'], default: 'cloud' },
  cloudDeletionScheduledAt: { type: Date, default: null },
  cloudDeletionState:       { type: String, enum: ['none', 'scheduled', 'purged'], default: 'none' },
  // Proof the download-first local copy verified before we ever scheduled a
  // deletion (§6.2 step 3): the server never schedules against an unverified
  // replica. `manifestHash` is over the user's record ids/updatedAt.
  localReplicaVerifiedAt:   { type: Date, default: null },
  localReplicaManifestHash: { type: String, default: '' },
  timezone:          { type: String, default: 'America/Toronto' },
  homeAddress:       { type: String, default: '' },
  lat:               { type: Number },
  lon:               { type: Number },
  interests:           [{ type: String, trim: true }],
  aboutMe:             { type: String, trim: true },
  groceryShoppingDay:  { type: Number, default: 6 },  // 0=Sun...6=Sat, default Saturday
  grocerySections:     { type: [String], default: () => ['Produce', 'Deli', 'Bakery', 'Meat & Seafood', 'Dairy', 'Frozen', 'Pantry', 'Other'] },
}, { timestamps: true, toJSON: { virtuals: true } });

// Sparse index for the 7-day cloud-purge sweep (§4.1) — only scheduled users
// carry a date, so the cron scans a tiny set.
userSchema.index({ cloudDeletionScheduledAt: 1 }, { sparse: true });

// Convenience getter so existing code using req.user.name keeps working
userSchema.virtual('name').get(function () {
  return [this.firstName, this.lastName].filter(Boolean).join(' ');
});

module.exports = mongoose.model('User', userSchema);
