// The AI assistant's persona name, interpolated into the conversational
// system prompts (calendar/vacation/maintenance chat) and outbound phone-call
// prompts so the assistant self-identifies consistently across surfaces.
// Keep in sync with ASSISTANT_NAME in mobile/src/config.ts (UI labels).
// One-shot/plumbing prompts (booking extraction, manual parsing, form assist)
// intentionally stay unnamed — they aren't conversations.
const ASSISTANT_NAME = 'Calen';

module.exports = { ASSISTANT_NAME };
