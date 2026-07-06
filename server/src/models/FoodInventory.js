const mongoose = require('mongoose');
const { encFields } = require('./encFields');

const foodInventorySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true, trim: true },
  quantity: { type: String, default: '' },
  category: {
    type: String,
    enum: ['produce', 'dairy', 'meat', 'seafood', 'deli', 'bakery', 'frozen', 'pantry', 'beverages', 'other'],
    default: 'other',
  },
  purchaseDate: { type: Date, default: Date.now },
  expirationDate: { type: Date },
  notes: { type: String, default: '' },
  status: {
    type: String,
    enum: ['active', 'used', 'thrown_out'],
    default: 'active',
  },
  statusDate: { type: Date },
  wasteReason: { type: String, default: '' },
  source: {
    type: String,
    enum: ['manual', 'receipt_photo', 'receipt_text'],
    default: 'manual',
  },
  // E2EE dual-write ciphertext (Phase 3+): see models/encFields.js.
  ...encFields,
}, { timestamps: true });

foodInventorySchema.index({ userId: 1, status: 1 });

module.exports = mongoose.model('FoodInventory', foodInventorySchema);
