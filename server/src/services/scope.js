// Signal-parity C4 (hide record authorship) — the household-scoped read/write
// filter for content collections, in one place so `requireAuth` (which attaches
// `req.scopeFilter`) and the AI tool executors (which receive a bare `scopeIds`
// array) build the exact same clause.
//
// A sealed HDK record carries no plaintext `userId` (the author is inside `enc`),
// so scoping by `userId ∈ scopeIds` alone would miss it. Scope by the stamped
// plaintext `householdId` too. The `$or` is a strict superset-safe equivalent of
// the old member filter (a legacy record with only `userId` is still found; a
// sealed record with only `householdId` too) with no cross-household leak
// (`householdId` is exact and `scopeIds` are that household's members), so no
// data backfill is required. A solo user (no household) stays per-user.
function scopeClause(scopeIds, householdId) {
  return householdId
    ? { $or: [{ householdId }, { userId: { $in: scopeIds } }] }
    : { userId: { $in: scopeIds } };
}

module.exports = { scopeClause };
