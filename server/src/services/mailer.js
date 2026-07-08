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
async function sendMail({ to, subject, text, html, attachments }) {
  if (!to) return { sent: false };
  if (!transport) {
    console.log(`[mailer] (dry) → ${to}: ${subject}`);
    return { sent: false, dryRun: true };
  }
  try {
    await transport.sendMail({ from: MAIL_FROM, to, subject, text, html, attachments });
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

// ── Event invitations ────────────────────────────────────────────────────────

// When/where line for the invite email body.
function fmtEventWhen(event) {
  if (event.allDay) {
    const start = fmtDate(event.startDate);
    if (!event.endDate || fmtDate(event.endDate) === start) return start;
    return `${start} – ${fmtDate(event.endDate)}`;
  }
  const opts = { year: 'numeric', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' };
  const start = new Date(event.startDate).toLocaleString('en-US', opts);
  if (!event.endDate) return start;
  return `${start} – ${new Date(event.endDate).toLocaleString('en-US', opts)}`;
}

// Invite a recipient to a calendar event. `ics` is the iCalendar text attached
// so the event imports into Apple/Google/Outlook straight from the email.
// `hasAccount` switches the call-to-action: open the app vs. join the app.
function sendEventInvitation({ toEmail, fromName, event, hasAccount, ics }) {
  const inviter = fromName || 'Someone';
  const lines = [
    `${inviter} invited you to an event:`,
    '',
    `  ${event.title}`,
    `  When: ${fmtEventWhen(event)}`,
    ...(event.location ? [`  Where: ${event.location}`] : []),
    ...(event.description ? ['', event.description] : []),
    '',
    'The attached invite.ics adds this event to Apple, Google, or Outlook Calendar.',
    '',
    hasAccount
      ? 'You can also accept or decline this invitation from the Invitations screen in the Household Calendar app — accepting adds the event to your calendar there.'
      : 'Join Household Calendar to keep events like this on a shared family calendar.',
  ];
  return sendMail({
    to: toEmail,
    subject: `${inviter} invited you: ${event.title}`,
    text: lines.join('\n') + '\n',
    attachments: ics ? [{ filename: 'invite.ics', content: ics, contentType: 'text/calendar; method=PUBLISH' }] : undefined,
  });
}

module.exports = {
  isConfigured,
  sendMail,
  sendDeletionScheduled,
  sendDeletionCanceled,
  sendDeletionPurged,
  sendEventInvitation,
};
