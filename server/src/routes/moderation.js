const express = require('express');
const { requireAuth } = require('../middleware/auth');
const { rateLimit } = require('../middleware/rateLimit');
const ContentReport = require('../models/ContentReport');
const mailer = require('../services/mailer');

// Report objectionable AI-generated content (Apple 1.2). Stores a durable,
// actionable report and pings the support inbox best-effort. Rate-limited so it
// can't be used to spam the inbox.
const router = express.Router();
router.use(requireAuth);

const reportLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 20, message: 'Too many reports. Please try again shortly.' });

const SUPPORT_INBOX = process.env.SUPPORT_EMAIL || process.env.SUPPORT_EMAIL_USER || 'support@householdcalendar.com';

router.post('/report', reportLimiter, async (req, res) => {
  try {
    const { content, reason, surface } = req.body || {};
    const report = await ContentReport.create({
      userId: req.user._id,
      householdId: req.user.householdId || null,
      surface: String(surface || 'assistant').slice(0, 40),
      content: String(content || '').slice(0, 4000),
      reason: String(reason || '').slice(0, 500),
    });

    mailer
      .sendMail({
        to: SUPPORT_INBOX,
        subject: `AI content reported (${report.surface})`,
        text:
          `A user reported AI-generated content.\n\n` +
          `Report ID: ${report._id}\nUser: ${req.user._id}\nSurface: ${report.surface}\n` +
          `Reason: ${report.reason || '(none given)'}\n\n--- Reported content ---\n${report.content}`,
        kind: 'other',
      })
      .catch(() => {});

    res.status(201).json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
