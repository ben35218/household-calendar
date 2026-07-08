// Storage-mode / cloud-purge lifecycle (pure logic, unit-tested).
//
// A SOLO user may switch to "store on this device only" (§6.1). Doing so, after
// a verified download-first local copy (§6.2), schedules a 7-day purge of their
// cloud ciphertext with an undo window. This module holds the pure rules — date
// math, the due-sweep predicate, the solo + verified-replica guards, and the
// download-first manifest compare — so the route/cron/script can stay thin and
// the safety-critical logic is testable without a DB.
// See docs/E2EE-SYNC-PLAN.md §6.

const PURGE_WINDOW_DAYS = 7;
// A verified replica is only trusted for a short window — the client verifies
// then immediately schedules, so a stale stamp shouldn't authorize a purge.
const VERIFY_FRESHNESS_MS = 60 * 60 * 1000; // 1 hour

// When does a purge scheduled `at now` fall due?
function purgeDateFrom(now = new Date()) {
  return new Date(now.getTime() + PURGE_WINDOW_DAYS * 24 * 60 * 60 * 1000);
}

// Solo guard (§6.1): only a user alone in their household may go local. A
// household member's data stays in the encrypted cloud so everyone can see it.
function canGoLocal({ memberCount } = {}) {
  return Number(memberCount) <= 1;
}

// The $set that returns a user to cloud storage and cancels any pending purge.
// Shared by the storage "undo" route and the local→household transition (§6.4):
// members can't be local, so joining a household cancels a scheduled local purge
// and resumes cloud sync.
function cancelDeletionSet() {
  return {
    storageMode: 'cloud',
    cloudDeletionScheduledAt: null,
    cloudDeletionState: 'none',
    localReplicaVerifiedAt: null,
    localReplicaManifestHash: '',
  };
}

// Is this user's scheduled purge due to run? (`state==='scheduled'` and the
// deadline has passed.) The cron sweeps on this.
function isDueForPurge(user, now = new Date()) {
  return (
    !!user &&
    user.cloudDeletionState === 'scheduled' &&
    !!user.cloudDeletionScheduledAt &&
    new Date(user.cloudDeletionScheduledAt).getTime() <= now.getTime()
  );
}

// Deterministic pure-JS string hash (cyrb53 by bryc, public domain). Used
// instead of a crypto hash so the CLIENT can compute the identical fingerprint
// in plain JS with no native module (Hermes has Math.imul). This is a
// completeness fingerprint over the user's OWN records, not an adversarial
// integrity check — the records are already AEAD-protected and the user is
// deleting their own data — so a fast non-crypto hash is the right fit.
// IMPORTANT: mobile mirrors this exactly in lib/storageMode.ts — keep them in
// lockstep (there's a fixed-vector test below that pins the output).
function cyrb53(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, '0');
}

// Build a stable manifest over a user's records so client and server can prove
// the local copy is complete before we ever schedule a deletion (§6.2 step 3).
// `records` = [{ _id, collection, updatedAt }]. The hash covers id + updatedAt
// per record (order-independent); counts are per collection for a human-readable
// diff. Deliberately excludes content (the server can't read ciphertext anyway).
function buildManifest(records = []) {
  const counts = {};
  const lines = [];
  for (const r of records) {
    const collection = r.collection || 'Unknown';
    counts[collection] = (counts[collection] || 0) + 1;
    const updated = r.updatedAt ? new Date(r.updatedAt).toISOString() : '';
    lines.push(`${collection}:${String(r._id)}:${updated}`);
  }
  lines.sort();
  const hash = cyrb53(lines.join('\n'));
  return { total: records.length, counts, hash };
}

// Do a client-supplied manifest and the server's own manifest match? The hash is
// authoritative; `reasons` explains a mismatch (per-collection count deltas) for
// diagnostics. Only a match may authorize scheduling a purge.
function manifestsMatch(clientManifest, serverManifest) {
  const reasons = [];
  if (!clientManifest || !serverManifest) {
    return { match: false, reasons: ['missing manifest'] };
  }
  const collections = new Set([
    ...Object.keys(clientManifest.counts || {}),
    ...Object.keys(serverManifest.counts || {}),
  ]);
  for (const c of collections) {
    const cc = (clientManifest.counts || {})[c] || 0;
    const sc = (serverManifest.counts || {})[c] || 0;
    if (cc !== sc) reasons.push(`${c}: client has ${cc}, server has ${sc}`);
  }
  const hashMatch = clientManifest.hash === serverManifest.hash;
  if (!hashMatch && !reasons.length) reasons.push('record contents differ (hash mismatch)');
  return { match: hashMatch, reasons };
}

// Is a stored verified-replica stamp fresh enough to authorize scheduling a
// purge now? Guards against scheduling against an old verification.
function isReplicaVerificationFresh(user, now = new Date()) {
  return (
    !!user &&
    !!user.localReplicaVerifiedAt &&
    now.getTime() - new Date(user.localReplicaVerifiedAt).getTime() <= VERIFY_FRESHNESS_MS
  );
}

module.exports = {
  PURGE_WINDOW_DAYS,
  VERIFY_FRESHNESS_MS,
  purgeDateFrom,
  canGoLocal,
  cancelDeletionSet,
  isDueForPurge,
  cyrb53,
  buildManifest,
  manifestsMatch,
  isReplicaVerificationFresh,
};
