const express = require('express');
const Anthropic = require('@anthropic-ai/sdk');
const axios = require('axios');
const { format } = require('date-fns');
const CalendarEvent = require('../models/CalendarEvent');
const MaintenanceTask = require('../models/MaintenanceTask');
const Person = require('../models/Person');
const WeatherRecord = require('../models/WeatherRecord');
const { requireAuth } = require('../middleware/auth');
const { streamChat } = require('../services/chatStream');
const { meter, getConfig } = require('../middleware/usageMeter');
const { ASSISTANT_NAME } = require('../config/assistant');
const { collectCalendarRecords } = require('../services/calendarData');
const { assembleCalendarData } = require('@household/calendar');

const router = express.Router();
router.use(requireAuth);

// Normalize phone to E.164 (+1XXXXXXXXXX for US/CA numbers)
function normalizePhone(phone) {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (phone.startsWith('+')) return phone;
  return `+${digits}`;
}

const TOOLS = [
  {
    name: 'list_events',
    description: `List ALL calendar records in a date range, across every calendar shown on the user's calendar page. Recurring tasks, chores, and events are already expanded into their individual occurrences within the range, so each dated entry returned is a real occurrence (with a "recurrence" summary describing the repeat pattern). Returns:
- maintenance: home maintenance task occurrences
- chores: household chore occurrences
- activities / appointments: calendar events
- meals: planned recipes (meal calendar)
- groceryDays: grocery shopping days
- birthdays: birthday occurrences
- vacations: trips with their date range(s) and status (DATES ONLY — for the itinerary/details inside a trip, the user should use the Vacation Assistant on the Vacations page)`,
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date in ISO 8601 format' },
        to:   { type: 'string', description: 'End date in ISO 8601 format' },
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'open_create_event_form',
    description: 'Navigate the user to the event creation form, pre-filled with the provided details. The user reviews and saves the event themselves.',
    input_schema: {
      type: 'object',
      properties: {
        calendarType: { type: 'string', enum: ['activities', 'appointments'], description: 'Calendar type' },
        title:        { type: 'string', description: 'Event title' },
        description:  { type: 'string', description: 'Optional event description' },
        date:         { type: 'string', description: 'Event date in YYYY-MM-DD format' },
        endDate:      { type: 'string', description: 'Optional end date in YYYY-MM-DD format for multi-day events (different day than start)' },
        allDay:       { type: 'boolean', description: 'True for all-day events (default). Set to false when a specific start/end time is given.' },
        startTime:    { type: 'string', description: 'Start time in HH:MM 24-hour format, e.g. "14:00". Required when allDay is false.' },
        endTime:      { type: 'string', description: 'End time in HH:MM 24-hour format, e.g. "14:30". Required when allDay is false.' },
        recurrFreq:      { type: 'string', enum: ['daily', 'weekly', 'monthly', 'yearly'], description: 'Repeat frequency if the event recurs' },
        recurrInterval:  { type: 'number', description: 'For custom repeats like "every 2 weeks": recurrFreq is the unit (weekly) and this is N (2). Omit for simple repeats.' },
        reminderMinutes: { type: 'number', description: 'Alert before event: 0=at event time, 15, 30, 60, 120, 1440 (1 day), 2880 (2 days). Omit for no alert.' },
        phone:           { type: 'string', description: 'Business phone number (for appointments)' },
      },
      required: ['calendarType', 'title', 'date'],
    },
  },
  {
    name: 'open_edit_event_form',
    description: 'Navigate the user to the edit form for an existing event. The user reviews and saves changes themselves. Use list_events first to find the event ID.',
    input_schema: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'ID of the event to edit' },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'open_delete_event_form',
    description: 'Navigate the user to the event edit form so they can delete it using the Delete button. Use list_events first to find the event ID.',
    input_schema: {
      type: 'object',
      properties: {
        eventId: { type: 'string', description: 'ID of the event to delete' },
      },
      required: ['eventId'],
    },
  },
  {
    name: 'call_business',
    description: `Place an AI phone call to a business to cancel or reschedule an appointment.
The AI voice agent handles the full conversation including IVR menus, hold times, and live receptionists.
The call is asynchronous — use check_call_status to get the outcome once it completes (typically 2–5 minutes).
Requires a phone number on the event. If none is stored, ask the user to add one first.`,
    input_schema: {
      type: 'object',
      properties: {
        eventId: {
          type: 'string',
          description: 'ID of the appointment event to call about',
        },
        action: {
          type: 'string',
          enum: ['cancel', 'reschedule'],
          description: 'What to request from the business',
        },
        callerName: {
          type: 'string',
          description: 'Name to give the business when asked (e.g. "John Smith")',
        },
        newDateTime: {
          type: 'string',
          description: 'For reschedule: requested new date/time in plain English (e.g. "next Tuesday at 2pm")',
        },
        additionalInstructions: {
          type: 'string',
          description: 'Any extra context for the AI caller (e.g. "mention it is a follow-up visit")',
        },
      },
      required: ['eventId', 'action'],
    },
  },
  {
    name: 'check_call_status',
    description: 'Check the status and transcript of a call placed by call_business. Call IDs are returned by call_business.',
    input_schema: {
      type: 'object',
      properties: {
        callId: { type: 'string', description: 'The call_id returned by call_business' },
      },
      required: ['callId'],
    },
  },
  {
    name: 'get_weather_forecast',
    description: 'Get the stored weather forecast for a date range. Returns daily conditions including temperature, precipitation, wind, and whether it is a good weather day.',
    input_schema: {
      type: 'object',
      properties: {
        from: { type: 'string', description: 'Start date in YYYY-MM-DD format' },
        to:   { type: 'string', description: 'End date in YYYY-MM-DD format' },
      },
      required: ['from', 'to'],
    },
  },
];

// Human-readable summary of a maintenance task / chore recurrence rule.
function describeTaskRecurrence(r) {
  if (!r || r.type === 'one-time') return 'one-time';
  if (r.type === 'calendar') {
    const months = (r.months || []).join(', ');
    return `calendar (months ${months}, day ${r.dayOfMonth || 1})`;
  }
  if (r.type === 'interval') {
    return `every ${r.intervalValue || 1} ${r.intervalUnit || 'months'}`;
  }
  return 'recurring';
}

// Human-readable summary of a calendar-event recurrence rule.
function describeEventRecurrence(rec) {
  if (!rec || !rec.freq) return null;
  const every = rec.interval && rec.interval > 1 ? `every ${rec.interval} ` : '';
  const unit = { daily: 'day(s)', weekly: 'week(s)', monthly: 'month(s)', yearly: 'year(s)' }[rec.freq] || rec.freq;
  const until = rec.until ? `, until ${new Date(rec.until).toISOString().slice(0, 10)}` : '';
  return `${every}${unit}${until}`.trim();
}

async function executeTool(name, input, ctx) {
  const { userId, scopeIds, user, household } = ctx;
  switch (name) {
    case 'list_events': {
      const fromDate = new Date(input.from);
      const toDate   = new Date(input.to);

      // Ephemeral-consent (§9.1 P4c): when the client supplied its decrypted
      // calendar sources, expand them with the shared engine (same code the
      // server uses) instead of reading stored plaintext. Else read the DB.
      const data = ctx.calendarSources
        ? assembleCalendarData({
            ...ctx.calendarSources,
            fromDate, toDate,
            selfId: String(userId),
            groceryShoppingDay: (household || user)?.groceryShoppingDay ?? 6,
            groceryFrequency: (household || user)?.groceryFrequency ?? 'weekly',
            groceryAnchor: (household || user)?.groceryAnchor ?? null,
          })
        : await collectCalendarRecords({ scopeIds, fromDate, toDate, user, household });

      const eventFields = (e) => ({
        id: e._id,
        title: e.title,
        startDate: e.startDate,
        endDate: e.endDate,
        allDay: e.allDay,
        description: e.description,
        location: e.location,
        phone: e.phone,
        recurrence: describeEventRecurrence(e.recurrence),
      });

      return {
        maintenance: data.tasks.map(t => ({
          id: t._id, title: t.title, date: t.nextDueDate,
          item: t.itemId?.name, recurrence: describeTaskRecurrence(t.recurrence),
        })),
        chores: data.chores.map(c => ({
          id: c._id, title: c.title, date: c.nextDueDate,
          recurrence: describeTaskRecurrence(c.recurrence),
        })),
        activities: data.events.filter(e => e.calendarType === 'activities').map(eventFields),
        appointments: data.events.filter(e => e.calendarType === 'appointments').map(eventFields),
        meals: data.recipes.map(r => ({
          id: r._id, date: r.scheduledDate,
          title: r.recipeId?.title, servings: r.servings,
        })),
        groceryDays: data.groceryShopping.map(g => g.date),
        birthdays: data.birthdays.map(b => ({ name: b.name, relationship: b.relationship, date: b.date })),
        vacations: data.trips.map(t => ({
          name: t.name, destination: t.destination, status: t.status,
          ranges: t.ranges.map(r => ({
            start: new Date(r.start).toISOString().slice(0, 10),
            end: new Date(r.end).toISOString().slice(0, 10),
            label: r.label,
          })),
          note: 'Dates only — use the Vacation Assistant for this trip\'s itinerary and details.',
        })),
      };
    }

    case 'open_create_event_form': {
      const params = new URLSearchParams();
      if (input.title)                params.set('prefill_title', input.title);
      if (input.calendarType)         params.set('prefill_calendarType', input.calendarType);
      if (input.date)                 params.set('prefill_date', input.date);
      if (input.endDate)              params.set('prefill_endDate', input.endDate);
      if (input.allDay !== undefined)  params.set('prefill_allDay', String(input.allDay));
      if (input.startTime)            params.set('prefill_startTime', input.startTime);
      if (input.endTime)              params.set('prefill_endTime', input.endTime);
      if (input.recurrFreq)                params.set('prefill_recurrFreq', input.recurrFreq);
      if (input.recurrInterval)            params.set('prefill_recurrInterval', String(input.recurrInterval));
      if (input.reminderMinutes !== undefined) params.set('prefill_reminderMinutes', String(input.reminderMinutes));
      if (input.description)               params.set('prefill_description', input.description);
      if (input.phone)                params.set('prefill_phone', input.phone);
      return { navigateTo: `/calendar/event/new?${params.toString()}` };
    }

    case 'open_edit_event_form': {
      return { navigateTo: `/calendar/event/${input.eventId}/edit` };
    }

    case 'open_delete_event_form': {
      return { navigateTo: `/calendar/event/${input.eventId}/edit` };
    }

    case 'call_business': {
      const vapiKey = process.env.VAPI_API_KEY;
      const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
      if (!vapiKey)       return { error: 'VAPI_API_KEY is not configured on the server' };
      if (!phoneNumberId) return { error: 'VAPI_PHONE_NUMBER_ID is not configured on the server' };

      const event = ctx.calendarSources
        ? (ctx.calendarSources.events || []).find(e => String(e._id) === String(input.eventId))
        : await CalendarEvent.findOne({ _id: input.eventId, userId: { $in: scopeIds } }).lean();
      if (!event) return { error: 'Event not found' };
      if (!event.phone) {
        return { error: 'No phone number stored for this appointment. Please add the business phone number to the event first, then try again.' };
      }

      const dateLabel = format(new Date(event.startDate), 'MMMM d, yyyy');
      const nameClause = input.callerName ? ` for ${input.callerName}` : '';

      let systemPrompt, firstMessage;

      if (input.action === 'cancel') {
        firstMessage = `Hi, this is ${ASSISTANT_NAME}, an AI assistant calling to cancel an appointment${nameClause} — the ${event.title} scheduled for ${dateLabel}.`;
        systemPrompt =
          `You are ${ASSISTANT_NAME}, an AI assistant making a phone call on behalf of a household client${nameClause} to cancel an appointment. If asked who's calling, say you're ${ASSISTANT_NAME}, an AI assistant calling on the client's behalf.\n` +
          `Appointment: "${event.title}" on ${dateLabel}.\n` +
          `Goal: cancel this appointment and confirm the cancellation before ending the call.\n` +
          `If you reach voicemail, leave this message: "Hi, this is ${ASSISTANT_NAME}, an AI assistant calling to cancel the ${event.title} appointment scheduled for ${dateLabel}${nameClause}. Please confirm this cancellation. Thank you." Then hang up.\n` +
          `Be polite, patient, and professional. Navigate any IVR menus calmly.` +
          (input.additionalInstructions ? `\nAdditional context: ${input.additionalInstructions}` : '');
      } else {
        const newTime = input.newDateTime || 'the earliest available time';
        firstMessage = `Hi, this is ${ASSISTANT_NAME}, an AI assistant calling to reschedule an appointment${nameClause} — the ${event.title} that's currently scheduled for ${dateLabel}.`;
        systemPrompt =
          `You are ${ASSISTANT_NAME}, an AI assistant making a phone call on behalf of a household client${nameClause} to reschedule an appointment. If asked who's calling, say you're ${ASSISTANT_NAME}, an AI assistant calling on the client's behalf.\n` +
          `Current appointment: "${event.title}" on ${dateLabel}.\n` +
          `Requested new time: ${newTime}.\n` +
          `Goal: reschedule to the requested time (or nearest available) and confirm the new date and time before ending the call.\n` +
          `If you reach voicemail, ask them to call back to reschedule the ${event.title} appointment from ${dateLabel}.\n` +
          `Be polite, patient, and professional. Navigate any IVR menus calmly.` +
          (input.additionalInstructions ? `\nAdditional context: ${input.additionalInstructions}` : '');
      }

      const phone = normalizePhone(event.phone);
      const { data } = await axios.post(
        'https://api.vapi.ai/call/phone',
        {
          phoneNumberId,
          customer: { number: phone },
          assistant: {
            firstMessage,
            model: {
              provider: 'anthropic',
              model: 'claude-haiku-4-5-20251001',
              messages: [{ role: 'system', content: systemPrompt }],
            },
            voice: {
              provider: '11labs',
              voiceId: '9BWtsMINqrJLrRacOk9x', // Aria — natural, clear voice
            },
            endCallPhrases: ['goodbye', 'bye', 'have a great day', 'take care', 'thank you so much'],
            recordingEnabled: true,
          },
        },
        { headers: { Authorization: `Bearer ${vapiKey}` } },
      );

      return {
        success: true,
        callId: data.id,
        phone,
        message: `Call queued to ${phone}. The AI voice agent will handle the conversation. Use check_call_status with callId "${data.id}" to get the outcome (usually ready in 2–5 minutes).`,
      };
    }

    case 'check_call_status': {
      const vapiKey = process.env.VAPI_API_KEY;
      if (!vapiKey) return { error: 'VAPI_API_KEY is not configured on the server' };

      const { data } = await axios.get(
        `https://api.vapi.ai/call/${input.callId}`,
        { headers: { Authorization: `Bearer ${vapiKey}` } },
      );

      return {
        status: data.status,
        endedReason: data.endedReason ?? null,
        durationSeconds: data.callLength ?? null,
        summary: data.summary ?? null,
        transcript: data.transcript ?? null,
      };
    }

    case 'get_weather_forecast': {
      // Ephemeral-consent (§9.1 P5): when the client supplied its forecast (it
      // fetched it from open-meteo over the decrypted location), filter that
      // instead of the server WeatherRecord cache. Already in the right shape.
      if (ctx.weather && Array.isArray(ctx.weather.forecast)) {
        const days = ctx.weather.forecast.filter(d =>
          (!input.from || d.date >= input.from) && (!input.to || d.date <= input.to));
        return days.length ? { forecast: days } : { message: 'No weather data for that range.' };
      }

      const records = await WeatherRecord.find({
        userId,
        date: { $gte: input.from, $lte: input.to },
      }).sort({ date: 1 }).lean();

      if (!records.length) {
        return { message: 'No weather data stored for this range. The forecast is populated when the weather widget loads.' };
      }

      return {
        forecast: records.map(r => ({
          date:              r.date,
          description:       r.description,
          tempMax:           r.tempMax,
          tempMin:           r.tempMin,
          precipSum:         r.precipSum,
          precipProbability: r.precipProbability,
          windMax:           r.windMax,
          goodWeather:       r.goodWeather,
          hours:             r.hours ?? [],
        })),
      };
    }

    default:
      return { error: `Unknown tool: ${name}` };
  }
}

function computeAge(birthday) {
  const today = new Date();
  const bday = new Date(birthday);
  let age = today.getFullYear() - bday.getFullYear();
  const m = today.getMonth() - bday.getMonth();
  if (m < 0 || (m === 0 && today.getDate() < bday.getDate())) age--;
  return age;
}

// Load the household's people (family + friends, incl. the self "You" record).
async function loadPeople(req) {
  await Person.ensureSelf(req.user);
  return Person.find({ userId: { $in: req.scopeIds } }).sort({ type: 1, name: 1 }).lean();
}

function buildSystemPrompt(req, people) {
  const today = new Date().toISOString();
  const userName = req.user.name || 'the user';
  const selfId = String(req.user._id);

  function buildPeopleSection(list) {
    if (!list.length) return 'None added yet.';
    return list.map(p => {
      const isYou = String(p.accountId) === selfId;
      const parts = [isYou ? `${p.name} (you)` : p.name];
      if (p.relationship) parts.push(`(${p.relationship})`);
      if (p.birthday) {
        const age = computeAge(p.birthday);
        parts.push(`Age: ${age} (Birthday: ${format(new Date(p.birthday), 'MMMM d')})`);
      }
      if (p.address)      parts.push(`Address: ${p.address}`);
      if (p.interests?.length) parts.push(`Interests: ${p.interests.join(', ')}`);
      if (p.notes) parts.push(`Notes: ${p.notes}`);
      return parts.join(' — ');
    }).join('\n');
  }

  const familySection = buildPeopleSection(people.filter(p => p.type === 'family'));
  const friendsSection = buildPeopleSection(people.filter(p => p.type === 'friend'));

  return `You are ${ASSISTANT_NAME}, the friendly assistant in the Calen app, managing a family's home calendar. Today is ${today}. You are assisting ${userName}.
If asked who you are, say you're ${ASSISTANT_NAME} and that in this chat you can see the household calendar and household members (each area of the app has its own ${ASSISTANT_NAME} chat with its own context — this one doesn't see trips, maintenance items, or recipes).

## Household Members
${familySection}

## Friends
${friendsSection}

Use the above information when:
- Suggesting family activities or outings (consider everyone's interests and any notes)
- Recommending who to get together with this week or upcoming weeks based on the calendar
- Deciding whose name to give when calling a business (default to ${userName})

You have access to stored weather forecast data via get_weather_forecast. Use it when the user asks about the weather, wants to plan outdoor activities, or when suggesting good days for outdoor events.

Use list_events to see what's scheduled. It returns EVERY calendar shown on the user's calendar page, and recurring items are already expanded into their individual occurrences in the requested range (each carries a "recurrence" summary of its repeat pattern, so you understand the cadence). The calendars are:
- Maintenance: Home maintenance task occurrences (read-only — managed separately)
- Chores: Household chore occurrences (read-only — managed separately)
- Activities: Family activities, events, outings, social plans (editable events)
- Appointments: Doctor visits, meetings, service appointments (editable events)
- Meals: Planned recipes from the meal calendar (read-only here)
- Grocery days: Scheduled grocery shopping days (read-only)
- Birthdays: Household & friends' birthday occurrences (read-only)
- Vacations: Trips with their date range(s) and status — DATES ONLY. You can see WHEN trips are, but not the bookings/itinerary inside them. If the user asks about what's planned within a trip (flights, hotels, activities, costs), tell them to open the Vacation Assistant from the Vacations page, which has the full itinerary.

You can only create, edit, or delete Activities and Appointments (calendar events). Maintenance, chores, meals, grocery days, birthdays, and vacations are managed elsewhere — surface them for planning, but don't try to modify them.

You do NOT directly create, edit, or delete events. Instead, you open the appropriate form pre-filled with details and let the user review and confirm the action.
- To add an event: call open_create_event_form with the details the user provided. Then briefly recap the event's details and tell the user they can tap "Save this to my calendar" to add it, or "Edit in form" to review and adjust it first. Do NOT say you've already opened a form or already saved the event — nothing is saved until the user taps one of those.
- To edit/update an event: call list_events to find the event ID, then call open_edit_event_form. In your reply, tell the user what to change in the form.
- To delete an event: call list_events to find the event ID, then call open_delete_event_form. Tell the user to click the Delete button in the form.

You can also place AI phone calls (via Vapi) to businesses to cancel or reschedule appointments using call_business. Before calling:
1. Confirm the appointment has a phone number stored (list_events to check). If not, ask the user to add one.
2. Use ${userName} as the caller name unless the user specifies otherwise.
3. For reschedules, confirm the desired new date/time before calling.
After placing a call, tell the user it's in progress and offer to check the status with check_call_status.

Always confirm what you've done. Ask for clarification when dates, names, or intentions are ambiguous.`;
}

// Birthdays (people + the user's own) falling within the next `days` days.
function upcomingBirthdays(people, days = 30) {
  const now = new Date();
  const horizon = new Date();
  horizon.setDate(horizon.getDate() + days);
  const out = [];
  for (const p of people) {
    if (!p.birthday) continue;
    const b = new Date(p.birthday);
    const occ = new Date(now.getFullYear(), b.getMonth(), b.getDate());
    if (occ < now) occ.setFullYear(now.getFullYear() + 1);
    if (occ <= horizon) out.push({ name: p.name, date: occ });
  }
  return out.sort((a, b) => a.date - b.date);
}

function buildContextSummary(people, includePersonalInfo = true) {
  const count = people.length;
  const sees = [
    'Every calendar — activities, appointments, maintenance, chores, meals & grocery days',
    'Recurring items expanded into each occurrence',
    'Vacation dates (the itinerary lives in the Vacation Assistant)',
  ];
  // Only advertise access to household details when the privacy toggle allows it —
  // otherwise the panel would claim to "see" people the prompt never receives.
  if (includePersonalInfo) {
    sees.push(
      count
        ? `Your household & friends (${count} ${count === 1 ? 'person' : 'people'}, with birthdays & interests)`
        : 'Your household members & friends',
    );
  }
  sees.push('The weather forecast');

  return {
    sees,
    can: [
      'Open pre-filled event forms for you to review & save',
      'Place AI phone calls to cancel or reschedule appointments',
      'Suggest activities and good-weather days',
    ],
    note: includePersonalInfo
      ? 'Nothing is saved or called without your confirmation.'
      : 'Personal & contact info is turned off in Privacy, so I won’t use your household details. Nothing is saved or called without your confirmation.',
  };
}

function buildSuggestedPrompts(people) {
  const prompts = ["What's on my calendar this week?"];
  const bdays = upcomingBirthdays(people);
  if (bdays.length) {
    prompts.push(`${bdays[0].name}'s birthday is coming up — plan something?`);
  }
  prompts.push('Suggest a family activity this weekend');
  prompts.push('Find a good-weather day for an outdoor outing');
  return prompts.slice(0, 4);
}

// Context + starter prompts shown when the assistant first opens.
// GET = dual-write DB read; POST additionally accepts the client's decrypted
// `people` (§9.1 P4 polish) so the "what I can see" panel and starter prompts
// stay accurate after the plaintext drop, when loadPeople returns sealed rows.
async function contextHandler(req, res) {
  try {
    const src = req.method === 'GET' ? req.query : (req.body || {});
    // Privacy toggle: when off, don't load household contacts, so the panel and
    // starter prompts don't surface people the assistant can't use.
    const includePersonalInfo = String(src.includePersonalInfo) !== 'false' && src.includePersonalInfo !== false;
    const people = includePersonalInfo
      ? (Array.isArray(src.people) ? src.people : await loadPeople(req))
      : [];
    res.json({
      context: buildContextSummary(people, includePersonalInfo),
      suggestedPrompts: buildSuggestedPrompts(people),
    });
  } catch (err) {
    console.error('Calendar chat context error:', err);
    res.status(500).json({ error: err.message });
  }
}
router.get('/context', contextHandler);
router.post('/context', contextHandler);

router.post('/', meter('chat', 'calendar'), async (req, res) => {
  try {
    const { messages, people: clientPeople, calendarSources, weather, includePersonalInfo = true } = req.body;
    if (!Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages array is required' });
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not configured' });

    const userId = req.user._id;
    // Ephemeral-consent (§9.1 P4c): the client supplies decrypted people (system
    // prompt) and calendar sources (list_events / call_business, expanded by the
    // shared engine) so the server needn't read stored plaintext. Dual-write: with
    // neither present it reads the DB exactly as before.
    //
    // Privacy toggle ("Use personal & contact info in prompts"): when the client
    // sends includePersonalInfo:false, withhold the household contact list from the
    // prompt entirely — including the DB fallback — so no names/addresses/birthdays
    // reach the model. The assistant still works on the calendar itself.
    const people = includePersonalInfo
      ? (Array.isArray(clientPeople) ? clientPeople : await loadPeople(req))
      : [];
    const systemPrompt = buildSystemPrompt(req, people);
    const client = new Anthropic({ apiKey });

    // Free tier gets the fast Haiku model; paid tiers get the smarter Sonnet.
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
      executeTool: (name, input) => executeTool(name, input, {
        userId, scopeIds: req.scopeIds, user: req.user, household: req.household,
        calendarSources: (calendarSources && typeof calendarSources === 'object') ? calendarSources : null,
        weather: (weather && typeof weather === 'object') ? weather : null,
      }),
      collectSideEffects: (block, result, acc) => {
        if (result && result.navigateTo) acc.navigateTo = result.navigateTo;
        // When the assistant drafts a new event, surface the structured fields so
        // the client can offer "Save this to my calendar" (create it directly) or
        // "Edit in form" (open the create form pre-filled). Keep the last one.
        if (block.name === 'open_create_event_form') acc.pendingEvent = block.input;
      },
      // After drafting an event, the only two sensible next actions are to save it
      // or tweak it in the form — pin those instead of generated free-text chips.
      followupsOverride: (acc) =>
        acc.pendingEvent ? ['Save this to my calendar', 'Edit in form'] : null,
    });
  } catch (err) {
    console.error('Calendar chat error:', err);
    if (!res.headersSent) res.status(500).json({ error: err.message });
  }
});

module.exports = router;
