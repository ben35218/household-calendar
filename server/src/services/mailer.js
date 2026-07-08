const nodemailer = require('nodemailer');

// Outbound transactional email. There is no email history in the app today —
// this is introduced for the Phase 6 storage-mode/purge lifecycle (§6.2/§6.3):
// "your cloud copy will be deleted on <date>", the purge confirmation, and the
// undo/cancel notice.
//
// Config is env-driven and OPTIONAL. When SMTP isn't configured, every send is a
// no-op that logs what it *would* have sent (mirroring push.js's guarded model),
// so the lifecycle is structurally complete and testable without live SMTP. Set
// SMTP_URL (e.g. smtps://user:pass@smtp.host:465) or SMTP_HOST/SMTP_PORT/
// SMTP_USER/SMTP_PASS, plus MAIL_FROM, to enable real delivery.

const SMTP_URL  = process.env.SMTP_URL;
const SMTP_HOST = process.env.SMTP_HOST;
const SMTP_PORT = process.env.SMTP_PORT ? Number(process.env.SMTP_PORT) : undefined;
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const MAIL_FROM = process.env.MAIL_FROM || 'Household Calendar <no-reply@household-calendar.app>';

let transport = null;
if (SMTP_URL) {
  transport = nodemailer.createTransport(SMTP_URL);
} else if (SMTP_HOST) {
  transport = nodemailer.createTransport({
    host: SMTP_HOST,
    port: SMTP_PORT || 587,
    secure: SMTP_PORT === 465,
    auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASS } : undefined,
  });
} else {
  console.warn('[mailer] SMTP not configured — emails will be logged, not sent');
}

function isConfigured() {
  return !!transport;
}

// Send an email. No-ops (with a log) when SMTP is unconfigured, so callers never
// need to branch. Never throws — a failed notification must not break the
// storage-mode flow it accompanies.
async function sendMail({ to, subject, text, html }) {
  if (!to) return { sent: false };
  if (!transport) {
    console.log(`[mailer] (dry) → ${to}: ${subject}`);
    return { sent: false, dryRun: true };
  }
  try {
    await transport.sendMail({ from: MAIL_FROM, to, subject, text, html });
    return { sent: true };
  } catch (err) {
    console.error(`[mailer] send to ${to} failed:`, err.message);
    return { sent: false, error: err.message };
  }
}

// Human date for email copy, e.g. "July 13, 2026".
function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ── Storage-mode / purge lifecycle templates (§6) ───────────────────────────

function sendDeletionScheduled(user, scheduledAt) {
  const when = fmtDate(scheduledAt);
  return sendMail({
    to: user.email,
    subject: 'Your cloud copy is scheduled for deletion',
    text:
      `Hi ${user.firstName || 'there'},\n\n` +
      `You switched to storing your data on your device only. Your encrypted cloud ` +
      `copy will be permanently deleted on ${when}.\n\n` +
      `If you change your mind, switch back to "Back up in the Cloud" in the app ` +
      `before then and nothing will be deleted.\n\n` +
      `After deletion there is no automatic recovery — your device becomes the only ` +
      `copy of your data.\n`,
  });
}

function sendDeletionCanceled(user) {
  return sendMail({
    to: user.email,
    subject: 'Cloud deletion canceled',
    text:
      `Hi ${user.firstName || 'there'},\n\n` +
      `You switched back to cloud backup, so the scheduled deletion of your cloud ` +
      `copy has been canceled. Your data is syncing again.\n`,
  });
}

function sendDeletionPurged(user) {
  return sendMail({
    to: user.email,
    subject: 'Your cloud copy has been deleted',
    text:
      `Hi ${user.firstName || 'there'},\n\n` +
      `As scheduled, your encrypted cloud copy has been permanently deleted. Your ` +
      `data now lives only on your device.\n`,
  });
}

module.exports = {
  isConfigured,
  sendMail,
  sendDeletionScheduled,
  sendDeletionCanceled,
  sendDeletionPurged,
};
