<template>
  <v-container class="py-6" max-width="900">
    <div class="d-flex align-center mb-6">
      <BackButton />
      <div class="ml-2">
        <h1 class="text-h4 font-weight-bold">Chores</h1>
        <p class="text-body-2 text-medium-emphasis">Everything on your household chore calendar</p>
      </div>
      <v-spacer />
      <v-btn variant="text" size="small" prepend-icon="mdi-view-grid-outline" color="#F57C00" to="/chores/templates" class="mr-1">Templates</v-btn>
      <v-btn color="#F57C00" prepend-icon="mdi-plus" :to="{ path: '/calendar/event/new', query: { tab: 'chore' } }">Add Chore</v-btn>
    </div>

    <v-progress-linear v-if="loading" indeterminate color="#F57C00" class="mb-4" />

    <v-card v-if="!loading && !chores.length" rounded="lg" elevation="1" class="text-center pa-10">
      <v-icon size="56" color="#F57C00" class="mb-3">mdi-broom</v-icon>
      <div class="text-h6 mb-1">No chores yet</div>
      <div class="text-body-2 text-medium-emphasis mb-4">Add a chore to start tracking it on your calendar.</div>
      <v-btn color="#F57C00" prepend-icon="mdi-plus" :to="{ path: '/calendar/event/new', query: { tab: 'chore' } }">Add Chore</v-btn>
    </v-card>

    <v-card v-else-if="!loading" rounded="lg" elevation="1">
      <v-list lines="two" class="py-0">
        <template v-for="(chore, i) in chores" :key="chore._id">
          <v-divider v-if="i > 0" />
          <v-list-item :to="`/chores/${chore._id}`" :class="{ 'chore-paused': chore.active === false }">
            <template #prepend>
              <v-avatar :color="chore.active === false ? 'grey-lighten-1' : '#F57C00'" size="40" variant="flat">
                <v-icon size="22" color="white">{{ chore.icon || 'mdi-broom' }}</v-icon>
              </v-avatar>
            </template>

            <v-list-item-title class="font-weight-medium d-flex align-center ga-2">
              {{ chore.title }}
              <v-chip v-if="chore.active === false" color="grey" size="x-small" label>Paused</v-chip>
            </v-list-item-title>

            <v-list-item-subtitle class="mt-1">
              <div class="d-flex flex-wrap align-center ga-3">
                <span class="d-inline-flex align-center ga-1">
                  <v-icon size="14">mdi-account</v-icon>
                  {{ assigneeName(chore) }}
                </span>
                <span v-if="chore.recurrence" class="d-inline-flex align-center ga-1">
                  <v-icon size="14">mdi-repeat</v-icon>
                  {{ recurrenceLabel(chore.recurrence) }}
                </span>
              </div>
            </v-list-item-subtitle>

            <template #append>
              <div class="d-flex align-center" @click.stop>
                <span class="text-caption text-medium-emphasis mr-2 d-none d-sm-inline">
                  {{ chore.active === false ? 'Paused' : 'Active' }}
                </span>
                <v-switch
                  :model-value="chore.active !== false"
                  color="#F57C00"
                  density="compact"
                  hide-details
                  inset
                  :loading="toggling === chore._id"
                  @update:model-value="togglePause(chore)"
                />
              </div>
            </template>
          </v-list-item>
        </template>
      </v-list>
    </v-card>
  </v-container>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { choresApi } from '../services/api';
import { openRecord } from '../services/e2ee';
import * as replica from '../services/replica';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();

const chores   = ref([]);
const loading  = ref(true);
const toggling = ref(null);

const WEEKDAYS      = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTH_NAMES   = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

function ordinal(n) {
  const s = ['th', 'st', 'nd', 'rd'], v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

function recurrenceLabel(r) {
  if (!r) return '';
  if (r.type === 'one-time') return 'One-time';
  if (r.type === 'calendar') {
    const months = r.months?.map(m => MONTH_NAMES[m - 1]).join(', ');
    const day = r.dayOfMonth ? ` on the ${ordinal(r.dayOfMonth)}` : '';
    return months ? `Every year in ${months}${day}` : 'Calendar';
  }
  if (r.type === 'interval') {
    const n = r.intervalValue;
    const unit = n === 1 ? r.intervalUnit?.replace(/s$/, '') : r.intervalUnit;
    let label = `Every ${n} ${unit}`;
    if (r.intervalUnit === 'weeks' && r.dayOfWeek != null) label += ` on ${WEEKDAYS[r.dayOfWeek]}`;
    if (r.intervalUnit === 'months') {
      if (r.weekOfMonth != null && r.dayOfWeek != null) {
        const pos = r.weekOfMonth === -1 ? 'last' : ['', 'first', 'second', 'third', 'fourth'][r.weekOfMonth];
        label += ` on the ${pos} ${WEEKDAY_NAMES[r.dayOfWeek]}`;
      } else if (r.dayOfMonth) {
        label += ` on the ${ordinal(r.dayOfMonth)}`;
      }
    }
    return label;
  }
  return '';
}

function assigneeName(chore) {
  const a = chore.assignedTo;
  if (!a) return 'Unassigned';
  if (auth.user && a.accountId && String(a.accountId) === String(auth.user.id || auth.user._id)) return 'You';
  return a.name || 'Unassigned';
}

async function togglePause(chore) {
  toggling.value = chore._id;
  const wasActive = chore.active !== false;
  try {
    if (wasActive) await choresApi.pause(chore._id);
    else           await choresApi.resume(chore._id);
    chore.active = !wasActive;
  } finally {
    toggling.value = null;
  }
}

onMounted(async () => {
  try {
    // Offline-first (Phase 4b): sync the replica, fall back to cache offline,
    // then decrypt content over the plaintext rows.
    const rows = await replica.syncedList('Chore', async () => (await choresApi.list()).data);
    chores.value = await Promise.all(rows.map((c) => openRecord('Chore', c)));
  } finally {
    loading.value = false;
  }
});
</script>

<style scoped>
.chore-paused { opacity: 0.6; }
</style>
