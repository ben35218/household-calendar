// Lightweight follow-up suggestion generator for the AI chat assistants.
// After the main (Opus) agentic turn finishes, we ask a cheap Haiku call to
// propose 2–3 short, tappable "what the user might say next" chips.

function parseStringArray(text) {
  try {
    const match = text.match(/\[[\s\S]*\]/);
    if (!match) return [];
    const arr = JSON.parse(match[0]);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((s) => typeof s === 'string' && s.trim())
      .map((s) => s.trim())
      .slice(0, 3);
  } catch {
    return [];
  }
}

// Flatten an API messages array (which may contain tool-use/tool-result blocks)
// into a short plain-text transcript of just the human-readable turns.
function transcriptFrom(apiMessages) {
  return apiMessages
    .map((m) => {
      let text = '';
      if (typeof m.content === 'string') {
        text = m.content;
      } else if (Array.isArray(m.content)) {
        text = m.content
          .filter((b) => b.type === 'text')
          .map((b) => b.text)
          .join(' ');
      }
      text = text.trim();
      if (!text) return null;
      return `${m.role}: ${text}`;
    })
    .filter(Boolean)
    .slice(-6)
    .join('\n');
}

/**
 * Generate up to 3 short follow-up suggestions phrased from the user's POV.
 * Returns [] on any failure — suggestions are a nice-to-have, never fatal.
 *
 * @param {Anthropic} client  an initialized Anthropic client
 * @param {Array} apiMessages the full conversation (text + tool blocks)
 * @param {string} lastReply  the assistant's latest text reply
 */
async function generateFollowups(client, apiMessages, lastReply) {
  if (!lastReply || !lastReply.trim()) return [];

  const transcript = transcriptFrom(apiMessages);
  const prompt = `You help a household-management assistant suggest what the user might tap next.

Given the conversation below, propose 2-3 natural next things THE USER might say or ask. Write them in first person from the user's perspective, as short tappable chips (max ~6 words each). Prefer concrete next actions (e.g. confirmations, refinements, follow-up questions) over generic chit-chat.

Respond with ONLY a JSON array of strings. No prose, no markdown.

Conversation:
${transcript}

Assistant's latest reply:
${lastReply}`;

  try {
    const resp = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = resp.content.find((b) => b.type === 'text')?.text || '';
    return parseStringArray(text);
  } catch {
    return [];
  }
}

module.exports = { generateFollowups };
