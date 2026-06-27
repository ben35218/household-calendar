<template>
  <v-container class="py-6 px-4" style="max-width: 640px">
    <div class="d-flex align-center mb-4">
      <BackButton class="mr-2" />
      <h1 class="text-h5 font-weight-bold">{{ isEdit ? 'Edit Trip' : 'New Trip' }}</h1>
    </div>

    <v-progress-linear v-if="loading" indeterminate color="#5E35B1" class="mb-4" />

    <v-card rounded="lg" elevation="1">
      <v-card-text class="pa-5">
        <v-text-field v-model="form.name" label="Trip name" placeholder="Italy 2026" variant="outlined" class="mb-3" autofocus />

        <v-combobox
          v-model="form.destinationRaw"
          :items="placeSuggestions"
          item-title="description"
          return-object
          no-filter
          clearable
          :loading="placesLoading"
          label="Destination (optional)"
          placeholder="Search a city..."
          variant="outlined"
          class="mb-3"
          @update:search="debouncePlacesSearch"
          @update:model-value="onDestinationSelected"
        >
          <template #item="{ item, props }">
            <v-list-item v-bind="props" :title="item.raw.main_text" :subtitle="item.raw.secondary_text" />
          </template>
        </v-combobox>

        <v-text-field
          v-model="form.destinationTz"
          label="Destination timezone"
          placeholder="Auto-filled from the destination"
          hint="Set automatically from the destination — itinerary times are wall-clock at the destination"
          persistent-hint
          readonly
          variant="outlined"
          class="mb-4"
          :loading="tzLoading"
          prepend-inner-icon="mdi-clock-outline"
        />

        <v-select
          v-model="form.status"
          :items="statusItems"
          item-value="value"
          item-title="title"
          label="Status"
          variant="outlined"
          class="mb-2"
        />

        <!-- Considering: candidate date ranges -->
        <template v-if="form.status === 'considering'">
          <div class="text-subtitle-2 font-weight-medium mt-2 mb-2">Date options you're considering</div>
          <div v-for="(r, i) in form.candidateRanges" :key="i" class="range-row mb-2">
            <v-text-field v-model="r.label" label="Label" placeholder="Option A" density="compact" variant="outlined" hide-details class="range-label" />
            <v-text-field v-model="r.start" label="From" type="date" density="compact" variant="outlined" hide-details />
            <v-text-field v-model="r.end" label="To" type="date" density="compact" variant="outlined" hide-details :min="r.start" />
            <v-btn icon="mdi-close" size="small" variant="text" color="medium-emphasis" @click="form.candidateRanges.splice(i, 1)" />
          </div>
          <v-btn variant="text" color="#5E35B1" size="small" prepend-icon="mdi-plus" @click="addRange">Add date option</v-btn>
        </template>

        <!-- Booked/completed: confirmed window -->
        <template v-else>
          <div class="text-subtitle-2 font-weight-medium mt-2 mb-2">Confirmed travel dates</div>
          <div class="d-flex ga-3 mb-2">
            <v-text-field v-model="form.startDate" label="Start date" type="date" variant="outlined" density="compact" hide-details />
            <v-text-field v-model="form.endDate" label="End date" type="date" variant="outlined" density="compact" hide-details :min="form.startDate" />
          </div>
          <v-btn
            v-if="form.candidateRanges.length"
            variant="text" size="x-small" color="#5E35B1" class="mb-2"
            @click="useOption"
          >Use a considered option →</v-btn>
        </template>

        <div class="text-subtitle-2 font-weight-medium mt-5 mb-2">Budget</div>
        <div class="d-flex ga-3">
          <v-text-field
            v-model.number="form.budget"
            label="Budget (optional)"
            type="number"
            min="0"
            :prefix="form.baseCurrency"
            variant="outlined"
            density="compact"
            hide-details
          />
          <v-combobox
            v-model="form.baseCurrency"
            :items="CURRENCIES"
            label="Currency"
            variant="outlined"
            density="compact"
            hide-details
            style="max-width: 130px"
          />
        </div>
        <div class="text-caption text-medium-emphasis mt-1">Booking costs (in any currency) are converted into this currency for the trip total.</div>

        <v-textarea v-model="form.notes" label="Notes (optional)" variant="outlined" rows="2" auto-grow class="mt-4" />
      </v-card-text>

      <v-divider />
      <v-card-actions class="pa-4">
        <v-btn v-if="isEdit" color="error" variant="text" :loading="saving" @click="remove">Delete</v-btn>
        <v-spacer />
        <v-btn variant="text" @click="goBack">Cancel</v-btn>
        <v-btn color="#5E35B1" variant="elevated" :loading="saving" :disabled="!form.name.trim()" @click="save">Save</v-btn>
      </v-card-actions>
    </v-card>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { format } from 'date-fns';
import { tripsApi, placesApi } from '../services/api';
import { useSmartBack, useReturnTo } from '../composables/useSmartBack';
import { useConfirm } from '../composables/useConfirm';

const { confirm } = useConfirm();
const route = useRoute();
const router = useRouter();
const goBack = useSmartBack();
const returnTo = useReturnTo();

const isEdit = computed(() => !!route.params.id);
const loading = ref(false);
const saving = ref(false);

const form = ref({
  name: '',
  destinationRaw: '',
  destinationPlaceId: '',
  destinationTz: '',
  status: 'considering',
  candidateRanges: [],
  startDate: '',
  endDate: '',
  budget: null,
  baseCurrency: 'CAD',
  notes: '',
});

const statusItems = [
  { value: 'considering', title: 'Considering — comparing date options' },
  { value: 'booked', title: 'Booked — travel is confirmed' },
  { value: 'completed', title: 'Past — already happened' },
];

const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CHF', 'CNY', 'MXN', 'INR'];

function addRange() {
  form.value.candidateRanges.push({ label: '', start: '', end: '' });
}

function useOption() {
  const r = form.value.candidateRanges[0];
  if (!r) return;
  form.value.startDate = r.start;
  form.value.endDate = r.end;
}

// ── Places autocomplete (cities) ────────────────────────────────────────────────
const placeSuggestions = ref([]);
const placesLoading = ref(false);
const tzLoading = ref(false);
let placesTimer = null;

function debouncePlacesSearch(query) {
  clearTimeout(placesTimer);
  const cur = form.value.destinationRaw;
  if (cur && typeof cur === 'object' && cur.description === query) return;
  if (!query || query.length < 3) { placeSuggestions.value = []; return; }
  placesTimer = setTimeout(async () => {
    placesLoading.value = true;
    try {
      const { data } = await placesApi.autocomplete(query, 'city');
      placeSuggestions.value = data.predictions ?? [];
    } catch {
      placeSuggestions.value = [];
    } finally {
      placesLoading.value = false;
    }
  }, 350);
}

// When a city is picked, store its placeId and auto-fill the timezone label.
async function onDestinationSelected(val) {
  if (!val || typeof val !== 'object' || !val.place_id) return;
  form.value.destinationPlaceId = val.place_id;
  tzLoading.value = true;
  try {
    const { data } = await placesApi.getTimezone(val.place_id);
    if (data.timeZoneId) form.value.destinationTz = data.timeZoneId;
  } catch {
    /* timezone lookup unavailable — leave field for manual entry */
  } finally {
    tzLoading.value = false;
  }
}

const dateOnly = (d) => d ? format(new Date(d), 'yyyy-MM-dd') : '';

async function save() {
  if (!form.value.name.trim()) return;
  saving.value = true;
  try {
    const raw = form.value.destinationRaw;
    const destination = raw && typeof raw === 'object' ? raw.description : (raw || '');
    const placeId = raw && typeof raw === 'object' ? raw.place_id : form.value.destinationPlaceId || undefined;

    const payload = {
      name: form.value.name.trim(),
      destination: destination || undefined,
      destinationPlaceId: placeId,
      destinationTz: form.value.destinationTz || undefined,
      status: form.value.status,
      budget: (form.value.budget === '' || form.value.budget == null) ? null : Number(form.value.budget),
      baseCurrency: (form.value.baseCurrency || 'CAD').toUpperCase(),
      notes: form.value.notes || undefined,
    };

    if (form.value.status === 'considering') {
      payload.candidateRanges = form.value.candidateRanges
        .filter(r => r.start && r.end)
        .map(r => ({ label: r.label || undefined, start: r.start, end: r.end }));
      payload.startDate = null;
      payload.endDate = null;
    } else {
      payload.startDate = form.value.startDate || undefined;
      payload.endDate = form.value.endDate || form.value.startDate || undefined;
      // keep candidate ranges around in case they switch back
      payload.candidateRanges = form.value.candidateRanges
        .filter(r => r.start && r.end)
        .map(r => ({ label: r.label || undefined, start: r.start, end: r.end }));
    }

    let id = route.params.id;
    if (isEdit.value) {
      await tripsApi.update(id, payload);
    } else {
      const { data } = await tripsApi.create(payload);
      id = data._id;
    }
    returnTo(`/vacations/${id}`);
  } finally {
    saving.value = false;
  }
}

async function remove() {
  if (!(await confirm({
    title: 'Delete trip?',
    message: 'This deletes the trip and all its bookings.',
    confirmText: 'Delete', confirmColor: 'error',
  }))) return;
  saving.value = true;
  try {
    await tripsApi.remove(route.params.id);
    returnTo('/vacations');
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  if (!isEdit.value) {
    addRange();
    return;
  }
  loading.value = true;
  try {
    const { data } = await tripsApi.get(route.params.id);
    const t = data.trip;
    form.value = {
      name: t.name ?? '',
      destinationRaw: t.destination ?? '',
      destinationPlaceId: t.destinationPlaceId ?? '',
      destinationTz: t.destinationTz ?? '',
      status: t.status ?? 'considering',
      candidateRanges: (t.candidateRanges ?? []).map(r => ({
        label: r.label ?? '', start: dateOnly(r.start), end: dateOnly(r.end),
      })),
      startDate: dateOnly(t.startDate),
      endDate: dateOnly(t.endDate),
      budget: t.budget ?? null,
      baseCurrency: t.baseCurrency ?? 'CAD',
      notes: t.notes ?? '',
    };
    if (form.value.status === 'considering' && !form.value.candidateRanges.length) addRange();
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.range-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.range-label { max-width: 130px; }
</style>
