const path = require('path');
const fs = require('fs');
const EventAttachment = require('../models/EventAttachment');

// Where attachment files live on disk (matches routes/eventAttachments.js).
const uploadDir = path.resolve(process.env.UPLOAD_DIR || './uploads');

// Signal-parity C3b: an event delete is a /records tombstone now (the old
// per-event DELETE route that cascaded to its attachments was removed). This
// reaps any file attachments that referenced the just-deleted record — the DB
// rows and their on-disk bytes — so tombstoning an event doesn't orphan its
// files. The server stays content-blind: it doesn't learn that the record was an
// event, it simply removes any EventAttachment keyed by this id (a no-op for a
// non-event record, which has none). Best-effort: a failed unlink is swallowed so
// the delete still succeeds. Returns the number of attachment rows removed.
async function reapEventAttachments(recordId) {
  const attachments = await EventAttachment.find({ eventId: recordId }, 'storageKey').lean();
  if (!attachments.length) return 0;
  for (const a of attachments) {
    if (a.storageKey) {
      const filepath = path.join(uploadDir, a.storageKey);
      try { if (fs.existsSync(filepath)) fs.unlinkSync(filepath); } catch { /* best-effort */ }
    }
  }
  await EventAttachment.deleteMany({ eventId: recordId });
  return attachments.length;
}

module.exports = { reapEventAttachments };
