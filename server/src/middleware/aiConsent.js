// Server-side enforcement of the AI consent toggle (spec: features/ai-assistant.md).
//
// The mobile Privacy screen's `aiEnabled` pref hard-gates every AI surface in
// the app UI, and syncs to `User.aiEnabled` (routes/settings.js) so the server
// can refuse too — a client that bypasses the app cannot spend AI actions or
// ship content to Anthropic/Vapi on behalf of a user who turned AI off.
//
// Mount after requireAuth on every route that sends content to a model or
// places an AI phone call. Reads-only AI bookkeeping (call list, usage counters)
// is not gated.

const AI_DISABLED_MESSAGE = 'AI features are turned off for this account (Profile → Privacy & data).';

function requireAiEnabled(req, res, next) {
  if (req.user && req.user.aiEnabled === false) {
    return res.status(403).json({ error: AI_DISABLED_MESSAGE });
  }
  next();
}

module.exports = { requireAiEnabled, AI_DISABLED_MESSAGE };
