// Pure, side-effect-free helpers backing the admin routes. Kept separate so the
// non-trivial logic (input sanitizing, pagination math, readiness rollups, the
// self-demotion guard) is unit-testable without spinning up HTTP or a database —
// matching the repo's node:test style (see dropReadiness.test.js).

const { computeReadiness } = require('../services/dropReadiness');

// Escape a user-supplied string before embedding it in a RegExp, so a search
// like "a.b*" can't inject regex metacharacters.
function escapeRegex(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Build the Mongo filter for the user search. Empty/blank query → match all.
function buildUserFilter(q) {
  const trimmed = (q || '').trim();
  if (!trimmed) return {};
  const rx = new RegExp(escapeRegex(trimmed), 'i');
  return { $or: [{ email: rx }, { firstName: rx }, { lastName: rx }] };
}

// Clamp/normalize pagination params into { page, pageSize, skip } with sane
// bounds so callers can't request unbounded pages or negative skips.
function paginate({ page, pageSize } = {}, { defaultSize = 50, maxSize = 200 } = {}) {
  const p = Math.max(1, Number.parseInt(page, 10) || 1);
  const sizeRaw = Number.parseInt(pageSize, 10) || defaultSize;
  const size = Math.min(maxSize, Math.max(1, sizeRaw));
  return { page: p, pageSize: size, skip: (p - 1) * size };
}

// Reduce computeReadiness output to the compact per-household row the fleet
// dashboard renders (ready flag, enrolled/total counts, blocker count).
function summarizeReadiness(input) {
  const r = computeReadiness(input);
  const enrolled = r.perMember.filter((m) => m.enrolled && m.hasEnvelope && m.versionOk).length;
  return { ready: r.ready, enrolled, total: r.perMember.length, blockers: r.reasons.length, reasons: r.reasons };
}

// Sort key for the migration to-do order: not-ready (0) → ready (1) → live (2).
function readinessRank(h) {
  if (h.e2eeActive) return 2;
  return h.ready ? 1 : 0;
}

// Validate a role-change request. Returns { ok } or { ok:false, status, error }.
// Guards against an admin revoking their own access (which could lock everyone
// out) and against unknown roles.
function validateRoleChange({ targetId, actorId, role }) {
  if (!['user', 'admin'].includes(role)) {
    return { ok: false, status: 400, error: 'role must be "user" or "admin"' };
  }
  if (String(targetId) === String(actorId) && role !== 'admin') {
    return { ok: false, status: 400, error: 'You cannot revoke your own admin access.' };
  }
  return { ok: true };
}

// Members who are blocking a drop (not enrolled, no current envelope, or on an
// incompatible app build). `envByUser` maps userId → keyVersion.
function blockingMembers({ members, envByUser, currentKeyVersion, versionOk }) {
  return members.filter((m) => {
    const enrolled = !!m.identityPublicKey;
    const hasEnvelope = (envByUser[String(m._id)] ?? -1) === currentKeyVersion && currentKeyVersion > 0;
    const ok = versionOk ? versionOk(m) : true;
    return !(enrolled && hasEnvelope && ok);
  });
}

// Render an audit-log `meta` object as a compact "k: v, k: v" string.
function metaToString(meta) {
  if (!meta || typeof meta !== 'object') return '';
  const entries = Object.entries(meta);
  return entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join(', ') : '';
}

module.exports = {
  escapeRegex,
  buildUserFilter,
  paginate,
  summarizeReadiness,
  readinessRank,
  validateRoleChange,
  blockingMembers,
  metaToString,
};
