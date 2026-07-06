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
  // E2EE attachment (Phase 4c): when `encrypted`, the stored file is opaque
  // ciphertext (a serialized EncryptedFile) whose per-file key is wrapped to the
  // household HDK in `wrappedFileKey`. The server never reads the plaintext.
  encrypted:      { type: Boolean, default: false },
  wrappedFileKey: String,   // JSON of the RecordEnvelope wrapping the file key
  keyVersion:     Number,
}, { timestamps: true });

module.exports = mongoose.model('Manual', manualSchema);
