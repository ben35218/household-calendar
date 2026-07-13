const nodemailer = require('nodemailer');
const mongoose = require('mongoose');
const EmailLog = require('../models/EmailLog');

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
const MAIL_FROM = process.env.MAIL_FROM || 'Household Calendar <no-reply@householdcalendar.com>';

// App-download links for email CTAs. Store URLs stay unset until the listings
// exist (Phase 4); until then invitation emails fall back to the website link.
const APP_STORE_URL  = process.env.APP_STORE_URL;
const PLAY_STORE_URL = process.env.PLAY_STORE_URL;
const WEB_URL        = process.env.WEB_URL || 'https://householdcalendar.com';

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

// Record the outcome in EmailLog for the admin console's outbound monitor.
// Best-effort: skipped when Mongo isn't connected (scripts, some tests), and a
// write failure never surfaces to the caller.
function logSend({ to, subject, kind, status, error }) {
  if (mongoose.connection.readyState !== 1) return;
  EmailLog.create({ to, subject, kind: kind || 'other', status, error }).catch((err) => {
    console.error('[mailer] EmailLog write failed:', err.message);
  });
}

// Send an email. No-ops (with a log) when SMTP is unconfigured, so callers never
// need to branch. Never throws — a failed notification must not break the
// storage-mode flow it accompanies. `kind` tags the EmailLog row with the
// template that sent it.
async function sendMail({ to, subject, text, html, attachments, kind }) {
  if (!to) return { sent: false };
  if (!transport) {
    console.log(`[mailer] (dry) → ${to}: ${subject}`);
    logSend({ to, subject, kind, status: 'dry' });
    return { sent: false, dryRun: true };
  }
  try {
    await transport.sendMail({ from: MAIL_FROM, to, subject, text, html, attachments });
    logSend({ to, subject, kind, status: 'sent' });
    return { sent: true };
  } catch (err) {
    console.error(`[mailer] send to ${to} failed:`, err.message);
    logSend({ to, subject, kind, status: 'failed', error: err.message });
    return { sent: false, error: err.message };
  }
}

// Human date for email copy, e.g. "July 13, 2026".
function fmtDate(d) {
  return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// ── HTML layout ──────────────────────────────────────────────────────────────
// Every template sends both `text` and `html`. Inline styles only — most email
// clients strip <style> blocks. Brand blue matches mobile/src/theme.ts primary.

const BRAND = '#4F9DF5';

// User-supplied strings (event titles, names, locations) go through here
// before landing in HTML.
function esc(s) {
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function htmlLayout(contentHtml) {
  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#f3f4f6;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f4f6;"><tr><td align="center" style="padding:24px 12px;">
  <table role="presentation" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
    <tr><td style="background:${BRAND};padding:18px 32px;">
      <span style="color:#ffffff;font-size:18px;font-weight:700;">Household Calendar</span>
    </td></tr>
    <tr><td style="padding:28px 32px;color:#1f2937;font-size:15px;line-height:1.6;">
${contentHtml}
    </td></tr>
    <tr><td style="padding:18px 32px;border-top:1px solid #e5e7eb;color:#9ca3af;font-size:12px;line-height:1.5;">
      Household Calendar — a shared calendar for your household.<br>
      <a href="${WEB_URL}" style="color:#9ca3af;">householdcalendar.com</a>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

function htmlButton(href, label) {
  return `<a href="${esc(href)}" style="display:inline-block;background:${BRAND};color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;padding:12px 22px;border-radius:8px;">${esc(label)}</a>`;
}

// "Get the app" links: store buttons when the listings exist, website otherwise.
function downloadLinks() {
  const stores = [
    APP_STORE_URL  && { href: APP_STORE_URL,  label: 'Download on the App Store' },
    PLAY_STORE_URL && { href: PLAY_STORE_URL, label: 'Get it on Google Play' },
  ].filter(Boolean);
  const links = stores.length ? stores : [{ href: WEB_URL, label: 'Get Household Calendar' }];
  return {
    html: links.map((l) => htmlButton(l.href, l.label)).join('&nbsp;&nbsp;'),
    text: links.map((l) => `${l.label}: ${l.href}`).join('\n'),
  };
}

// ── Storage-mode / purge lifecycle templates (§6) ───────────────────────────

function sendDeletionScheduled(user, scheduledAt) {
  const when = fmtDate(scheduledAt);
  const hi = esc(user.firstName || 'there');
  return sendMail({
    to: user.email,
    subject: 'Your cloud copy is scheduled for deletion',
    kind: 'deletion_scheduled',
    text:
      `Hi ${user.firstName || 'there'},\n\n` +
      `You switched to storing your data on your device only. Your encrypted cloud ` +
      `copy will be permanently deleted on ${when}.\n\n` +
      `If you change your mind, switch back to "Back up in the Cloud" in the app ` +
      `before then and nothing will be deleted.\n\n` +
      `After deletion there is no automatic recovery — your device becomes the only ` +
      `copy of your data.\n`,
    html: htmlLayout(
      `<p style="margin:0 0 16px;">Hi ${hi},</p>
<p style="margin:0 0 16px;">You switched to storing your data on your device only. Your encrypted cloud copy will be permanently deleted on <strong>${when}</strong>.</p>
<p style="margin:0 0 16px;">If you change your mind, switch back to <strong>Back up in the Cloud</strong> in the app before then and nothing will be deleted.</p>
<p style="margin:0;color:#6b7280;">After deletion there is no automatic recovery — your device becomes the only copy of your data.</p>`
    ),
  });
}

function sendDeletionCanceled(user) {
  return sendMail({
    to: user.email,
    subject: 'Cloud deletion canceled',
    kind: 'deletion_canceled',
    text:
      `Hi ${user.firstName || 'there'},\n\n` +
      `You switched back to cloud backup, so the scheduled deletion of your cloud ` +
      `copy has been canceled. Your data is syncing again.\n`,
    html: htmlLayout(
      `<p style="margin:0 0 16px;">Hi ${esc(user.firstName || 'there')},</p>
<p style="margin:0;">You switched back to cloud backup, so the scheduled deletion of your cloud copy has been <strong>canceled</strong>. Your data is syncing again.</p>`
    ),
  });
}

function sendDeletionPurged(user) {
  return sendMail({
    to: user.email,
    subject: 'Your cloud copy has been deleted',
    kind: 'deletion_purged',
    text:
      `Hi ${user.firstName || 'there'},\n\n` +
      `As scheduled, your encrypted cloud copy has been permanently deleted. Your ` +
      `data now lives only on your device.\n`,
    html: htmlLayout(
      `<p style="margin:0 0 16px;">Hi ${esc(user.firstName || 'there')},</p>
<p style="margin:0;">As scheduled, your encrypted cloud copy has been permanently deleted. Your data now lives only on your device.</p>`
    ),
  });
}

// ── Forgot password ──────────────────────────────────────────────────────────

function sendPasswordResetCode(user, code) {
  return sendMail({
    to: user.email,
    subject: `${code} is your password reset code`,
    kind: 'password_reset',
    text:
      `Hi ${user.firstName || 'there'},\n\n` +
      `Your Household Calendar password reset code is:\n\n` +
      `  ${code}\n\n` +
      `Enter it in the app within 15 minutes to choose a new password. If you ` +
      `didn't request this, you can ignore this email — your password is unchanged.\n\n` +
      `Note: if you use encrypted sync, resetting your password does not unlock ` +
      `your encrypted data — you'll be asked for Face ID / Touch ID or your ` +
      `recovery code afterwards.\n`,
    html: htmlLayout(
      `<p style="margin:0 0 16px;">Hi ${esc(user.firstName || 'there')},</p>
<p style="margin:0 0 16px;">Your Household Calendar password reset code is:</p>
<div style="background:#f3f4f6;border-radius:8px;padding:16px;text-align:center;font-size:28px;letter-spacing:6px;font-weight:700;font-family:ui-monospace,Menlo,Consolas,monospace;color:#1f2937;">${esc(code)}</div>
<p style="margin:16px 0;">Enter it in the app within <strong>15 minutes</strong> to choose a new password. If you didn't request this, you can ignore this email — your password is unchanged.</p>
<p style="margin:0;color:#6b7280;">Note: if you use encrypted sync, resetting your password does not unlock your encrypted data — you'll be asked for Face&nbsp;ID / Touch&nbsp;ID or your recovery code afterwards.</p>`
    ),
  });
}

// ── Trip invites & recipe shares ─────────────────────────────────────────────
// Server-sent, styled counterparts to the OS share sheet (which can only carry
// plain text composed from the sender's own mail account).

// Email a trip invite code with join instructions.
// "X shared a trip with you" — sent when an outside email is added to a trip's
// sharing. Accepting (in-app) makes the recipient a collaborator with live
// access to the itinerary. Like a shared calendar, the content is ongoing, so
// there is no code to type: accept from the Invitations screen.
function sendTripShareInvitation({ toEmail, fromName, tripName, destination, hasAccount }) {
  const inviter = fromName || 'Someone';
  const get = downloadLinks();
  const sub = destination ? `${tripName} — ${destination}` : tripName;
  const lines = [
    `${inviter} shared a trip with you:`,
    '',
    `  ${sub}`,
    '',
    hasAccount
      ? 'Accept or decline from the Invitations screen in the Household Calendar app — accepting shows the full itinerary and lets you add to it.'
      : 'Join Household Calendar to see this trip and plan it together.',
    '',
    get.text,
  ];
  return sendMail({
    to: toEmail,
    subject: `${inviter} shared a trip: ${tripName}`,
    kind: 'trip_invitation',
    text: lines.join('\n') + '\n',
    html: htmlLayout(
      `<p style="margin:0 0 16px;"><strong>${esc(inviter)}</strong> shared a trip with you:</p>
<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px;margin:0 0 20px;">
  <div style="font-size:18px;font-weight:700;color:#111827;">${esc(tripName)}</div>
  ${destination ? `<div style="color:#6b7280;font-size:13px;margin-top:4px;">${esc(destination)}</div>` : ''}
</div>
<p style="margin:0 0 20px;">${
        hasAccount
          ? 'Accept or decline from the <strong>Invitations</strong> screen in the Household Calendar app — accepting shows the full itinerary and lets you add to it.'
          : 'Join Household Calendar to see this trip and plan it together.'
      }</p>
<div style="text-align:center;margin:0 0 4px;">${get.html}</div>`
    ),
  });
}

// "X invited you to their household" — sent when a member invites an email to
// join their household. Accepting opens a join request; a member then confirms
// on their device (the household's data is end-to-end encrypted, so the key is
// granted device-to-device). Ongoing membership, so no code to type.
function sendHouseholdInvitation({ toEmail, fromName, householdName, hasAccount }) {
  const inviter = fromName || 'Someone';
  const get = downloadLinks();
  const lines = [
    `${inviter} invited you to join their household “${householdName}” on Household Calendar.`,
    '',
    hasAccount
      ? 'Accept from the Invitations screen in the app. A household member will then confirm you on their device, and you\'ll share the family calendar, tasks, trips, and more.'
      : 'Join Household Calendar to accept — you\'ll share the family calendar, tasks, trips, and more.',
    '',
    get.text,
  ];
  return sendMail({
    to: toEmail,
    subject: `${inviter} invited you to join “${householdName}”`,
    kind: 'household_invitation',
    text: lines.join('\n') + '\n',
    html: htmlLayout(
      `<p style="margin:0 0 16px;"><strong>${esc(inviter)}</strong> invited you to join their household:</p>
<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px;margin:0 0 20px;">
  <div style="font-size:18px;font-weight:700;color:#111827;">${esc(householdName)}</div>
</div>
<p style="margin:0 0 20px;">${
        hasAccount
          ? 'Accept from the <strong>Invitations</strong> screen in the app. A household member will then confirm you on their device, and you\'ll share the family calendar, tasks, trips, and more.'
          : 'Join Household Calendar to accept — you\'ll share the family calendar, tasks, trips, and more.'
      }</p>
<div style="text-align:center;margin:0 0 4px;">${get.html}</div>`
    ),
  });
}

// Email a full recipe — self-contained, the recipient needs nothing installed.
function sendRecipeShare({ toEmail, fromName, recipe }) {
  const inviter = fromName || 'Someone';
  const mins = (recipe.prepTimeMins || 0) + (recipe.cookTimeMins || 0);
  const meta = [mins ? `${mins} min` : '', recipe.servings ? `${recipe.servings} servings` : '']
    .filter(Boolean)
    .join(' · ');
  const ingredients = (recipe.ingredients || []).map(
    (ing) => [ing.amount, ing.unit, ing.name].filter(Boolean).join(' '),
  );
  const instructions = recipe.instructions || [];
  const get = downloadLinks();
  const lines = [
    `${inviter} shared a recipe with you:`,
    '',
    `  ${recipe.title}`,
    ...(meta ? [`  ${meta}`] : []),
    ...(recipe.description ? ['', recipe.description] : []),
    '',
    'Ingredients:',
    ...ingredients.map((i) => `• ${i}`),
    '',
    'Instructions:',
    ...instructions.map((step, i) => `${i + 1}. ${step}`),
    '',
    get.text,
  ];
  return sendMail({
    to: toEmail,
    subject: `${inviter} shared a recipe: ${recipe.title}`,
    kind: 'recipe_share',
    text: lines.join('\n') + '\n',
    html: htmlLayout(
      `<p style="margin:0 0 16px;"><strong>${esc(inviter)}</strong> shared a recipe with you:</p>
<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px;margin:0 0 20px;">
  <div style="font-size:18px;font-weight:700;color:#111827;">${esc(recipe.title)}</div>
  ${meta ? `<div style="color:#6b7280;font-size:13px;margin-top:4px;">${esc(meta)}</div>` : ''}
  ${recipe.description ? `<p style="margin:10px 0 0;color:#374151;font-size:14px;">${esc(recipe.description)}</p>` : ''}
</div>
<div style="font-size:15px;font-weight:700;color:#111827;margin:0 0 8px;">Ingredients</div>
<ul style="margin:0 0 20px;padding-left:20px;color:#374151;font-size:14px;line-height:1.8;">
  ${ingredients.map((i) => `<li>${esc(i)}</li>`).join('\n  ')}
</ul>
<div style="font-size:15px;font-weight:700;color:#111827;margin:0 0 8px;">Instructions</div>
<ol style="margin:0 0 20px;padding-left:20px;color:#374151;font-size:14px;line-height:1.8;">
  ${instructions.map((s) => `<li>${esc(s)}</li>`).join('\n  ')}
</ol>
<div style="text-align:center;margin:0 0 4px;">${get.html}</div>`
    ),
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
  const when = fmtEventWhen(event);
  const get = downloadLinks();
  const lines = [
    `${inviter} invited you to an event:`,
    '',
    `  ${event.title}`,
    `  When: ${when}`,
    ...(event.location ? [`  Where: ${event.location}`] : []),
    ...(event.description ? ['', event.description] : []),
    '',
    'The attached invite.ics adds this event to Apple, Google, or Outlook Calendar.',
    '',
    hasAccount
      ? 'You can also accept or decline this invitation from the Invitations screen in the Household Calendar app — accepting adds the event to your calendar there.'
      : 'Join Household Calendar to keep events like this on a shared family calendar.',
    '',
    get.text,
  ];
  const detailRow = (label, value) =>
    `<tr><td style="padding:2px 12px 2px 0;color:#6b7280;font-size:13px;white-space:nowrap;vertical-align:top;">${label}</td><td style="padding:2px 0;color:#1f2937;font-size:14px;">${esc(value)}</td></tr>`;
  const html = htmlLayout(
    `<p style="margin:0 0 16px;"><strong>${esc(inviter)}</strong> invited you to an event:</p>
<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px;margin:0 0 20px;">
  <div style="font-size:18px;font-weight:700;color:#111827;margin-bottom:8px;">${esc(event.title)}</div>
  <table role="presentation" cellpadding="0" cellspacing="0">
    ${detailRow('When', when)}
    ${event.location ? detailRow('Where', event.location) : ''}
  </table>
  ${event.description ? `<p style="margin:10px 0 0;color:#374151;font-size:14px;">${esc(event.description)}</p>` : ''}
</div>
<p style="margin:0 0 16px;">The attached <strong>invite.ics</strong> adds this event to Apple, Google, or Outlook Calendar.</p>
<p style="margin:0 0 20px;">${
      hasAccount
        ? 'You can also accept or decline this invitation from the <strong>Invitations</strong> screen in the Household Calendar app — accepting adds the event to your calendar there.'
        : 'Join Household Calendar to keep events like this on a shared family calendar.'
    }</p>
<div style="text-align:center;margin:0 0 4px;">${get.html}</div>`
  );
  return sendMail({
    to: toEmail,
    subject: `${inviter} invited you: ${event.title}`,
    kind: 'event_invitation',
    text: lines.join('\n') + '\n',
    html,
    attachments: ics ? [{ filename: 'invite.ics', content: ics, contentType: 'text/calendar; method=PUBLISH' }] : undefined,
  });
}

// "X shared a calendar with you" — sent when an outside email is added to a
// custom calendar's sharing. Accepting (in-app) grants live read access to the
// calendar's events, so unlike the event invitation there is no .ics: the
// content is ongoing, not a one-shot snapshot.
function sendCalendarInvitation({ toEmail, fromName, calendarName, hasAccount }) {
  const inviter = fromName || 'Someone';
  const get = downloadLinks();
  const lines = [
    `${inviter} shared a calendar with you:`,
    '',
    `  ${calendarName}`,
    '',
    hasAccount
      ? 'Accept or decline from the Invitations screen in the Household Calendar app — accepting shows this calendar and its events alongside your own.'
      : 'Join Household Calendar to see this calendar and keep your own family calendar in one place.',
    '',
    get.text,
  ];
  const html = htmlLayout(
    `<p style="margin:0 0 16px;"><strong>${esc(inviter)}</strong> shared a calendar with you:</p>
<div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:18px 20px;margin:0 0 20px;">
  <div style="font-size:18px;font-weight:700;color:#111827;">${esc(calendarName)}</div>
</div>
<p style="margin:0 0 20px;">${
      hasAccount
        ? 'Accept or decline from the <strong>Invitations</strong> screen in the Household Calendar app — accepting shows this calendar and its events alongside your own.'
        : 'Join Household Calendar to see this calendar and keep your own family calendar in one place.'
    }</p>
<div style="text-align:center;margin:0 0 4px;">${get.html}</div>`
  );
  return sendMail({
    to: toEmail,
    subject: `${inviter} shared a calendar: ${calendarName}`,
    kind: 'calendar_invitation',
    text: lines.join('\n') + '\n',
    html,
  });
}

module.exports = {
  isConfigured,
  sendMail,
  sendPasswordResetCode,
  sendDeletionScheduled,
  sendDeletionCanceled,
  sendDeletionPurged,
  sendEventInvitation,
  sendCalendarInvitation,
  sendTripShareInvitation,
  sendHouseholdInvitation,
  sendRecipeShare,
};
