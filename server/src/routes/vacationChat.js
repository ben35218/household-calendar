const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const Trip = require('../models/Trip');
const TripItem = require('../models/TripItem');
const { requireAuth } = require('../middleware/auth');
const { streamChat } = require('../services/chatStream');
const { meter, getConfig } = require('../middleware/usageMeter');
const { ASSISTANT_NAME } = require('../config/assistant');

const router = express.Router();
router.use(requireAuth);

// A trip is accessible if it belongs to the user's household OR they're a collaborator.
function accessFilter(req) {
  return { $or: [{ userId: { $in: req.scopeIds } }, { collaborators: req.user._id }] };
}

const STATUS_LABEL = { considering: 'Considering', booked: 'Booked', completed: 'Past' };

const TOOLS = [
  {
    name: 'open_trip',
    description: 'Navigate the user to this trip\'s detail page (the hour-by-hour itinerary view).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
  {
    name: 'open_add_booking',
    description: 'Navigate the user to the "add a booking" form for this trip, so they can add a flight, hotel, activity, etc. (optionally using the auto-fill-from-confirmation feature there).',
    input_schema: { type: 'object', properties: {}, required: [] },
  },
];

function fmtDate(d) {
  return d ? new Date(d).toISOString().slice(0, 10) : null;
}

function tripDateSummary(t) {
  if (t.status === 'considering') {
    const ranges = (t.candidateRanges || []).map(r => {
      const label = r.label ? `${r.label}: ` : '';
      return `${label}${fmtDate(r.start)} – ${fmtDate(r.end)}`;
    });
    return ranges.length ? ranges.join('; ') : 'no candidate dates yet';
  }
  return t.startDate ? `${fmtDate(t.startDate)} – ${fmtDate(t.endDate || t.startDate)}` : 'no dates set';
}

// Load the trip the chat is scoped to, plus its itinerary items.
async function loadTrip(req, tripId) {
  const trip = await Trip.findOne({ _id: tripId, ...accessFilter(req) }).lean();
  if (!trip) return null;
  const items = await TripItem.find({ tripId: trip._id }).sort({ start: 1 }).lean();
  return { trip, items };
}

function buildItineraryText(items, tz) {
  if (!items.length) return 'No bookings have been added to this trip yet.';
  return items.map((it, i) => {
    const parts = [`${i + 1}. [${it.type}] ${it.title}`];
    if (it.start) parts.push(`   Start: ${new Date(it.start).toISOString()}`);
    if (it.end)   parts.push(`   End: ${new Date(it.end).toISOString()}`);
    if (it.location) parts.push(`   Location: ${it.location}`);
    if (it.address)  parts.push(`   Address: ${it.address}`);
    if (it.confirmation) parts.push(`   Confirmation: ${it.confirmation}`);
    if (it.cost != null) parts.push(`   Cost: ${it.cost}${it.currency ? ' ' + it.currency : ''}`);
    if (it.phone) parts.push(`   Phone: ${it.phone}`);
    if (it.url)   parts.push(`   URL: ${it.url}`);
    if (it.notes) parts.push(`   Notes: ${it.notes}`);
    if (it.details && Object.keys(it.details).length) {
      parts.push(`   Details: ${JSON.stringify(it.details)}`);
    }
    return parts.join('\n');
  }).join('\n') + `\n\n(Times are UTC instants representing the wall-clock time at the destination${tz ? `, timezone ${tz}` : ''}.)`;
}

function buildSystemPrompt(req, trip, items) {
  const today = new Date().toISOString();
  const userName = req.user.name || 'the user';
  const budgetLine = trip.budget != null ? `${trip.budget} ${trip.baseCurrency || 'CAD'}` : 'not set';

  return `You are ${ASSISTANT_NAME}, the friendly assistant in the Calen app, here helping plan a vacation. Today is ${today}. You are assisting ${userName}.
If asked who you are, say you're ${ASSISTANT_NAME} and that in this chat you can only see this one trip (each area of the app has its own ${ASSISTANT_NAME} chat with its own context).

You are focused on ONE specific trip (below). Answer questions about THIS trip only — its itinerary, schedule, costs, and what's left to plan. If the user asks about a different trip, tell them to open the assistant from that trip's page.

## Trip
- Name: ${trip.name}
- Destination: ${trip.destination || 'not set'}${trip.destinationTz ? ` (timezone ${trip.destinationTz})` : ''}
- Status: ${STATUS_LABEL[trip.status] || trip.status}
- Dates: ${tripDateSummary(trip)}
- Budget: ${budgetLine}
${trip.notes ? `- Notes: ${trip.notes}` : ''}

## Itinerary
${buildItineraryText(items, trip.destinationTz)}

When summarizing the itinerary, group by day and use the destination's local time. Be concise and concrete. Point out gaps (e.g. no lodging for a night, tight connections) and what's still unbooked.

You do NOT directly create or edit bookings. To add or change something, use open_add_booking (or open_trip) to take the user to the right screen, then tell them what to do there. The booking form also supports auto-filling from a confirmation email or PDF.`;
}

// ── Context + starter prompts (scoped to this trip) ──────────────────────────
function buildContextSummary(trip, items) {
  const count = items.length;
  return {
    sees: [
      `This trip — ${trip.name}${trip.destination ? ` (${trip.destination})` : ''}`,
      count
        ? `Its full itinerary (${count} booking${count === 1 ? '' : 's'}: flights, hotels, activities, costs)`
        : 'Its itinerary (no bookings added yet)',
      `Dates, budget & notes`,
    ],
    can: [
      'Summarize your itinerary and spending for this trip',
      'Spot gaps, conflicts, or what\'s left to book',
      'Open this trip or its booking form for you',
    ],
    note: 'I can open this trip and its forms — you make the edits.',
  };
}

function buildSuggestedPrompts(trip, items) {
  const prompts = [];
  if (items.length) {
    prompts.push("What's my itinerary?");
    prompts.push('Summarize the costs for this trip');
    prompts.push("What's left to book?");
  } else {
    prompts.push('What should I book for this trip?');
    prompts.push('Help me start planning');
  }
  if (trip.status === 'considering') prompts.push('Compare my date options');
  return prompts.slice(0, 4);
}

// GET = dual-write DB read; POST additionally accepts the client's decrypted
// `trip` + `items` (§9.1 P4 polish) so the summary stays accurate post-drop —
// access is still verified against the DB via plaintext metadata.
async function contextHandler(req, res) {
  try {
    const src = req.method === 'GET' ? req.query : (req.body || {});
    const { tripId } = src;
    if (!tripId) return res.status(400).json({ error: 'tripId is required' });

    let trip, items;
    if (src.trip && typeof src.trip === 'object' && Array.isArray(src.items)) {
      if (!(await Trip.exists({ _id: tripId, ...accessFilter(req) }))) {
        return res.status(404).json({ error: 'Trip not found' });
      }
      trip = src.trip;
      items = src.items;
    } else {
      const loaded = await loadTrip(req, tripId);
      if (!loaded) return res.status(404).json({ error: 'Trip not found' });
      ({ trip, items } = loaded);
    }

    res.json({
      context: buildContextSummary(trip, items),
      suggestedPrompts: buildSuggestedPrompts(trip, items),
    });
  } catch (err) {
    console.error('Vacation chat context error:', err);
    res.status(500).json({ error: err.message });
  }
}
router.get('/context', contextHandler);
router.post('/context', contextHandler);

router.post('/', meter('chat', 'vacation'), async (req, res) => {
  try {
    const { tripId, messages, trip: clientTrip, items: clientItems } = req.body;
    if (!tripId) return res.status(400).json({ error: 'tripId is required' });
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured' });

    // Ephemeral-consent (§9.1 P4a): when the client supplies the decrypted trip +
    // itinerary, use it for the prompt and skip the stored-plaintext read; verify
    // tripId access via plaintext metadata. Otherwise read the DB (dual-write).
    let trip, items;
    if (clientTrip && Array.isArray(clientItems)) {
      if (!(await Trip.exists({ _id: tripId, ...accessFilter(req) }))) {
        return res.status(404).json({ error: 'Trip not found' });
      }
      trip = clientTrip;
      items = clientItems;
    } else {
      const loaded = await loadTrip(req, tripId);
      if (!loaded) return res.status(404).json({ error: 'Trip not found' });
      trip = loaded.trip;
      items = loaded.items;
    }

    const systemPrompt = buildSystemPrompt(req, trip, items);
    const client = new Anthropic({ apiKey });

    const config = await getConfig();
    const plan = req.household?.plan || 'free';
    const model = plan === 'free' ? config.models.freeChat : config.models.paidChat;

    await streamChat(res, {
      req,
      client,
      model,
      system: systemPrompt,
      tools: TOOLS,
      messages,
      executeTool: (name) => {
        if (name === 'open_trip')        return { navigateTo: `/vacations/${tripId}` };
        if (name === 'open_add_booking') return { navigateTo: `/vacations/${tripId}/items/new` };
        return { error: `Unknown tool: ${name}` };
      },
      collectSideEffects: (block, result, acc) => {
        if (result && result.navigateTo) acc.navigateTo = result.navigateTo;
      },
    });
  } catch (err) {
    console.error('Vacation chat error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = router;
