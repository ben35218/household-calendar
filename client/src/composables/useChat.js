import { ref, nextTick } from 'vue';

// Shared chat state + transport for the AI assistants. Talks to the SSE
// streaming endpoints and exposes everything the ChatPanel component renders.
//
// Options:
//   endpoint        POST SSE endpoint, e.g. '/api/calendar/chat'
//   contextEndpoint GET endpoint for context + starter prompts (optional)
//   storageKey      localStorage key for history persistence (optional)
//   buildBody       (messages) => request body object
//   onResult        (doneData) => void — handle side effects (navigateTo, …)
//   toolLabels      map of tool name -> friendly "activity" label

const HISTORY_TTL = 24 * 60 * 60 * 1000;

function authHeaders() {
  const token = localStorage.getItem('hc_token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

function parseFrame(frame) {
  let event = null;
  const dataLines = [];
  for (const line of frame.split('\n')) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  let data = {};
  if (dataLines.length) {
    try { data = JSON.parse(dataLines.join('\n')); } catch { /* ignore */ }
  }
  return { event, data };
}

export function useChat(options) {
  const {
    endpoint,
    contextEndpoint = null,
    storageKey = null,
    buildBody,
    onResult = null,
    toolLabels = {},
  } = options;

  function loadHistory() {
    if (!storageKey) return [];
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return [];
      const { messages, savedAt } = JSON.parse(raw);
      if (Date.now() - savedAt > HISTORY_TTL) return [];
      return Array.isArray(messages) ? messages : [];
    } catch { return []; }
  }

  const messages         = ref(loadHistory());
  const input            = ref('');
  const loading          = ref(false);
  const streamingText    = ref('');
  const toolActivity     = ref('');
  const error            = ref('');
  const followups        = ref([]);
  const context          = ref(null);
  const suggestedPrompts = ref([]);

  function saveHistory() {
    if (!storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ messages: messages.value, savedAt: Date.now() }));
    } catch { /* ignore quota */ }
  }

  function clear() {
    messages.value = [];
    followups.value = [];
    error.value = '';
    streamingText.value = '';
    if (storageKey) localStorage.removeItem(storageKey);
  }

  async function loadContext() {
    if (!contextEndpoint) return;
    try {
      const res = await fetch(contextEndpoint, { headers: authHeaders() });
      if (!res.ok) return;
      const data = await res.json();
      context.value = data.context || null;
      suggestedPrompts.value = Array.isArray(data.suggestedPrompts) ? data.suggestedPrompts : [];
    } catch { /* non-fatal */ }
  }

  async function streamRequest() {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify(buildBody(messages.value)),
    });
    // Quota exhausted — raise the global upgrade prompt and surface a friendly
    // message (the SSE endpoint returns plain JSON, not a stream, on a 402).
    if (res.status === 402) {
      let detail = {};
      try { detail = await res.json(); } catch { /* ignore */ }
      if (detail.code === 'QUOTA_EXCEEDED') {
        window.dispatchEvent(new CustomEvent('hc:quota', { detail }));
      }
      throw new Error(detail.error || 'You’ve reached your weekly chat limit.');
    }
    if (!res.ok || !res.body) throw new Error('Request failed');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    let finished = false;

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const frame = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const { event, data } = parseFrame(frame);
        if (!event) continue;
        if (event === 'text') {
          streamingText.value += data.delta || '';
          toolActivity.value = '';
        } else if (event === 'tool') {
          toolActivity.value = toolLabels[data.name] || 'Working…';
        } else if (event === 'done') {
          finished = true;
          messages.value.push({ role: 'assistant', content: data.reply || streamingText.value || '' });
          streamingText.value = '';
          followups.value = Array.isArray(data.followups) ? data.followups : [];
          saveHistory();
          if (onResult) onResult(data);
        } else if (event === 'error') {
          throw new Error(data.message || 'error');
        }
      }
    }

    // Stream closed without an explicit done — salvage any partial text.
    if (!finished) {
      if (streamingText.value) {
        messages.value.push({ role: 'assistant', content: streamingText.value });
        streamingText.value = '';
        saveHistory();
      } else {
        throw new Error('Connection closed unexpectedly');
      }
    }
  }

  async function run() {
    loading.value = true;
    streamingText.value = '';
    toolActivity.value = '';
    error.value = '';
    await nextTick();
    try {
      await streamRequest();
    } catch {
      streamingText.value = '';
      error.value = 'Sorry, something went wrong.';
    } finally {
      loading.value = false;
      toolActivity.value = '';
    }
  }

  // Send a new user message (from the input or a suggested-prompt chip).
  async function send(text) {
    const content = (text ?? input.value).trim();
    if (!content || loading.value) return;
    input.value = '';
    followups.value = [];
    messages.value.push({ role: 'user', content });
    saveHistory();
    await run();
  }

  // Retry the last exchange after a failure (the user message is still last).
  async function retry() {
    if (loading.value) return;
    const last = messages.value[messages.value.length - 1];
    if (!last || last.role !== 'user') return;
    await run();
  }

  return {
    messages, input, loading, streamingText, toolActivity, error,
    followups, context, suggestedPrompts,
    send, retry, clear, loadContext,
  };
}
