const User = require('../models/User');

// Shared phone + share-target helpers for the invitation flows (household, trip,
// calendar, event). Sharing addresses a recipient by EMAIL or PHONE. Phone is a
// loosely-normalized string (accounts are still keyed by email); it resolves to
// an account only when someone has saved that number in their Account, so a
// phone invite reaches an existing member's Invitations inbox and is otherwise
// claimed lazily when they sign up with a matching number.

// Loose normalization: keep a single leading + and the digits. Enough to dedupe
// and match reliably across formatting differences without a full E.164 parse.
// Returns null when the result isn't a plausible phone number. The mobile client
// mirrors this in mobile/src/lib/invitees.ts — keep them in sync.
function normalizePhone(raw) {
  const s = String(raw || '').trim();
  const digits = s.replace(/[^\d]/g, '');
  if (digits.length < 7 || digits.length > 15) return null;
  return (s.startsWith('+') ? '+' : '') + digits;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Resolve an invite address to { toEmail, toPhone, toUserId }. Exactly one of
// email/phone should be provided. `toUserId` is set when the address matches an
// existing account (by email, or by saved phone). Throws a plain string (the
// caller maps it to a 400) when the address is malformed.
async function resolveShareTarget({ email, phone } = {}) {
  if (phone !== undefined && phone !== null && phone !== '') {
    const toPhone = normalizePhone(phone);
    if (!toPhone) throw 'A valid phone number is required';
    const recipient = await User.findOne({ phone: toPhone }).select('_id householdId').lean();
    return { toEmail: null, toPhone, toUserId: recipient?._id || null, recipient };
  }
  const toEmail = String(email || '').trim().toLowerCase();
  if (!EMAIL_RE.test(toEmail)) throw 'Enter a valid email address';
  const recipient = await User.findOne({ email: toEmail }).select('_id householdId').lean();
  return { toEmail, toPhone: null, toUserId: recipient?._id || null, recipient };
}

module.exports = { normalizePhone, resolveShareTarget, EMAIL_RE };
