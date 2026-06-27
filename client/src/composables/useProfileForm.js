import { reactive, ref, watch } from 'vue';
import { settingsApi, householdApi, placesApi } from '../services/api';
import { useAuthStore } from '../stores/auth';

// Shared singleton state so the drill-in form sections (Account / Notifications
// / About) and their ProfileSaveBar all bind to the same form. This lifts the
// original SettingsView logic verbatim — field names, the settingsApi calls,
// and the Google Places address autocomplete are unchanged.

const timezones = [
  'America/Toronto', 'America/New_York', 'America/Chicago',
  'America/Denver', 'America/Los_Angeles', 'America/Vancouver',
  'Europe/London', 'Europe/Paris', 'Australia/Sydney',
];

// Source of truth for the form. Mirrors the original `settings` ref exactly.
const form = reactive({
  firstName: '', lastName: '', birthdayInput: '',
  reminderLeadDays: 7, timezone: 'America/Toronto',
  homeAddress: '', groceryShoppingDay: 6,
});

// Identity shown in the header (from the auth store + household).
const identity = reactive({ name: '', email: '', initial: '', householdName: '' });

// --- Address autocomplete (lifted from SettingsView) ----------------------
// addressSelected holds a prediction object (with .description) or a plain
// string when the saved address is loaded. form.homeAddress is the source of truth.
const addressSelected = ref(null);
const addressSuggestions = ref([]);
const addressLoading = ref(false);
let addressDebounce = null;

// hydrating suppresses dirty-tracking while load() populates the form.
let hydrating = false;

watch(addressSelected, (val) => {
  if (!val) {
    form.homeAddress = '';
  } else if (typeof val === 'object' && val.description) {
    form.homeAddress = val.description;
  } else if (typeof val === 'string') {
    form.homeAddress = val;
  }
});

function onAddressSearch(val) {
  // Skip fetch if user just selected a prediction (description matches)
  if (addressSelected.value && typeof addressSelected.value === 'object' &&
      addressSelected.value.description === val) return;
  clearTimeout(addressDebounce);
  if (!val || val.length < 2) { addressSuggestions.value = []; return; }
  addressDebounce = setTimeout(async () => {
    addressLoading.value = true;
    try {
      const { data } = await placesApi.autocomplete(val, 'address');
      addressSuggestions.value = data.predictions ?? [];
    } catch {
      addressSuggestions.value = [];
    } finally {
      addressLoading.value = false;
    }
  }, 300);
}

// --- Save/load state ------------------------------------------------------
const loading = ref(false);
const loaded = ref(false);
const saving = ref(false);
const dirty = ref(false);
const saveMsg = ref('');
const saveError = ref(false);

// Member count drives whether per-item alert "audience" pickers appear in forms.
const householdMemberCount = ref(1);

// Any edit to the form marks it dirty (skipped during hydration).
watch(form, () => { if (!hydrating) dirty.value = true; }, { deep: true });

async function load() {
  loading.value = true;
  hydrating = true;
  try {
    const auth = useAuthStore();
    identity.name = [auth.user?.firstName, auth.user?.lastName].filter(Boolean).join(' ').trim();
    identity.email = auth.user?.email || '';
    identity.initial = auth.user?.firstName?.charAt(0).toUpperCase() || '?';

    const settRes = await settingsApi.get();
    const data = settRes.data;
    Object.assign(form, data);
    form.birthdayInput = data.birthday ? data.birthday.slice(0, 10) : '';
    form.groceryShoppingDay = data.groceryShoppingDay ?? 6;
    householdMemberCount.value = data.householdMemberCount ?? 1;
    if (data.homeAddress) addressSelected.value = data.homeAddress;

    try {
      const { data: hh } = await householdApi.get();
      identity.householdName = hh?.name || '';
    } catch { /* household name is non-critical for the header */ }

    dirty.value = false;
    loaded.value = true;
  } finally {
    loading.value = false;
    // Let the deep watch settle on the just-assigned values before re-enabling.
    setTimeout(() => { hydrating = false; }, 0);
  }
}

// Drill-in subpages call this so a deep link / refresh still hydrates the form
// without wiping unsaved edits made earlier in the session.
async function ensureLoaded() {
  if (!loaded.value && !loading.value) await load();
}

async function save() {
  saving.value = true;
  saveMsg.value = '';
  try {
    const { birthdayInput, ...rest } = form;
    await settingsApi.update({ ...rest, birthday: birthdayInput || undefined, groceryShoppingDay: form.groceryShoppingDay });
    saveMsg.value = 'Settings saved!';
    saveError.value = false;
    dirty.value = false;
  } catch (e) {
    saveMsg.value = e.response?.data?.error || 'Save failed';
    saveError.value = true;
  } finally {
    saving.value = false;
    setTimeout(() => { saveMsg.value = ''; }, 3000);
  }
}


export function useProfileForm() {
  return {
    form, identity, timezones, householdMemberCount,
    addressSelected, addressSuggestions, addressLoading, onAddressSearch,
    loading, loaded, saving, dirty, saveMsg, saveError,
    load, ensureLoaded, save,
  };
}
