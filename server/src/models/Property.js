const mongoose = require('mongoose');

// A physical property (home, cabin, rental…) that Property-type items belong to.
// Household-shared implicitly: queries scope by `userId: { $in: req.scopeIds }`,
// same pattern as Category/Item — no householdId field needed.
const propertySchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name:      { type: String, required: true },
  icon:      { type: String, default: 'mdi-home' },
  color:     { type: String, default: '#4CAF50' },
  sortOrder: { type: Number, default: 0 },
}, { timestamps: true });

module.exports = mongoose.model('Property', propertySchema);
