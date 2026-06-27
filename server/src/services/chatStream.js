// Shared Server-Sent-Events runner for the AI chat assistants.
//
// Runs the same agentic tool loop the chat routes used before, but streams the
// result to the browser instead of buffering it. Events emitted:
//   event: text   data: { delta }      — incremental assistant text
//   event: tool   data: { name }       — a tool call started (for an activity hint)
//   event: done   data: { reply, followups, ...sideEffects }
//   event: error  data: { message }
//
// Side effects (e.g. navigateTo, tasksCreated) are collected via the caller's
// `collectSideEffects(block, result, acc)` callback, which may also mutate the
// tool result in place to strip private fields before it's sent back to the model.

const { generateFollowups } = require('./chatSuggestions');

async function streamChat(res, opts) {
  const {
    client,
    // Default to Sonnet 4.6 (paid-tier model). Free-tier callers pass the
    // cheaper Haiku model explicitly. The old Opus 4.8 default was the single
    // biggest cost driver and has been retired here.
    model = 'claude-sonnet-4-6',
    system,
    tools,
    messages,
    executeTool,
    collectSideEffects,
    maxTokens = 2048,
  } = opts;

  // Prompt caching: the system prompt + tool definitions are identical on every
  // turn, so cache them as one prefix (render order is tools → system, so a
  // breakpoint on the last system block caches both). Cache reads cost ~0.1×
  // input — this roughly halves the effective per-message cost of the agentic
  // loop. Converting the system string into a single cached text block is all
  // that's needed for the tools+system prefix.
  const cachedSystem =
    typeof system === 'string' && system.length
      ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
      : system;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable proxy buffering (nginx)
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const apiMessages = messages.map((m) => ({ role: m.role, content: m.content }));
  const sideEffects = {};
  let accumulated = '';

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const stream = client.messages.stream({
        model,
        max_tokens: maxTokens,
        system: cachedSystem,
        tools,
        messages: apiMessages,
      });
      stream.on('text', (delta) => {
        accumulated += delta;
        send('text', { delta });
      });

      const final = await stream.finalMessage();

      if (final.stop_reason === 'end_turn') break;

      if (final.stop_reason !== 'tool_use') {
        send('error', { message: `Unexpected stop reason: ${final.stop_reason}` });
        return res.end();
      }

      apiMessages.push({ role: 'assistant', content: final.content });

      const toolResults = [];
      for (const block of final.content) {
        if (block.type !== 'tool_use') continue;
        send('tool', { name: block.name });
        let result;
        try {
          result = await executeTool(block.name, block.input);
        } catch (err) {
          result = { error: err.message };
        }
        if (collectSideEffects) collectSideEffects(block, result, sideEffects);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: block.id,
          content: JSON.stringify(result),
        });
      }
      apiMessages.push({ role: 'user', content: toolResults });
    }

    const followups = await generateFollowups(client, apiMessages, accumulated);
    send('done', { reply: accumulated, followups, ...sideEffects });
    res.end();
  } catch (err) {
    console.error('streamChat error:', err);
    // If headers/body already started, surface the error over the stream.
    send('error', { message: err.message || 'Something went wrong' });
    res.end();
  }
}

module.exports = { streamChat };
