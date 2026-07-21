import { useSyncExternalStore } from 'react';
import { PickedFile } from './media';

// Files picked on a NEW (not-yet-saved) event form. A draft has no event id, so
// the file can't be uploaded yet — EventFormScreen stages the picks here and
// uploads them all after a successful create. Mirrors lib/inviteeDraft.

let queued: PickedFile[] = [];
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
};

export function getQueuedAttachments(): PickedFile[] {
  return queued;
}

export function addQueuedAttachment(file: PickedFile) {
  queued = [...queued, file];
  emit();
}

export function removeQueuedAttachment(index: number) {
  queued = queued.filter((_, i) => i !== index);
  emit();
}

export function clearQueuedAttachments() {
  if (queued.length) {
    queued = [];
    emit();
  }
}

export function useQueuedAttachments(): PickedFile[] {
  return useSyncExternalStore(subscribe, () => queued);
}
