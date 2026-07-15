const mongoose = require('mongoose');

// A file attachment on a CalendarEvent (photo / PDF), stored for the household's
// records. Attaches to the event row itself, so on a recurring event it applies
// to every occurrence. Mirrors the Manual / Receipt attachment pattern (disk-
// stored file + optional E2EE file-key wrapping — see models/Receipt.js).
const eventAttachmentSchema = new mongoose.Schema({
  userId:  { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  eventId: { type: mongoose.Schema.Types.ObjectId, ref: 'CalendarEvent', required: true },
  title: { type: String, required: true },
  storageKey: String,
  fileType: { type: String, default: 'application/octet-stream' },
  fileSizeBytes: Number,
  // E2EE attachment (Phase 4c): when `encrypted`, the stored file is opaque
  // ciphertext whose per-file key is wrapped to the household HDK.
  encrypted:      { type: Boolean, default: false },
  wrappedFileKey: String,
  keyVersion:     Number,
}, { timestamps: true });

module.exports = mongoose.model('EventAttachment', eventAttachmentSchema);
