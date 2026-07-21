// AI payload minimization (Signal-parity plan G1).
//
// Every assistant sends client-decrypted records to the AI routes (ephemeral
// consent). Records fresh off `openRecord` still carry database metadata —
// Mongo ids, userId/householdId, key/envelope fields, timestamps — none of
// which the model needs. This module is the one chokepoint payloads pass
// through before leaving the device:
//
//   1. STRIP: drop server-metadata fields outright.
//   2. ALIAS: replace every ObjectId-shaped string (record _id, foreign keys)
//      with a stable per-conversation alias (`r1`, `r2`, …). Cross-references
//      survive (the same id always maps to the same alias), so server-side
//      tools that match records by id (e.g. call_business finding an event in
//      the supplied sources) keep working — they just speak in aliases.
//   3. RESOLVE: tool results coming back may reference those aliases (edit
//      form ids, task ids); `resolveAliases` deep-walks a result and swaps
//      aliases back to real ids before the app acts on them.
//
// Net: Anthropic (and the transiting server) sees content + opaque aliases —
// nothing linkable to the ciphertext store. The property is pinned by
// __tests__/aiPayload.test.ts: sanitized output contains no ObjectId-shaped
// strings and no stripped metadata keys.

const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

// Server metadata the model never needs. `enc` never leaves in either case
// (openRecord strips it), listed anyway as defense in depth.
const STRIP_KEYS = new Set([
  'userId', 'householdId', 'accountId', 'enc', 'keyVersion',
  'createdAt', 'updatedAt', '__v', 'invitationId', 'wrappedFileKey',
]);

export interface AiAliasContext {
  toAlias: (id: string) => string;
  fromAlias: (alias: string) => string | undefined;
  sanitize: <T>(value: T) => unknown;
  resolveAliases: <T>(value: T) => T;
}

// One context per conversation: aliases stay stable across turns so the model
// can refer back to "r3" later in the chat.
export function createAliasContext(): AiAliasContext {
  const idToAlias = new Map<string, string>();
  const aliasToId = new Map<string, string>();

  function toAlias(id: string): string {
    const existing = idToAlias.get(id);
    if (existing) return existing;
    const alias = `r${idToAlias.size + 1}`;
    idToAlias.set(id, alias);
    aliasToId.set(alias, id);
    return alias;
  }

  function sanitize(value: unknown): unknown {
    if (Array.isArray(value)) return value.map(sanitize);
    if (value && typeof value === 'object') {
      if (value instanceof Date) return value;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (STRIP_KEYS.has(k)) continue;
        out[k] = sanitize(v);
      }
      return out;
    }
    if (typeof value === 'string' && OBJECT_ID_RE.test(value)) return toAlias(value);
    return value;
  }

  function resolveAliases<T>(value: T): T {
    if (Array.isArray(value)) return value.map((v) => resolveAliases(v)) as T;
    if (value && typeof value === 'object') {
      if (value instanceof Date) return value;
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = resolveAliases(v);
      }
      return out as T;
    }
    if (typeof value === 'string') {
      const real = aliasToId.get(value);
      if (real) return real as T;
    }
    return value;
  }

  return { toAlias, fromAlias: (a) => aliasToId.get(a), sanitize, resolveAliases };
}
