import { useSyncExternalStore } from 'react';

// Invitee emails queued on a NEW (not-yet-saved) event form. A draft has no
// event id, so invitations can't be sent until the event is created — the
// Invitees screen queues addresses here and EventFormScreen sends them after a
// successful save. Module-level (not route params) so the form and the pushed
// Invitees screen share one live list without non-serializable params.

let queued: string[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function getQueuedInvitees(): string[] {
  return queued;
}

export function setQueuedInvitees(next: string[]) {
  queued = next;
  emit();
}

export function clearQueuedInvitees() {
  if (queued.length) {
    queued = [];
    emit();
  }
}

export function useQueuedInvitees(): string[] {
  return useSyncExternalStore(
    (fn) => {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    () => queued,
  );
}
