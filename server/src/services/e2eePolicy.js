// Mandatory-E2EE policy (pure, unit-tested). Single source of truth for "does
// this household have to be end-to-end encrypted?" — consumed by the born-
// encrypted onboarding finalize and the plaintext write-guard.
//
// E2EE is required for every household EXCEPT:
//   - explicitly exempt households (Household.e2eeExempt) — QA/test accounts and
//     the pre-mandate users grandfathered at rollout; and
//   - anything under NODE_ENV === 'test', so the integration suite (which uses
//     stand-in ciphertext, not real crypto) keeps exercising the plaintext paths.
function e2eeRequired(household) {
  // Under the integration suite the plaintext paths must keep working (stand-in
  // ciphertext, not real crypto), so E2EE is off by default in test. A single
  // opt-in flag lets the mandate tests turn enforcement on for one non-exempt
  // household without changing behaviour anywhere else.
  if (process.env.NODE_ENV === 'test' && process.env.E2EE_ENFORCE_IN_TEST !== '1') return false;
  if (!household) return false;
  return !household.e2eeExempt;
}

// Should this plaintext content-create be rejected? True when the household is
// under the E2EE mandate but the create carries no ciphertext (`enc`) blob. The
// single gate every content-create route consults before writing plaintext.
function plaintextCreateBlocked(household, enc) {
  return e2eeRequired(household) && !enc;
}

// One user-facing message for a blocked plaintext write, so the copy (and the
// "update your app" hint the min-version gate implies) stays consistent.
const E2EE_REQUIRED_MESSAGE =
  'This account is end-to-end encrypted. Please update to the latest app version to save changes.';

module.exports = { e2eeRequired, plaintextCreateBlocked, E2EE_REQUIRED_MESSAGE };
