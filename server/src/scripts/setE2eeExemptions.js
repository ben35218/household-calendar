/**
 * Reduce the mandatory-E2EE exempt set to an explicit allowlist of owner emails.
 * Every household NOT owned/joined by a listed email is put UNDER the mandate
 * (e2eeExempt = false); the listed emails' households are kept exempt.
 *
 *   node src/scripts/setE2eeExemptions.js a@x.com b@y.com            # DRY RUN
 *   node src/scripts/setE2eeExemptions.js a@x.com b@y.com --commit   # apply
 *
 * NOTE: this only flips WHO the write-guard applies to. It does NOT encrypt any
 * existing plaintext — an account becomes truly E2EE (e2eeActive) only when it
 * next runs born-encrypted activation on-device (enroll → mint → seal → drop).
 * An un-exempted account on a pre-mandate client that can't send `enc` will have
 * its writes rejected until it updates, so only run this when the un-exempted
 * accounts are throwaway/test or already on a sealing client.
 *
 * Idempotent; exclusion is by household, resolved from every member with a
 * listed email (so a shared household with a listed member stays exempt).
 */
const mongoose = require('mongoose');
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const connectDB = require('../db');
const Household = require('../models/Household');
const User = require('../models/User');

async function run({ emails, commit = false, log = console.log } = {}) {
  const wanted = (emails || []).map((e) => e.toLowerCase());
  if (!wanted.length) throw new Error('Pass at least one email to keep exempt.');

  const users = await User.find({ email: { $in: wanted } }, 'email householdId').lean();
  const foundEmails = new Set(users.map((u) => u.email.toLowerCase()));
  for (const e of wanted) if (!foundEmails.has(e)) log(`  ⚠ no account found for ${e} — it will NOT protect any household`);

  const exemptIds = [...new Set(users.map((u) => String(u.householdId)).filter(Boolean))];
  const exemptObjectIds = exemptIds.map((id) => new mongoose.Types.ObjectId(id));

  const total = await Household.countDocuments({});
  const willRequire = await Household.countDocuments({ _id: { $nin: exemptObjectIds }, e2eeExempt: true });
  const alreadyRequired = await Household.countDocuments({ _id: { $nin: exemptObjectIds }, e2eeExempt: { $ne: true } });
  const activeAmongRequired = await Household.countDocuments({ _id: { $nin: exemptObjectIds }, e2eeActive: true });

  log(`\nKeep-exempt emails: ${wanted.join(', ')}`);
  log(`Resolved to ${exemptIds.length} household(s): ${exemptIds.join(', ') || '(none)'}`);
  log(`\nHouseholds: ${total} total`);
  log(`  → to FLIP to required (currently exempt): ${willRequire}`);
  log(`  → already required (no change):           ${alreadyRequired}`);
  log(`  → keep exempt (the allowlist):            ${exemptIds.length}`);
  log(`  (of the required set, ${activeAmongRequired} are already e2eeActive)`);

  if (!commit) {
    log('\nDRY RUN — nothing changed. Re-run with --commit to apply.');
    return { total, willRequire, alreadyRequired, keptExempt: exemptIds.length, committed: false };
  }

  const req = await Household.updateMany({ _id: { $nin: exemptObjectIds } }, { $set: { e2eeExempt: false } });
  const ex = await Household.updateMany({ _id: { $in: exemptObjectIds } }, { $set: { e2eeExempt: true } });
  log(`\nCOMMITTED. ${req.modifiedCount} household(s) → required; ${ex.modifiedCount} household(s) → exempt.`);
  return { total, requiredModified: req.modifiedCount, exemptModified: ex.modifiedCount, committed: true };
}

if (require.main === module) {
  const emails = process.argv.slice(2).filter((a) => !a.startsWith('--'));
  const commit = process.argv.includes('--commit');
  (async () => {
    await connectDB();
    try { await run({ emails, commit }); }
    catch (e) { console.error(e.message || e); process.exitCode = 1; }
    await mongoose.disconnect();
  })();
}

module.exports = { run };
