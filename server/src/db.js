const mongoose = require('mongoose');

// The household join code was removed (sharing is by email invitation). Its old
// UNIQUE index treats a missing field as null, so once households stop carrying a
// joinCode a second such insert would collide on the duplicate null key. Drop the
// stale index on boot — idempotent, and a no-op on fresh/in-memory databases that
// never had it.
async function dropLegacyJoinCodeIndex() {
  try {
    const coll = mongoose.connection.db.collection('households');
    const indexes = await coll.indexes();
    const stale = indexes.find((ix) => ix.key && ix.key.joinCode !== undefined);
    if (stale) await coll.dropIndex(stale.name);
  } catch { /* collection/index absent — nothing to drop */ }
}

async function connectDB() {
  const uri = process.env.MONGODB_URI || 'mongodb://localhost:27017/household-calendar';
  await mongoose.connect(uri);
  await dropLegacyJoinCodeIndex();
  console.log('MongoDB connected');
}

module.exports = connectDB;
