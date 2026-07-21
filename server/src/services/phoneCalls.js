const axios = require('axios');
const { format } = require('date-fns');
const mongoose = require('mongoose');
const PhoneCall = require('../models/PhoneCall');
const { ASSISTANT_NAME } = require('../config/assistant');
const { scopeClause } = require('./scope');
const { recordCallSecondsById } = require('../middleware/usageMeter');

// Outbound AI phone calls (Vapi) for the calendar assistant: placement (shared
// by the chat's call_business tool and the event view's "Call to Cancel" card)
// and outcome capture. There is no Vapi webhook — pending rows are refreshed
// lazily whenever they're read (the chat's check_call_status tool, or GET
// /api/calls which the mobile app polls for the badge), which lands the result
// within one poll cycle of the call ending.

// Normalize phone to E.164 (+1XXXXXXXXXX for US/CA numbers).
function toE164(phone) {
  const digits = String(phone).replace(/\D/g, '');
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith('1')) return `+${digits}`;
  if (String(phone).startsWith('+')) return phone;
  return `+${digits}`;
}

/**
 * Place a cancel/reschedule call and record it. The event is a plaintext
 * snapshot (client-decrypted on E2EE households): { _id, title, startDate, phone }.
 * `contact` optionally carries the client's own details (name/phone/email) so
 * the agent can answer identity-verification questions.
 * Throws on Vapi/config errors; the caller maps them to tool/HTTP responses.
 */
async function placeCall({ userId, householdId, event, action, callerName, newDateTime, additionalInstructions, contact }) {
  const vapiKey = process.env.VAPI_API_KEY;
  const phoneNumberId = process.env.VAPI_PHONE_NUMBER_ID;
  if (!vapiKey) throw new Error('VAPI_API_KEY is not configured on the server');
  if (!phoneNumberId) throw new Error('VAPI_PHONE_NUMBER_ID is not configured on the server');

  const dateLabel = format(new Date(event.startDate), 'MMMM d, yyyy');
  const nameClause = callerName ? ` for ${callerName}` : '';

  // Phone etiquette: the assistant does NOT open with its pitch. It waits for
  // the recipient to answer (firstMessageMode below), and only once it hears
  // them does it introduce itself and the reason for calling.
  const waitEtiquette =
    `The call has just connected but the other party may not have spoken yet. Do NOT state the reason for the call until you have heard them speak (a greeting, a voicemail message, anything). Once they respond, open with: `;

  const conduct =
    `Be polite, patient, and professional. Navigate any IVR menus calmly. Keep each reply to one or two short sentences and answer promptly — this is a live phone conversation.\n` +
    `If the person asks you to wait, hold, or give them a moment, acknowledge once briefly and then wait in silence — never prompt or hurry them.`;

  // The client's own details, offered only on request (identity verification —
  // businesses often ask for the phone number or name on file). Per-call
  // opt-in (spec ai-assistant.md): without consent the caller has only the
  // name and must say so rather than guess.
  const contactSection = contact
    ? `\nThe client's details, to share if the business asks to verify the appointment:` +
      (contact.name ? `\n- Name: ${contact.name}` : '') +
      (contact.phone ? `\n- Phone on file: ${contact.phone}` : '') +
      (contact.email ? `\n- Email on file: ${contact.email}` : '') +
      `\nOnly share these when asked — don't volunteer them.`
    : `\nYou have the client's name only — no phone number or email. If the business asks to verify by phone or email, say you don't have that on hand, and if they can't proceed without it, say you'll check with the client and they will call back. Never guess or invent contact details.`;

  let systemPrompt;
  if (action === 'cancel') {
    const intro = `"Hi, this is ${ASSISTANT_NAME}, an AI assistant calling to cancel an appointment${nameClause} — the ${event.title} scheduled for ${dateLabel}."`;
    systemPrompt =
      `You are ${ASSISTANT_NAME}, an AI assistant making a phone call on behalf of a household client${nameClause} to cancel an appointment. If asked who's calling, say you're ${ASSISTANT_NAME}, an AI assistant calling on the client's behalf.\n` +
      waitEtiquette + intro + `\n` +
      `Appointment: "${event.title}" on ${dateLabel}.\n` +
      `Goal: cancel this appointment and get the business to explicitly confirm the cancellation before ending the call.\n` +
      `If you reach voicemail, wait for the beep, then leave this message: "Hi, this is ${ASSISTANT_NAME}, an AI assistant calling to cancel the ${event.title} appointment scheduled for ${dateLabel}${nameClause}. Please confirm this cancellation. Thank you." Then hang up.\n` +
      conduct + contactSection +
      (additionalInstructions ? `\nAdditional context: ${additionalInstructions}` : '');
  } else {
    const newTime = newDateTime || 'the earliest available time';
    const intro = `"Hi, this is ${ASSISTANT_NAME}, an AI assistant calling to reschedule an appointment${nameClause} — the ${event.title} that's currently scheduled for ${dateLabel}."`;
    systemPrompt =
      `You are ${ASSISTANT_NAME}, an AI assistant making a phone call on behalf of a household client${nameClause} to reschedule an appointment. If asked who's calling, say you're ${ASSISTANT_NAME}, an AI assistant calling on the client's behalf.\n` +
      waitEtiquette + intro + `\n` +
      `Current appointment: "${event.title}" on ${dateLabel}.\n` +
      `Requested new time: ${newTime}.\n` +
      `Goal: reschedule to the requested time (or nearest available) and confirm the new date and time before ending the call.\n` +
      `If you reach voicemail, ask them to call back to reschedule the ${event.title} appointment from ${dateLabel}.\n` +
      conduct + contactSection +
      (additionalInstructions ? `\nAdditional context: ${additionalInstructions}` : '');
  }

  const phone = toE164(event.phone);
  const { data } = await axios.post(
    'https://api.vapi.ai/call/phone',
    {
      phoneNumberId,
      customer: { number: phone },
      assistant: {
        // Wait for the recipient to answer before speaking at all; the intro
        // (and reason for calling) lives in the system prompt and is only
        // delivered once they've said something.
        firstMessageMode: 'assistant-waits-for-user',
        // If the line connects but no audio is detected, prompt with a plain
        // "Hello?" — still without the pitch. Once per call, ever: with
        // onUserSpeech reset it re-fired during natural mid-call pauses
        // ("give me a sec" → "Hello?"), which live-tested badly.
        hooks: [
          {
            on: 'customer.speech.timeout',
            options: { timeoutSeconds: 3, triggerMaxCount: 1, triggerResetMode: 'never' },
            do: [{ type: 'say', exact: 'Hello?' }],
          },
        ],
        model: {
          provider: 'anthropic',
          model: 'claude-haiku-4-5-20251001',
          messages: [{ role: 'system', content: systemPrompt }],
        },
        voice: {
          provider: 'cartesia',
          voiceId: '4bc3cb8c-adb9-4bb8-b5d5-cbbef950b991', // George — steady British male
          // sonic-3 is Cartesia's low-latency model and the only one that takes
          // generationConfig; ElevenLabs has no volume control at all, which is
          // why the provider was switched.
          model: 'sonic-3',
          generationConfig: { volume: 1.3 }, // a touch louder than default 1.0
        },
        // Vapi phone calls default to an "office" ambience track — silence it.
        backgroundSound: 'off',
        // Start replying a beat sooner after the other party stops talking
        // (default 0.4s felt sluggish in testing; 0.2s still felt slow). The
        // endpointing plan is the bigger lever: by default Vapi waits 1.5s when
        // the transcript ends without punctuation — common on short utterances
        // — before even querying the model. onNumberSeconds is left at its
        // default so spoken dates/times don't get clipped.
        startSpeakingPlan: {
          waitSeconds: 0,
          transcriptionEndpointingPlan: {
            onPunctuationSeconds: 0.1,
            onNoPunctuationSeconds: 0.9,
          },
        },
        // Post-call, Vapi's analysis judges whether the goal stated in the
        // system prompt was achieved; a pass on a cancel call is what marks the
        // event cancelled (applyVapiToRow).
        //
        // The summary is the ONLY surviving record of the call (no transcript,
        // no recording) and it's stored plaintext + shown to the household +
        // fed back to the chat model — so its prompt is constrained to outcome
        // facts and explicitly barred from repeating identity details spoken by
        // either party (spec: ai-assistant.md "PII-constrained summary").
        analysisPlan: {
          summaryPlan: {
            messages: [
              {
                role: 'system',
                content:
                  'Summarize the outcome of this phone call in 1-3 short sentences for the client who requested it.\n' +
                  'State ONLY outcome facts: whether the cancellation or reschedule was confirmed; the agreed new date and time (for a reschedule); any fee amount mentioned; whether the call reached voicemail or no one; and anything the client still needs to do.\n' +
                  'NEVER include identity details, even if they were spoken on the call: no names of people on either side, no phone numbers, no email or street addresses, no birthdates, and no account, reference, or confirmation numbers. Refer to the parties only as "the business" and "the client", and to the appointment as "the appointment".',
              },
              {
                role: 'user',
                content: 'Here is the transcript:\n\n{{transcript}}\n\nHere is the ended reason of the call:\n\n{{endedReason}}',
              },
            ],
          },
          successEvaluationPlan: { rubric: 'PassFail' },
        },
        endCallPhrases: ['goodbye', 'bye', 'have a great day', 'take care', 'thank you so much'],
        // Nothing retained at Vapi (spec: ai-assistant.md): no audio recording
        // AND no stored transcript. Live transcription still runs (the agent
        // needs it to converse) and the post-call analysis (summary +
        // success evaluation above) still lands — only the artifacts are
        // discarded. The app shows the outcome summary; there is no transcript
        // anywhere to fetch.
        artifactPlan: {
          recordingEnabled: false,
          videoRecordingEnabled: false,
          transcriptPlan: { enabled: false },
        },
      },
    },
    { headers: { Authorization: `Bearer ${vapiKey}` } },
  );

  const row = await PhoneCall.create({
    userId,
    householdId,
    callId: data.id,
    eventId: String(event._id),
    eventTitle: event.title,
    eventDate: dateLabel,
    action,
    phone,
    status: data.status || 'queued',
  });

  return row;
}

async function fetchVapiCall(callId) {
  const vapiKey = process.env.VAPI_API_KEY;
  if (!vapiKey) throw new Error('VAPI_API_KEY is not configured on the server');
  const { data } = await axios.get(`https://api.vapi.ai/call/${callId}`, {
    headers: { Authorization: `Bearer ${vapiKey}` },
  });
  return data;
}

// Vapi's analysis (summary + success evaluation) can lag the `ended` status by
// a few seconds, so an ended call without a summary yet is refreshed again on
// the next read.
function hasFinalResult(row) {
  if (!PhoneCall.isTerminal(row.status)) return false;
  return row.status !== 'ended' || Boolean(row.summary);
}

// The PassFail success evaluation arrives as the string 'true'/'false'.
function outcomeFrom(data) {
  const s = data.analysis?.successEvaluation ?? data.successEvaluation;
  if (s === 'true' || s === true) return 'confirmed';
  if (s === 'false' || s === false) return 'unconfirmed';
  return undefined;
}

// Meter a finished call's connected seconds against the weekly call-time budget,
// once. Bumps the shared household pool (paid enforcement + fleet analytics) and
// the per-user counter (free enforcement) by the call's duration. Marks the row
// `metered` as soon as the call has its final result — even if the duration is 0
// (never connected) — so lazy refreshes don't re-check it forever. Returns true
// if it wrote to the row.
function meterCallSecondsUsage(row) {
  if (row.metered || !hasFinalResult(row)) return false;
  recordCallSecondsById(
    { householdId: row.householdId, userId: row.userId },
    row.durationSeconds || 0,
  );
  row.metered = true;
  return true;
}

// Copy a Vapi call payload onto a PhoneCall row and save when anything changed.
// A cancel call whose evaluation passed marks the calendar event cancelled —
// that flag is what flips the event view's card and files the Invitations
// notification.
async function applyVapiToRow(row, data) {
  const next = {
    status: data.status || row.status,
    endedReason: data.endedReason ?? row.endedReason,
    summary: data.summary ?? data.analysis?.summary ?? row.summary,
    durationSeconds: data.callLength ?? row.durationSeconds,
    outcome: outcomeFrom(data) ?? row.outcome,
  };
  const changed = Object.keys(next).some((k) => next[k] !== row[k]);
  if (changed) Object.assign(row, next);
  // Meter the call's connected seconds once its result is final (after `next` is
  // applied so `hasFinalResult` and `durationSeconds` reflect the fresh payload).
  const metered = meterCallSecondsUsage(row);
  if (changed || metered) {
    await row.save();
    await markEventCancelledIfConfirmed(row);
  }
  return row;
}

// A confirmed cancel marks the event `cancelled`. Signal-parity C3b: `cancelled`
// is a SEALED event field now (inside the opaque record), so the server can no
// longer flip it — it CAN'T read or write event content. The signal lives on the
// PhoneCall row itself (`action:'cancel'` + `outcome:'confirmed'` + the real
// `eventId`); the client, polling the calls list, re-seals the event with
// `cancelled:true` through /records when it sees a confirmed cancel it hasn't
// applied yet. This server function is therefore a no-op, kept so the G1 alias
// link-back (PATCH /calls/:id/link) and the outcome flow still call it harmlessly.
async function markEventCancelledIfConfirmed(_row) {
  // Intentionally empty — see the comment above (client applies the sealed flag).
}

// Refresh every call in scope that doesn't have its final result yet. Failures
// are per-call and non-fatal — a Vapi hiccup shouldn't break the list read.
async function refreshPendingCalls(scopeIds) {
  const pending = await PhoneCall.find({ userId: { $in: scopeIds } })
    .sort({ createdAt: -1 })
    .limit(20);
  await Promise.all(
    pending.filter((row) => !hasFinalResult(row)).map(async (row) => {
      try {
        await applyVapiToRow(row, await fetchVapiCall(row.callId));
      } catch (e) {
        console.error(`PhoneCall refresh failed for ${row.callId}:`, e.message);
      }
    }),
  );
}

module.exports = { placeCall, toE164, fetchVapiCall, applyVapiToRow, refreshPendingCalls, hasFinalResult, outcomeFrom, meterCallSecondsUsage, markEventCancelledIfConfirmed };
