const mongoose = require('mongoose');

const itemSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  name: { type: String, required: true },
  categoryId: { type: mongoose.Schema.Types.ObjectId, ref: 'Category' },
  type: { type: String, enum: ['appliance', 'vehicle', 'system', 'structure', 'equipment', 'other'], default: 'other' },
  manufacturer: String,
  modelNumber: String,
  serialNumber: String,
  purchaseDate: Date,
  warrantyExpiry: Date,
  location: String,
  notes: String,
  customFields: [{ key: String, value: String }],
  photoRef: String,
  autoLookupManual: { type: Boolean, default: true },
}, { timestamps: true });

itemSchema.index({ userId: 1, name: 'text', manufacturer: 'text', modelNumber: 'text', location: 'text' });

module.exports = mongoose.model('Item', itemSchema);
