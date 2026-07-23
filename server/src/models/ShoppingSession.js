const mongoose = require('mongoose');

const shoppingSessionSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  // Household routing so the shared scopeClause ($or householdId/userId) can
  // match — and upsert — a session; without this field in the schema a strict
  // upsert through req.scopeFilter is rejected outright. One session per week
  // is shared by the household (the grocery list is household-level).
  householdId: { type: mongoose.Schema.Types.ObjectId, ref: 'Household' },
  weekStart: { type: String, required: true }, // 'YYYY-MM-DD'
  state: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

shoppingSessionSchema.index({ userId: 1, weekStart: 1 }, { unique: true });

module.exports = mongoose.model('ShoppingSession', shoppingSessionSchema);
