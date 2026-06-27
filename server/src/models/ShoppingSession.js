const mongoose = require('mongoose');

const shoppingSessionSchema = new mongoose.Schema({
  userId:    { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  weekStart: { type: String, required: true }, // 'YYYY-MM-DD'
  state: { type: mongoose.Schema.Types.Mixed, default: {} },
}, { timestamps: true });

shoppingSessionSchema.index({ userId: 1, weekStart: 1 }, { unique: true });

module.exports = mongoose.model('ShoppingSession', shoppingSessionSchema);
