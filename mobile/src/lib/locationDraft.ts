import { useSyncExternalStore } from 'react';

// The location edited on the pushed EventLocation screen. The event form and
// the pushed screen share this module-level draft (mirrors repeatDraft.ts) so
// the picked place flows back to the form without non-serializable route params.

export interface LocationDraft {
  location: string; // the display string stored on the event ("Name, address")
  phone: string;
  placeId?: string;
}

let draft: LocationDraft | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function setLocationDraft(next: LocationDraft) {
  draft = next;
  emit();
}

export function clearLocationDraft() {
  if (draft) {
    draft = null;
    emit();
  }
}

export function useLocationDraft(): LocationDraft | null {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => draft,
  );
}
