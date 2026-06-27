/**
 * Grant (or revoke) the admin role for a user by email. Admins can access the
 * monetization/admin web app surfaces (requireAdmin-gated routes).
 *
 *   node src/scripts/grantAdmin.js user@example.com          # grant admin
 *   node src/scripts/grantAdmin.js user@example.com --revoke # back to 'user'
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const connectDB = require('../db');
const User = require('../models/User');

async function run() {
  const email = process.argv[2]?.toLowerCase();
  const revoke = process.argv.includes('--revoke');
  if (!email) {
    console.error('Usage: node src/scripts/grantAdmin.js <email> [--revoke]');
    process.exit(1);
  }

  await connectDB();

  const role = revoke ? 'user' : 'admin';
  const res = await User.updateOne({ email }, { $set: { role } });
  if (res.matchedCount === 0) {
    console.error(`No user found with email ${email}`);
    process.exit(1);
  }
  console.log(`Set role='${role}' for ${email}.`);
  process.exit(0);
}

run().catch((err) => { console.error(err); process.exit(1); });
