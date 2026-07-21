// Navigable app views each Calen assistant can suggest as a one-tap shortcut.
//
// Model-driven: every mode's system prompt lists its destinations (id + when to
// offer it) and the model calls the `suggest_navigation` tool when a view is
// clearly relevant to the conversation. The tool doesn't navigate — it records a
// suggestion the client renders as a "navigate" chip (arrow icon). The mobile app
// maps each `id` to a screen in mobile/src/screens/chat/navDestinations.ts, so the
// ids here and there must stay in sync.

const SUGGEST_NAV_TOOL_NAME = 'suggest_navigation';

const NAV_DESTINATIONS = {
  calendar: [
    { id: 'view_calendar', label: 'View your calendar', when: 'the user just wants to look at their calendar / what is coming up' },
    { id: 'calendar_search', label: 'Search your calendar', when: 'the user is looking for a specific event or wants to find something on their calendar' },
    { id: 'manage_calendars', label: 'Manage calendars', when: 'the user wants to add, hide, subscribe to, or recolour a calendar' },
    { id: 'birthdays', label: 'View birthdays', when: 'the conversation is about birthdays' },
    { id: 'weather', label: 'Check the weather', when: 'the user asks about the weather or forecast to plan around it' },
  ],
  chores: [
    { id: 'chores_list', label: 'View all chores', when: 'the user wants to see, edit, or check off their existing chores' },
    { id: 'chore_templates', label: 'Browse chore templates', when: 'the user wants ready-made ideas for common chores' },
  ],
  maintenance: [
    { id: 'maintenance_home', label: 'View maintenance', when: 'the user wants to see the items and tasks they already track' },
    { id: 'task_templates', label: 'Browse task templates', when: 'the user wants common maintenance tasks to add' },
  ],
  trips: [
    { id: 'open_trip', label: 'Open this trip', when: 'the user wants to see the full trip page and its itinerary' },
    { id: 'add_booking', label: 'Add a booking', when: 'the user wants to add a flight, hotel, or activity to this trip' },
    { id: 'trips_list', label: 'View all trips', when: 'the user wants to see or switch between their trips' },
  ],
};

// The tool definition for a given surface — its `view` enum is that surface's ids.
function navTool(surface) {
  const dests = NAV_DESTINATIONS[surface] || [];
  return {
    name: SUGGEST_NAV_TOOL_NAME,
    description:
      'Offer the user a one-tap shortcut to a relevant screen in the app. Call this when opening a particular screen would help the user act on what you just discussed. The shortcut appears as a suggestion chip; it does NOT navigate on its own, so still answer normally. Only suggest a screen when it is clearly relevant — do not suggest one on every turn.',
    input_schema: {
      type: 'object',
      properties: {
        view: { type: 'string', enum: dests.map((d) => d.id), description: 'Which screen to offer a shortcut to.' },
      },
      required: ['view'],
    },
  };
}

// The fallback destination per surface — used to guarantee an actionable chip
// when the model didn't call suggest_navigation and nothing is pending review.
const DEFAULT_NAV = {
  calendar: 'view_calendar',
  chores: 'chores_list',
  maintenance: 'maintenance_home',
  trips: 'open_trip',
};

// A system-prompt section listing the surface's destinations and when to offer
// them. We want an actionable next step on EVERY turn, so the model is told to
// always offer the single most helpful screen (unless a review/save action is
// already the user's next step — see ensureActionableNav for the safety net).
function navPromptSection(surface) {
  const dests = NAV_DESTINATIONS[surface] || [];
  if (!dests.length) return '';
  const lines = dests.map((d) => `- ${d.id} ("${d.label}") — best when ${d.when}`).join('\n');
  return `\n## Offer a next step (every reply)\nEnd every reply by calling ${SUGGEST_NAV_TOOL_NAME} ONCE with the single screen that would most help the user act on what they're doing right now. Pick the most relevant one; never offer more than one. The ONLY exception: if you've just drafted something for the user to review and save (an event, chore, or task plan), that review action is their next step, so skip ${SUGGEST_NAV_TOOL_NAME} that turn.\nScreens:\n${lines}\n`;
}

// Record a suggest_navigation tool call as a client-facing side effect. Dedupes,
// preserving order, and ignores unknown view ids.
function collectNav(block, acc, surface) {
  if (!block || block.name !== SUGGEST_NAV_TOOL_NAME) return;
  const dest = (NAV_DESTINATIONS[surface] || []).find((d) => d.id === block.input?.view);
  if (!dest) return;
  acc.navSuggestions = acc.navSuggestions || [];
  if (!acc.navSuggestions.some((n) => n.view === dest.id)) {
    acc.navSuggestions.push({ view: dest.id, label: dest.label });
  }
}

// Safety net: guarantee at least one actionable (navigate) chip. Call from a
// route's followupsOverride (which runs after the tool loop, before the response
// is sent). Skips when `hasPending` — the pending review/save chip is already the
// actionable next step — or when the model already offered a screen.
function ensureActionableNav(acc, surface, hasPending) {
  if (hasPending) return;
  if (acc.navSuggestions && acc.navSuggestions.length) return;
  const dest = (NAV_DESTINATIONS[surface] || []).find((d) => d.id === DEFAULT_NAV[surface]);
  if (dest) acc.navSuggestions = [{ view: dest.id, label: dest.label }];
}

module.exports = {
  SUGGEST_NAV_TOOL_NAME,
  NAV_DESTINATIONS,
  navTool,
  navPromptSection,
  collectNav,
  ensureActionableNav,
};
