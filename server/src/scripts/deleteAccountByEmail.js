/**
 * Operator-facing account deletion by email. Runs the same full purge as the
 * in-app self-service delete (services/accountDeletion) against whatever
 * MONGODB_URI is configured.
 *
 *   node src/scripts/deleteAccountByEmail.js user@example.com
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const fs = require('fs');
const path = require('path');
const connectDB = require('../db');
// Register every model so the registry sweep in deleteUserAndData is complete
// (models otherwise register lazily as their route files are required).
const modelsDir = path.resolve(__dirname, '../models');
for (const f of fs.readdirSync(modelsDir)) {
  if (f.endsWith('.js')) require(path.join(modelsDir, f));
}
const User = require('../models/User');
const { deleteUserAndData } = require('../services/accountDeletion');

async function run() {
  const email = process.argv[2]?.toLowerCase();
  if (!email) {
    console.error('Usage: node src/scripts/deleteAccountByEmail.js <email>');
    process.exit(1);
  }

  await connectDB();

  const user = await User.findOne({ email });
  if (!user) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }

  console.log(`Deleting account ${email} (userId=${user._id}, householdId=${user.householdId || 'none'})…`);
  const { deleted } = await deleteUserAndData(user);
  console.log('Deleted per-collection counts:', JSON.stringify(deleted, null, 2));
  console.log('Done.');
  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
