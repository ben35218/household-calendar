<template>
  <v-container class="py-6" max-width="700">
    <BackButton class="mb-3" />

    <v-card v-if="chore" rounded="lg" elevation="1">
      <!-- Header -->
      <div class="d-flex align-center ga-3 pa-4">
        <v-avatar color="#F57C00" variant="tonal" size="44" rounded="lg">
          <v-icon>{{ chore.icon || 'mdi-broom' }}</v-icon>
        </v-avatar>
        <div class="flex-grow-1">
          <h1 class="text-h5 font-weight-bold">{{ chore.title }}</h1>
          <v-chip v-if="chore.active === false" color="grey" size="small" label class="mt-1" prepend-icon="mdi-pause-circle">Paused</v-chip>
        </div>
        <v-btn icon="mdi-delete-outline" variant="text" color="error" @click="deleteDialog = true" />
        <v-btn variant="outlined" prepend-icon="mdi-pencil" :to="`/chores/${$route.params.id}/edit`">Edit</v-btn>
      </div>

      <v-divider />

      <!-- Details -->
      <v-list class="py-2" bg-color="transparent">
        <v-list-item prepend-icon="mdi-account-outline" title="Assigned to" :subtitle="assigneeName" />
        <v-list-item prepend-icon="mdi-calendar-outline" title="Next due" :subtitle="chore.nextDueDate ? formatDate(chore.nextDueDate) : 'Not set'" />
        <v-list-item v-if="chore.recurrence" prepend-icon="mdi-repeat" title="Recurrence" :subtitle="recurrenceLabel" />
        <v-list-item prepend-icon="mdi-bell-outline" title="Alerts">
          <template #subtitle>
            <span :class="{ 'text-medium-emphasis': alertSummary === 'No alerts' }">{{ alertSummary }}</span>
          </template>
        </v-list-item>
      </v-list>

      <template v-if="instructions">
        <v-divider />
        <div class="pa-4">
          <div class="text-overline text-medium-emphasis mb-1">Instructions</div>
          <p class="text-body-1 mb-0">{{ instructions }}</p>
        </div>
      </template>
    </v-card>
  </v-container>

  <v-dialog v-model="deleteDialog" max-width="400">
    <v-card rounded="lg">
      <v-card-title class="d-flex align-center ga-2">
        <v-icon color="error">mdi-delete-alert</v-icon>
        Delete Chore
      </v-card-title>
      <v-card-text>
        Are you sure you want to delete <strong>{{ chore?.title }}</strong>? This cannot be undone.
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="deleteDialog = false">Cancel</v-btn>
        <v-btn color="error" variant="tonal" :loading="deleting" @click="doDelete">Delete</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { format } from 'date-fns';
import { choresApi } from '../services/api';
import { useReturnTo } from '../composables/useSmartBack';

const route = useRoute();
const returnTo = useReturnTo();

const chore = ref(null);
const deleteDialog = ref(false);
const deleting = ref(false);

// Parse a stored date as the calendar date it represents (ignoring time/timezone).
// MongoDB stores date-only inputs as UTC midnight, which shifts to the previous
// day in negative-offset timezones. Extracting the UTC YYYY-MM-DD and parsing at
// local noon avoids the boundary crossing.
function parseCalendarDate(d) {
  const iso = new Date(d).toISOString();
  const [y, mo, day] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, mo - 1, day, 12, 0, 0);
}

function formatDate(d) { return format(parseCalendarDate(d), 'MMM d, yyyy'); }

const instructions = computed(() => chore.value?.instructions || chore.value?.description || '');

const assigneeName = computed(() => chore.value?.assignedTo?.name || 'Unassigned');

function alertPhrase(days) {
  if (days == null) return null;
  if (days === 0) return 'On the due date';
  if (days === 1) return '1 day before';
  if (days === 7) return '1 week before';
  return `${days} days before`;
}

const alertSummary = computed(() => {
  const parts = [alertPhrase(chore.value?.reminderDaysBefore), alertPhrase(chore.value?.alert2DaysBefore)].filter(Boolean);
  if (!parts.length) return 'No alerts';
  if (chore.value?.alertAudience === 'owner') parts.push('you only');
  return parts.join(' · ');
});

const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTH_NAMES   = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function ordinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}

const recurrenceLabel = computed(() => {
  const r = chore.value?.recurrence;
  if (!r) return '';
  if (r.type === 'one-time') return 'One-time';
  if (r.type === 'calendar') {
    const months = r.months?.map(m => MONTH_NAMES[m-1]).join(', ');
    const day = r.dayOfMonth ? ` on the ${ordinal(r.dayOfMonth)}` : '';
    return months ? `Every year in ${months}${day}` : 'Calendar';
  }
  if (r.type === 'interval') {
    const n = r.intervalValue;
    const unit = n === 1 ? r.intervalUnit?.replace(/s$/, '') : r.intervalUnit;
    let label = `Every ${n} ${unit}`;
    if (r.intervalUnit === 'weeks' && r.dayOfWeek != null) label += ` on ${WEEKDAY_NAMES[r.dayOfWeek]}`;
    if (r.intervalUnit === 'months') {
      if (r.weekOfMonth != null && r.dayOfWeek != null) {
        const pos = r.weekOfMonth === -1 ? 'last' : ['','first','second','third','fourth'][r.weekOfMonth];
        label += ` on the ${pos} ${WEEKDAY_NAMES[r.dayOfWeek]}`;
      } else if (r.dayOfMonth) {
        label += ` on the ${ordinal(r.dayOfMonth)}`;
      }
    }
    return label;
  }
  return '';
});

async function doDelete() {
  deleting.value = true;
  try {
    await choresApi.delete(route.params.id);
    returnTo('/chores');
  } finally {
    deleting.value = false;
  }
}

onMounted(async () => {
  const { data } = await choresApi.get(route.params.id);
  chore.value = data;
});
</script>
