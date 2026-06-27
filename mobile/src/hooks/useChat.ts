import { useCallback, useEffect, useRef, useState } from 'react';
import EventSource from 'react-native-sse';
import { API_URL } from '../config';
import { getCachedToken } from '../lib/secureToken';
import api from '../api/client';

// Mirrors client/src/composables/useChat.js for React Native. RN's fetch can't
// stream response bodies, so the SSE transport uses react-native-sse (an
// XHR-based EventSource that supports POST + custom headers + body). The bearer
// token is attached explicitly here from the SecureStore-backed cache — this
// request does NOT go through the axios instance, so it would otherwise be
// unauthenticated.
//
// Deferred vs web: history persistence (no AsyncStorage dep yet) and rich
// markdown rendering (bubbles use flattenMarkdown instead).

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatContext {
  sees?: string[];
  can?: string[];
  note?: string;
}

export interface ChatDoneData {
  reply?: string;
  followups?: string[];
  navigateTo?: string;
  tasksCreated?: { id: string; title: string }[];
  [key: string]: unknown;
}

export interface UseChatOptions {
  endpoint: string; // relative to API_URL, e.g. '/calendar/chat'
  contextEndpoint?: string; // relative GET path incl. any query string
  buildBody: (messages: ChatMessage[]) => Record<string, unknown>;
  onResult?: (data: ChatDoneData) => void;
  toolLabels?: Record<string, string>;
}

class ChatQuotaError extends Error {}

type ChatSSEEvent = 'text' | 'tool' | 'done';

function parseData(data: string | null): Record<string, any> {
  if (!data) return {};
  try {
    return JSON.parse(data);
  } catch {
    return {};
  }
}

export function useChat(options: UseChatOptions) {
  // Keep the latest options in a ref so the streaming callbacks never go stale
  // and don't need to be torn down/recreated when the caller passes inline
  // buildBody/onResult/toolLabels.
  const optsRef = useRef(options);
  optsRef.current = options;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingText, setStreamingText] = useState('');
  const [toolActivity, setToolActivity] = useState('');
  const [error, setError] = useState('');
  const [followups, setFollowups] = useState<string[]>([]);
  const [context, setContext] = useState<ChatContext | null>(null);
  const [suggestedPrompts, setSuggestedPrompts] = useState<string[]>([]);

  const esRef = useRef<EventSource<ChatSSEEvent> | null>(null);

  // Tear down any in-flight stream on unmount.
  useEffect(
    () => () => {
      esRef.current?.removeAllEventListeners();
      esRef.current?.close();
      esRef.current = null;
    },
    []
  );

  const loadContext = useCallback(async () => {
    const ep = optsRef.current.contextEndpoint;
    if (!ep) return;
    try {
      const { data } = await api.get(ep);
      setContext(data.context || null);
      setSuggestedPrompts(Array.isArray(data.suggestedPrompts) ? data.suggestedPrompts : []);
    } catch {
      /* non-fatal */
    }
  }, []);

  const clear = useCallback(() => {
    setMessages([]);
    setFollowups([]);
    setError('');
    setStreamingText('');
  }, []);

  const streamRequest = useCallback(
    (history: ChatMessage[]) =>
      new Promise<void>((resolve, reject) => {
        const { endpoint, buildBody, onResult, toolLabels = {} } = optsRef.current;
        const token = getCachedToken();
        const es = new EventSource<ChatSSEEvent>(`${API_URL}${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(buildBody(history)),
          pollingInterval: 0, // one-shot request; never auto-reconnect
        });
        esRef.current = es;

        let acc = '';
        let finished = false;
        let settled = false;

        const teardown = () => {
          es.removeAllEventListeners();
          es.close();
          if (esRef.current === es) esRef.current = null;
        };
        const done = () => {
          if (settled) return;
          settled = true;
          teardown();
          resolve();
        };
        const fail = (err: Error) => {
          if (settled) return;
          settled = true;
          teardown();
          reject(err);
        };

        es.addEventListener('text', (e) => {
          acc += parseData(e.data).delta || '';
          setStreamingText(acc);
          setToolActivity('');
        });
        es.addEventListener('tool', (e) => {
          const name = parseData(e.data).name as string;
          setToolActivity(toolLabels[name] || 'Working…');
        });
        es.addEventListener('done', (e) => {
          const data = parseData(e.data) as ChatDoneData;
          finished = true;
          setMessages((m) => [...m, { role: 'assistant', content: data.reply || acc || '' }]);
          setStreamingText('');
          setFollowups(Array.isArray(data.followups) ? data.followups : []);
          onResult?.(data);
          done();
        });
        // Built-in error: HTTP non-2xx, network failure, or stream exception.
        es.addEventListener('error', (e) => {
          if (e.type === 'error' && e.xhrStatus === 402) {
            fail(new ChatQuotaError());
            return;
          }
          // Stream broke after some text arrived — salvage the partial reply.
          if (!finished && acc) {
            setMessages((m) => [...m, { role: 'assistant', content: acc }]);
            setStreamingText('');
            done();
            return;
          }
          fail(new Error('stream error'));
        });
        // Normal end-of-stream without an explicit done event.
        es.addEventListener('close', () => {
          if (finished) return;
          if (acc) {
            setMessages((m) => [...m, { role: 'assistant', content: acc }]);
            setStreamingText('');
            done();
          } else {
            fail(new Error('connection closed'));
          }
        });
      }),
    []
  );

  const run = useCallback(
    async (history: ChatMessage[]) => {
      setLoading(true);
      setStreamingText('');
      setToolActivity('');
      setError('');
      try {
        await streamRequest(history);
      } catch (e) {
        setStreamingText('');
        setError(
          e instanceof ChatQuotaError
            ? 'You’ve reached your monthly chat limit. Upgrade for more messages.'
            : 'Sorry, something went wrong.'
        );
      } finally {
        setLoading(false);
        setToolActivity('');
      }
    },
    [streamRequest]
  );

  const send = useCallback(
    async (text?: string) => {
      const content = (text ?? input).trim();
      if (!content || loading) return;
      setInput('');
      setFollowups([]);
      const next: ChatMessage[] = [...messages, { role: 'user', content }];
      setMessages(next);
      await run(next);
    },
    [input, loading, messages, run]
  );

  const retry = useCallback(async () => {
    if (loading) return;
    const last = messages[messages.length - 1];
    if (!last || last.role !== 'user') return;
    await run(messages);
  }, [loading, messages, run]);

  return {
    messages,
    input,
    setInput,
    loading,
    streamingText,
    toolActivity,
    error,
    followups,
    context,
    suggestedPrompts,
    send,
    retry,
    clear,
    loadContext,
  };
}

export type ChatController = ReturnType<typeof useChat>;
