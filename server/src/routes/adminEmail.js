// Admin email surfaces: the outbound no-reply@ send log (EmailLog rows written
// by services/mailer.js) and the support@ mailbox (live IMAP via
// services/supportMail.js — nothing mirrored into Mongo). requireAdmin-gated
// like the rest of the admin console.
//
//   GET  /api/admin/email/log                    → paginated outbound sends
//   GET  /api/admin/email/support/status         → configured? + per-mailbox unread
//   GET  /api/admin/email/support/messages       → paginated summaries (?mailbox=)
//   GET  /api/admin/email/support/messages/:uid  → full parsed message (marks read)
//   POST /api/admin/email/support/messages/:uid/reply   { text }
//   POST /api/admin/email/support/messages/:uid/move    { destination }
//   POST /api/admin/email/support/messages/:uid/seen    { seen }

const express = require('express');
const EmailLog = require('../models/EmailLog');
const supportMail = require('../services/supportMail');
const { requireAuth, requireAdmin } = require('../middleware/auth');
const { paginate } = require('./adminHelpers');

const router = express.Router();
router.use(requireAuth, requireAdmin);

// --- Outbound (no-reply@) log ------------------------------------------------

router.get('/log', async (req, res) => {
  try {
    const { status, kind, q } = req.query;
    const { page, pageSize, skip } = paginate(req.query, { defaultSize: 50, maxSize: 200 });
    const filter = {};
    if (status) filter.status = status;
    if (kind) filter.kind = kind;
    if (q) {
      const rx = new RegExp(String(q).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
      filter.$or = [{ to: rx }, { subject: rx }];
    }

    const [total, items] = await Promise.all([
      EmailLog.countDocuments(filter),
      EmailLog.find(filter).sort({ at: -1 }).skip(skip).limit(pageSize).lean(),
    ]);
    res.json({ items, total, page, pageSize });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Support mailbox ----------------------------------------------------------

// Every support route funnels through here so an unconfigured mailbox is a
// clean 503 the UI can explain, not a connection error.
function requireSupport(req, res, next) {
  if (!supportMail.isConfigured()) {
    return res.status(503).json({ error: 'Support mailbox is not configured (SUPPORT_EMAIL_USER/PASS)' });
  }
  next();
}

function validMailbox(value) {
  return supportMail.MAILBOXES.includes(value) ? value : 'INBOX';
}

router.get('/support/status', async (_req, res) => {
  if (!supportMail.isConfigured()) return res.json({ configured: false, boxes: [] });
  try {
    const s = await supportMail.status();
    res.json({ configured: true, ...s });
  } catch (err) {
    res.status(502).json({ error: `Support mailbox unreachable: ${err.message}` });
  }
});

router.get('/support/messages', requireSupport, async (req, res) => {
  try {
    const { page, pageSize } = paginate(req.query, { defaultSize: 25, maxSize: 100 });
    const data = await supportMail.listMessages({
      mailbox: validMailbox(req.query.mailbox), page, pageSize,
    });
    res.json(data);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.get('/support/messages/:uid', requireSupport, async (req, res) => {
  try {
    const uid = Number(req.params.uid);
    if (!Number.isInteger(uid) || uid < 1) return res.status(400).json({ error: 'Invalid uid' });
    const msg = await supportMail.getMessage({ mailbox: validMailbox(req.query.mailbox), uid });
    if (!msg) return res.status(404).json({ error: 'Message not found' });
    res.json(msg);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/support/messages/:uid/reply', requireSupport, async (req, res) => {
  try {
    const uid = Number(req.params.uid);
    if (!Number.isInteger(uid) || uid < 1) return res.status(400).json({ error: 'Invalid uid' });
    const text = String(req.body?.text || '').trim();
    if (!text) return res.status(400).json({ error: 'Reply text is required' });
    const result = await supportMail.reply({ mailbox: validMailbox(req.body?.mailbox), uid, text });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/support/messages/:uid/move', requireSupport, async (req, res) => {
  try {
    const uid = Number(req.params.uid);
    if (!Number.isInteger(uid) || uid < 1) return res.status(400).json({ error: 'Invalid uid' });
    const destination = req.body?.destination;
    if (!supportMail.MAILBOXES.includes(destination)) {
      return res.status(400).json({ error: 'Invalid destination mailbox' });
    }
    const result = await supportMail.move({ mailbox: validMailbox(req.body?.mailbox), uid, destination });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

router.post('/support/messages/:uid/seen', requireSupport, async (req, res) => {
  try {
    const uid = Number(req.params.uid);
    if (!Number.isInteger(uid) || uid < 1) return res.status(400).json({ error: 'Invalid uid' });
    const result = await supportMail.setSeen({
      mailbox: validMailbox(req.body?.mailbox), uid, seen: !!req.body?.seen,
    });
    res.json(result);
  } catch (err) {
    res.status(502).json({ error: err.message });
  }
});

module.exports = router;
