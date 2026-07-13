const { ImapFlow } = require('imapflow');
const { simpleParser } = require('mailparser');
const nodemailer = require('nodemailer');

// Support-mailbox access (support@householdcalendar.com) for the admin console:
// list, read, reply, and archive messages straight against the Migadu mailbox
// over IMAP, with replies sent over SMTP as support@ and appended to the Sent
// folder so the mailbox stays the single source of truth (nothing is copied
// into Mongo, and webmail keeps working alongside).
//
// Config is env-driven and OPTIONAL, mirroring mailer.js: without credentials
// every route reports "not configured" instead of failing. Migadu authenticates
// per-mailbox, so this uses the support@ mailbox's own login — the no-reply@
// SMTP credentials in mailer.js can't send or read as support@.
//
//   SUPPORT_EMAIL_USER  support@householdcalendar.com
//   SUPPORT_EMAIL_PASS  the mailbox password
//   SUPPORT_IMAP_HOST   default imap.migadu.com   SUPPORT_IMAP_PORT  default 993
//   SUPPORT_SMTP_HOST   default smtp.migadu.com   SUPPORT_SMTP_PORT  default 465

const USER      = process.env.SUPPORT_EMAIL_USER;
const PASS      = process.env.SUPPORT_EMAIL_PASS;
const IMAP_HOST = process.env.SUPPORT_IMAP_HOST || 'imap.migadu.com';
const IMAP_PORT = process.env.SUPPORT_IMAP_PORT ? Number(process.env.SUPPORT_IMAP_PORT) : 993;
const SMTP_HOST = process.env.SUPPORT_SMTP_HOST || 'smtp.migadu.com';
const SMTP_PORT = process.env.SUPPORT_SMTP_PORT ? Number(process.env.SUPPORT_SMTP_PORT) : 465;

// The mailboxes the admin UI can browse. Migadu creates INBOX/Sent/Archive by
// default; SPECIAL-USE lookup would be more general but these are fixed here
// for predictable tabs.
const MAILBOXES = ['INBOX', 'Archive', 'Sent'];

function isConfigured() {
  return !!(USER && PASS);
}

if (!isConfigured()) {
  console.warn('[supportMail] SUPPORT_EMAIL_USER/PASS not set — support inbox disabled in admin');
}

let smtpTransport = null;
function getSmtp() {
  if (!smtpTransport) {
    smtpTransport = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: USER, pass: PASS },
    });
  }
  return smtpTransport;
}

// Run `fn` with a fresh, logged-in IMAP connection, always logging out after.
// Support volume is admin-click-driven, so a connection per request is simpler
// and more robust than keeping a long-lived socket alive through idle/restarts.
async function withImap(fn) {
  const client = new ImapFlow({
    host: IMAP_HOST,
    port: IMAP_PORT,
    secure: true,
    auth: { user: USER, pass: PASS },
    logger: false,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.logout().catch(() => {});
  }
}

function addrText(addr) {
  if (!addr || !addr.length) return '';
  return addr.map((a) => (a.name ? `${a.name} <${a.address}>` : a.address)).join(', ');
}

// Unread counts per mailbox for the admin nav badge / tabs.
async function status() {
  return withImap(async (client) => {
    const boxes = [];
    for (const path of MAILBOXES) {
      try {
        const s = await client.status(path, { messages: true, unseen: true });
        boxes.push({ path, total: s.messages, unseen: s.unseen });
      } catch {
        boxes.push({ path, total: 0, unseen: 0, missing: true });
      }
    }
    return { boxes };
  });
}

// Newest-first page of message summaries (no bodies) from one mailbox.
async function listMessages({ mailbox = 'INBOX', page = 1, pageSize = 25 } = {}) {
  return withImap(async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const total = client.mailbox.exists;
      if (!total) return { items: [], total: 0, page, pageSize };

      // Sequence numbers count up from the oldest message, so page 1 (newest)
      // is the top of the range.
      const end = total - (page - 1) * pageSize;
      const start = Math.max(1, end - pageSize + 1);
      if (end < 1) return { items: [], total, page, pageSize };

      const items = [];
      for await (const msg of client.fetch(`${start}:${end}`, {
        uid: true, envelope: true, flags: true, size: true, bodyStructure: true,
      })) {
        items.push({
          uid: msg.uid,
          subject: msg.envelope.subject || '(no subject)',
          from: addrText(msg.envelope.from),
          to: addrText(msg.envelope.to),
          date: msg.envelope.date,
          seen: msg.flags.has('\\Seen'),
          answered: msg.flags.has('\\Answered'),
          hasAttachments: hasAttachments(msg.bodyStructure),
          size: msg.size,
        });
      }
      items.sort((a, b) => new Date(b.date) - new Date(a.date));
      return { items, total, page, pageSize };
    } finally {
      lock.release();
    }
  });
}

function hasAttachments(node) {
  if (!node) return false;
  if (node.disposition === 'attachment') return true;
  return (node.childNodes || []).some(hasAttachments);
}

// Full message: parsed headers + text + HTML body. Marks it \Seen (opening it
// in the admin UI is reading it). HTML is returned as-is; the client renders it
// inside a sandboxed iframe, never into its own DOM.
async function getMessage({ mailbox = 'INBOX', uid }) {
  return withImap(async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const msg = await client.fetchOne(String(uid), { source: true, flags: true }, { uid: true });
      if (!msg || !msg.source) return null;
      await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });

      const parsed = await simpleParser(msg.source);
      return {
        uid: Number(uid),
        mailbox,
        subject: parsed.subject || '(no subject)',
        from: parsed.from?.text || '',
        to: parsed.to?.text || '',
        cc: parsed.cc?.text || '',
        date: parsed.date,
        messageId: parsed.messageId,
        text: parsed.text || '',
        html: parsed.html || null,
        answered: msg.flags.has('\\Answered'),
        attachments: (parsed.attachments || []).map((a) => ({
          filename: a.filename || 'attachment',
          contentType: a.contentType,
          size: a.size,
        })),
      };
    } finally {
      lock.release();
    }
  });
}

// Reply to a message as support@: correct threading headers, quoted original
// omitted (the admin writes the full body), copy appended to Sent, original
// flagged \Answered.
async function reply({ mailbox = 'INBOX', uid, text }) {
  // Read the original first for addressing + threading.
  const original = await withImap(async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      const msg = await client.fetchOne(String(uid), { source: true }, { uid: true });
      return msg?.source ? simpleParser(msg.source) : null;
    } finally {
      lock.release();
    }
  });
  if (!original) throw new Error('Message not found');

  const replyTo = original.replyTo?.text || original.from?.text;
  if (!replyTo) throw new Error('Original message has no sender address');
  const subject = /^re:/i.test(original.subject || '')
    ? original.subject
    : `Re: ${original.subject || '(no subject)'}`;
  const references = [
    ...(original.references || []),
    ...(original.messageId ? [original.messageId] : []),
  ].join(' ');

  const info = await getSmtp().sendMail({
    from: `Household Calendar Support <${USER}>`,
    to: replyTo,
    subject,
    text,
    inReplyTo: original.messageId,
    references: references || undefined,
  });

  // Mirror what webmail does: file the reply in Sent, mark original answered.
  // Best-effort — the reply already left the building.
  await withImap(async (client) => {
    const raw = info.message || buildRawFallback({ to: replyTo, subject, text });
    await client.append('Sent', raw, ['\\Seen']).catch(() => {});
    const lock = await client.getMailboxLock(mailbox);
    try {
      await client.messageFlagsAdd(String(uid), ['\\Answered'], { uid: true });
    } finally {
      lock.release();
    }
  }).catch((err) => console.error('[supportMail] post-reply bookkeeping failed:', err.message));

  return { sent: true };
}

// Minimal RFC 5322 source if nodemailer didn't hand back the built message
// (it does for SMTP transports, so this is a belt-and-braces fallback).
function buildRawFallback({ to, subject, text }) {
  return [
    `From: Household Calendar Support <${USER}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset=utf-8',
    '',
    text,
  ].join('\r\n');
}

// Move a message between the browsable mailboxes (archive / restore to inbox).
async function move({ mailbox = 'INBOX', uid, destination = 'Archive' }) {
  if (!MAILBOXES.includes(destination)) throw new Error('Invalid destination mailbox');
  return withImap(async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      await client.messageMove(String(uid), destination, { uid: true });
      return { moved: true };
    } finally {
      lock.release();
    }
  });
}

// Flip the read flag from the list view without opening the message.
async function setSeen({ mailbox = 'INBOX', uid, seen }) {
  return withImap(async (client) => {
    const lock = await client.getMailboxLock(mailbox);
    try {
      if (seen) await client.messageFlagsAdd(String(uid), ['\\Seen'], { uid: true });
      else await client.messageFlagsRemove(String(uid), ['\\Seen'], { uid: true });
      return { seen: !!seen };
    } finally {
      lock.release();
    }
  });
}

module.exports = { isConfigured, MAILBOXES, status, listMessages, getMessage, reply, move, setSeen };
