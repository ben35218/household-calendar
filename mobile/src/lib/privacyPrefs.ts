import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

// AsyncStorage-backed privacy preferences with a tiny subscriber store, mirroring
// the pattern in calendarPrefs.ts so every mounted hook stays in sync when the
// Privacy screen flips a toggle.

const KEY = 'hc_privacy_prefs';

export type DataStorage = 'cloud' | 'local';

export interface PrivacyPrefs {
  // Master switch for any AI-powered feature (assistants, suggestions, scans).
  aiEnabled: boolean;
  // Whether personal/contact info may be included in AI prompts.
  aiUsePersonalInfo: boolean;
  // Where app data lives: backed up in the Cloud, or kept only on this device.
  dataStorage: DataStorage;
}

export const DEFAULT_PRIVACY_PREFS: PrivacyPrefs = {
  aiEnabled: true,
  aiUsePersonalInfo: true,
  dataStorage: 'cloud',
};

// ── In-memory state + subscribers ───────────────────────────────────────────
let state: PrivacyPrefs | null = null;
const subs = new Set<() => void>();
let loaded = false;

function current(): PrivacyPrefs {
  return state ?? DEFAULT_PRIVACY_PREFS;
}

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const saved = raw ? JSON.parse(raw) : {};
    state = { ...DEFAULT_PRIVACY_PREFS, ...saved };
  } catch {
    state = { ...DEFAULT_PRIVACY_PREFS };
  }
  subs.forEach((fn) => fn());
}

function persist(next: PrivacyPrefs) {
  state = next;
  AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  subs.forEach((fn) => fn());
}

// Read the current prefs imperatively (e.g. before firing an AI request). Falls
// back to defaults until the first load resolves.
export function getPrivacyPrefs(): PrivacyPrefs {
  ensureLoaded();
  return current();
}

export function usePrivacyPrefs() {
  const [prefs, setPrefs] = useState<PrivacyPrefs>(current());

  useEffect(() => {
    const sub = () => setPrefs({ ...current() });
    subs.add(sub);
    ensureLoaded().then(sub);
    return () => {
      subs.delete(sub);
    };
  }, []);

  function set<K extends keyof PrivacyPrefs>(key: K, value: PrivacyPrefs[K]) {
    persist({ ...current(), [key]: value });
  }

  return { prefs, set };
}
