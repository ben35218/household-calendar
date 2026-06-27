import { ref } from 'vue';
import { HOLIDAY_DEFS } from '../utils/canadianHolidays';

const STORAGE_KEY = 'hc_holiday_enabled';
const ALL_IDS = HOLIDAY_DEFS.map(d => d.id);

function loadFromStorage() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return new Set(ALL_IDS);
    const saved = JSON.parse(raw);
    if (!Array.isArray(saved)) return new Set(ALL_IDS);
    // Only include IDs that still exist in HOLIDAY_DEFS
    return new Set(saved.filter(id => ALL_IDS.includes(id)));
  } catch {
    return new Set(ALL_IDS);
  }
}

// Singleton — state shared across all component instances
const enabledHolidays = ref(loadFromStorage());

export function useHolidayPrefs() {
  function save() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...enabledHolidays.value]));
  }

  function toggle(id) {
    const next = new Set(enabledHolidays.value);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    enabledHolidays.value = next;
    save();
  }

  function isEnabled(id) {
    return enabledHolidays.value.has(id);
  }

  function enabledIdsList() {
    return [...enabledHolidays.value];
  }

  return { enabledHolidays, toggle, isEnabled, enabledIdsList };
}
