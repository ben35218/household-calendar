// §9 drop readiness gate (pure logic, unit-tested).
//
// A household can have its plaintext dropped (records become truly private) only
// when EVERY member has enrolled keys and holds a HouseholdKeyEnvelope for the
// current HDK version — otherwise a member would be locked out of the data after
// the drop. This module is pure so it can be tested without a DB; the script /
// route feed it the fetched rows. See docs/E2EE-SYNC-PLAN.md §9 / §9.2.

// Per-collection **content** fields that are sealed into `enc` and therefore
// safe to null at the drop. Mirrors the client encrypt-subsets exactly (the
// fields the client puts in `enc`); routing/scheduling columns (userId,
// householdId, timestamps, keyVersion, foreign keys, nextDueDate, recurrence,
// reminder*, calendarType, active, etc.) stay plaintext and are NOT listed.
// CalendarEvent seals its whole payload, so all its content columns are listed.
const DROP_FIELDS = {
  CalendarEvent:  ['title', 'description', 'location', 'phone', 'startDate', 'endDate'],
  Person:         ['name', 'relationship', 'interests', 'notes', 'address', 'phone', 'email', 'birthday'],
  MaintenanceTask:['title', 'description', 'instructions', 'estimatedCost', 'estimatedDurationMins'],
  Chore:          ['title', 'instructions', 'description'],
  Recipe:         ['title', 'description', 'ingredients', 'instructions', 'tags', 'servings', 'prepTimeMins', 'cookTimeMins'],
  Trip:           ['name', 'destination', 'notes'],
  TripItem:       ['title', 'location', 'url', 'phone', 'notes', 'details'],
  Item:           ['name', 'manufacturer', 'modelNumber', 'serialNumber', 'location', 'notes', 'customFields'],
  FoodInventory:  ['name', 'quantity', 'notes'],
  Household:      ['homeAddress'],
};

function computeReadiness({ members = [], envelopes = [], currentKeyVersion = 0 }) {
  const perMember = members.map((m) => {
    const enrolled = !!m.identityPublicKey;
    const hasEnvelope = envelopes.some(
      (e) => String(e.userId) === String(m._id) && Number(e.keyVersion) === Number(currentKeyVersion),
    );
    return { userId: String(m._id), email: m.email, enrolled, hasEnvelope };
  });

  const reasons = [];
  if (!(currentKeyVersion >= 1)) reasons.push('household has no HDK yet (currentKeyVersion is 0)');
  if (!members.length) reasons.push('household has no members');
  for (const pm of perMember) {
    if (!pm.enrolled) reasons.push(`${pm.email || pm.userId} has not enrolled keys`);
    else if (!pm.hasEnvelope) reasons.push(`${pm.email || pm.userId} has no key envelope for v${currentKeyVersion}`);
  }

  return {
    ready: currentKeyVersion >= 1 && members.length > 0 && perMember.every((pm) => pm.enrolled && pm.hasEnvelope),
    currentKeyVersion,
    perMember,
    reasons,
  };
}

// The $unset spec to null a collection's plaintext content columns at the drop.
function dropUnsetFor(collection) {
  const fields = DROP_FIELDS[collection];
  if (!fields) return null;
  const unset = {};
  for (const f of fields) unset[f] = '';
  return unset;
}

module.exports = { computeReadiness, dropUnsetFor, DROP_FIELDS };
