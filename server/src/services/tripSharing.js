// Cross-household trip sharing vs. E2EE (§6/§9).
//
// A trip is shared with collaborators who live OUTSIDE the owner's household and
// therefore do NOT hold the household's HDK. So a shared trip's content — the
// Trip and all its TripItems — must stay PLAINTEXT (no `enc` blob) so those
// collaborators can read it. This is the deliberate exception to the E2EE
// boundary the product accepts for trips.
//
// Consequences this module centralizes:
//   - the plaintext drop must NOT null a shared trip's plaintext, and must not
//     treat its (legitimately) missing `enc` as an unsealed straggler;
//   - the straggler/re-encrypt pass must not try to seal shared trips.
//
// "Shared" = sharing is enabled (a shareCode exists) OR at least one external
// collaborator has joined. Disabling sharing clears both (routes/trips.js), after
// which the trip is a normal private record again (lazy re-encrypt: it re-seals
// on its next edit).

// Mongo predicate for a shared trip.
const SHARED_TRIP_MATCH = {
  $or: [
    { shareCode: { $exists: true, $ne: null } },
    { collaborators: { $exists: true, $not: { $size: 0 } } },
  ],
};

function isTripShared(trip) {
  return !!(trip && (trip.shareCode || (Array.isArray(trip.collaborators) && trip.collaborators.length > 0)));
}

// The _ids of every shared trip owned by this scope (household member ids).
async function sharedTripIds(Trip, scopeIds) {
  const rows = await Trip.find({ userId: { $in: scopeIds }, ...SHARED_TRIP_MATCH }, '_id').lean();
  return rows.map((r) => r._id);
}

// Extra query fragment that EXCLUDES shared-trip content for a given collection,
// so the straggler scan and the drop leave those plaintext rows alone. Other
// collections are unaffected.
function excludeSharedFilter(collection, sharedIds) {
  if (!sharedIds || !sharedIds.length) return {};
  if (collection === 'Trip') return { _id: { $nin: sharedIds } };
  if (collection === 'TripItem') return { tripId: { $nin: sharedIds } };
  return {};
}

module.exports = { SHARED_TRIP_MATCH, isTripShared, sharedTripIds, excludeSharedFilter };
