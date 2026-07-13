import { useSyncExternalStore } from 'react';
import type { RepeatRule } from './eventRepeat';

// The repeat rule edited on the pushed EventRepeat screen. The event form and
// the pushed screen share this module-level draft (mirrors travelDraft.ts) so
// edits flow back to the form live without non-serializable route params.

let draft: RepeatRule | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setRepeatDraft(next: RepeatRule) {
  draft = next;
  emit();
}

export function clearRepeatDraft() {
  if (draft) {
    draft = null;
    emit();
  }
}

export function useRepeatDraft(): RepeatRule | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => draft,
  );
}
