const mongoose = require('mongoose');

// A receipt / proof-of-purchase image attached to an Item, for the owner's
// records. Mirrors the Manual attachment pattern (disk-stored file + E2EE
// wrapping) minus the manual-specific lookup/parse fields.
const receiptSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  itemId: { type: mongoose.Schema.Types.ObjectId, ref: 'Item', required: true },
  title: { type: String, required: true },
  storageKey: String,
  fileType: { type: String, default: 'image/jpeg' },
  fileSizeBytes: Number,
  // E2EE attachment (Phase 4c): when `encrypted`, the stored file is opaque
  // ciphertext whose per-file key is wrapped to the household HDK. Same shape as
  // Manual — see models/Manual.js.
  encrypted:      { type: Boolean, default: false },
  wrappedFileKey: String,
  keyVersion:     Number,
}, { timestamps: true });

module.exports = mongoose.model('Receipt', receiptSchema);
