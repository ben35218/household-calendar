import { useEffect, useState } from 'react';
import { storageApi, type StorageState } from '../api';

// Shared storage-mode / cloud-purge state (Phase 6, §6). The server is the
// source of truth for whether a purge is scheduled; a tiny subscriber store
// keeps the countdown banner and the Privacy screen in sync after any change.

let state: StorageState | null = null;
const subs = new Set<() => void>();

export function getStorageState(): StorageState | null {
  return state;
}

// Push a fresh state (e.g. the response from switch-to-local/cloud) to all
// subscribers without a round-trip.
export function setStorageState(next: StorageState | null) {
  state = next;
  subs.forEach((fn) => fn());
}

// Re-fetch from the server. Best-effort — a failure leaves the last state.
export async function refreshStorageState() {
  try {
    const { data } = await storageApi.getMode();
    state = data;
  } catch {
    /* keep last-known state */
  }
  subs.forEach((fn) => fn());
}

export function useStorageState() {
  const [s, setS] = useState<StorageState | null>(state);
  useEffect(() => {
    const sub = () => setS(state ? { ...state } : null);
    subs.add(sub);
    if (!state) refreshStorageState();
    return () => {
      subs.delete(sub);
    };
  }, []);
  return { state: s, refresh: refreshStorageState, setState: setStorageState };
}

// Whole days remaining until a scheduled purge (rounded up; min 0).
export function daysUntil(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime() - Date.now();
  return Math.max(0, Math.ceil(ms / (24 * 60 * 60 * 1000)));
}
