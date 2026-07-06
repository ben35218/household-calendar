import { useEffect, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { HOLIDAY_DEFS } from './holidays';
import { applyCalendarColorOverrides } from './calendar';

// AsyncStorage-backed equivalents of the web's localStorage singletons
// (hc_calendar_visibility / hc_holiday_enabled). A tiny subscriber store keeps
// every mounted hook in sync, mirroring Vue's module-level refs so a change in
// CalendarsView/HolidaysView is reflected live in the calendar + events list.

const VIS_KEY = 'hc_calendar_visibility';
const HOL_KEY = 'hc_holiday_enabled';
const COLORS_KEY = 'hc_calendar_colors';

export interface CalendarDef {
  id: string;
  name: string;
  color: string;
  group: 'basic' | 'advanced';
}

// Mirrors CalendarsView.vue (superset of the events-list calendars).
export const CALENDARS: CalendarDef[] = [
  { id: 'activities', name: 'Activities', color: '#388E3C', group: 'basic' },
  { id: 'appointments', name: 'Appointments', color: '#7B1FA2', group: 'basic' },
  { id: 'birthdays', name: 'Birthdays', color: '#E91E63', group: 'basic' },
  { id: 'canadian-holidays', name: 'Holidays', color: '#D32F2F', group: 'basic' },
  { id: 'weather', name: 'Weather', color: '#0288D1', group: 'basic' },
  { id: 'chores', name: 'Chores', color: '#F57C00', group: 'advanced' },
  { id: 'recipes', name: 'Meals', color: '#00897B', group: 'advanced' },
  { id: 'maintenance', name: 'Maintenance', color: '#1976D2', group: 'advanced' },
  { id: 'vacations', name: 'Vacations', color: '#5E35B1', group: 'advanced' },
];

const ALL_HOLIDAY_IDS = HOLIDAY_DEFS.map((d) => d.id);

// Default colour per calendar id (the source of truth for the picker's reset).
export const DEFAULT_CALENDAR_COLORS: Record<string, string> = Object.fromEntries(
  CALENDARS.map((c) => [c.id, c.color])
);

type VisMap = Record<string, boolean>;
type ColorMap = Record<string, string>;

// ── In-memory state + subscribers ───────────────────────────────────────────
let visState: VisMap | null = null;
let holState: string[] | null = null;
let colorOverrideState: ColorMap = {}; // sparse — only user overrides
const visSubs = new Set<() => void>();
const holSubs = new Set<() => void>();
const colorSubs = new Set<() => void>();
let loaded = false;

// Merge overrides over defaults into a full id→colour map.
function mergedColors(): ColorMap {
  const out: ColorMap = { ...DEFAULT_CALENDAR_COLORS };
  for (const id of Object.keys(colorOverrideState)) out[id] = colorOverrideState[id];
  return out;
}

function defaultVis(): VisMap {
  return Object.fromEntries(CALENDARS.map((c) => [c.id, true]));
}

async function ensureLoaded() {
  if (loaded) return;
  loaded = true;
  try {
    const rawVis = await AsyncStorage.getItem(VIS_KEY);
    const saved: VisMap = rawVis ? JSON.parse(rawVis) : {};
    const vis = defaultVis();
    // If saved predates the holidays calendar, keep all visible (matches web).
    if ('canadian-holidays' in saved) {
      for (const c of CALENDARS) if (c.id in saved) vis[c.id] = saved[c.id];
    }
    visState = vis;
  } catch {
    visState = defaultVis();
  }
  try {
    const rawHol = await AsyncStorage.getItem(HOL_KEY);
    const arr = rawHol ? JSON.parse(rawHol) : null;
    holState = Array.isArray(arr) ? arr.filter((id) => ALL_HOLIDAY_IDS.includes(id)) : [...ALL_HOLIDAY_IDS];
  } catch {
    holState = [...ALL_HOLIDAY_IDS];
  }
  try {
    const rawCol = await AsyncStorage.getItem(COLORS_KEY);
    colorOverrideState = rawCol ? JSON.parse(rawCol) : {};
  } catch {
    colorOverrideState = {};
  }
  applyCalendarColorOverrides(colorOverrideState);
  visSubs.forEach((fn) => fn());
  holSubs.forEach((fn) => fn());
  colorSubs.forEach((fn) => fn());
}

// ── Calendar visibility hook ────────────────────────────────────────────────
export function useCalendarVisibility() {
  const [vis, setVis] = useState<VisMap>(visState ?? defaultVis());

  useEffect(() => {
    const sub = () => setVis({ ...(visState ?? defaultVis()) });
    visSubs.add(sub);
    ensureLoaded().then(sub);
    return () => {
      visSubs.delete(sub);
    };
  }, []);

  function setVisible(id: string, visible: boolean) {
    visState = { ...(visState ?? defaultVis()), [id]: visible };
    AsyncStorage.setItem(VIS_KEY, JSON.stringify(visState)).catch(() => {});
    visSubs.forEach((fn) => fn());
  }
  function setAll(visible: boolean) {
    visState = Object.fromEntries(CALENDARS.map((c) => [c.id, visible]));
    AsyncStorage.setItem(VIS_KEY, JSON.stringify(visState)).catch(() => {});
    visSubs.forEach((fn) => fn());
  }

  return { visibility: vis, setVisible, setAll };
}

// ── Holiday prefs hook ──────────────────────────────────────────────────────
export function useHolidayPrefs() {
  const [enabled, setEnabled] = useState<string[]>(holState ?? ALL_HOLIDAY_IDS);

  useEffect(() => {
    const sub = () => setEnabled([...(holState ?? ALL_HOLIDAY_IDS)]);
    holSubs.add(sub);
    ensureLoaded().then(sub);
    return () => {
      holSubs.delete(sub);
    };
  }, []);

  function persist(next: string[]) {
    holState = next;
    AsyncStorage.setItem(HOL_KEY, JSON.stringify(next)).catch(() => {});
    holSubs.forEach((fn) => fn());
  }
  function toggle(id: string) {
    const set = new Set(holState ?? ALL_HOLIDAY_IDS);
    if (set.has(id)) set.delete(id);
    else set.add(id);
    persist([...set]);
  }
  function setGroup(ids: string[], on: boolean) {
    const set = new Set(holState ?? ALL_HOLIDAY_IDS);
    for (const id of ids) {
      if (on) set.add(id);
      else set.delete(id);
    }
    persist([...set]);
  }
  const isEnabled = (id: string) => (holState ?? ALL_HOLIDAY_IDS).includes(id);

  return { enabledIds: enabled, isEnabled, toggle, setGroup };
}

// ── Calendar colour hook ────────────────────────────────────────────────────
export function useCalendarColors() {
  const [colors, setColors] = useState<ColorMap>(mergedColors());

  useEffect(() => {
    const sub = () => setColors(mergedColors());
    colorSubs.add(sub);
    ensureLoaded().then(sub);
    return () => {
      colorSubs.delete(sub);
    };
  }, []);

  function persist() {
    AsyncStorage.setItem(COLORS_KEY, JSON.stringify(colorOverrideState)).catch(() => {});
    applyCalendarColorOverrides(colorOverrideState);
    colorSubs.forEach((fn) => fn());
  }
  function setColor(id: string, color: string) {
    colorOverrideState = { ...colorOverrideState, [id]: color };
    persist();
  }
  function resetColor(id: string) {
    const next = { ...colorOverrideState };
    delete next[id];
    colorOverrideState = next;
    persist();
  }

  return { colors, setColor, resetColor };
}
