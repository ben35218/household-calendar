/**
 * One-time migration: seeds default subcategories for all existing users.
 * Safe to re-run — skips users who already have subcategories.
 *
 *   node src/scripts/seedSubcategories.js
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
const connectDB = require('../db');
const User = require('../models/User');
const { seedDefaultSubcategories } = require('../seed');
require('../models/Category');

async function run() {
  await connectDB();
  const users = await User.find().lean();
  console.log(`Seeding subcategories for ${users.length} user(s)…`);
  for (const user of users) {
    await seedDefaultSubcategories(user._id);
    console.log(`  ✓ ${user.email || user._id}`);
  }
  console.log('Done.');
  process.exit(0);
}

run().catch(err => { console.error(err); process.exit(1); });
