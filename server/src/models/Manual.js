const mongoose = require('mongoose');

const manualSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  title: { type: String, required: true },
  source: { type: String, enum: ['uploaded', 'web-lookup', 'manual-url'], default: 'uploaded' },
  sourceUrl: String,
  storageKey: String,
  fileType: { type: String, default: 'application/pdf' },
  fileSizeBytes: Number,
  fetchedAt: Date,
}, { timestamps: true });

module.exports = mongoose.model('Manual', manualSchema);
