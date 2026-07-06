<template>
  <v-container class="py-6 px-4" style="max-width: 640px">
    <div class="d-flex align-center mb-6">
      <BackButton class="mr-2" />
      <h1 class="text-h4 font-weight-bold">Vacations</h1>
      <v-spacer />
      <v-btn variant="text" color="#5E35B1" prepend-icon="mdi-account-multiple-plus-outline" class="mr-1" @click="joinOpen = true">Join</v-btn>
      <v-btn color="#5E35B1" variant="elevated" prepend-icon="mdi-plus" to="/vacations/new">New trip</v-btn>
    </div>

    <v-dialog v-model="joinOpen" max-width="400">
      <v-card rounded="lg">
        <v-card-title class="text-subtitle-1 font-weight-bold">Join a shared trip</v-card-title>
        <v-card-text>
          <p class="text-body-2 text-medium-emphasis mb-3">Enter the invite code someone shared with you.</p>
          <v-text-field v-model="joinCode" label="Invite code" variant="outlined" density="compact" hide-details style="text-transform: uppercase" />
          <v-alert v-if="joinError" type="error" variant="tonal" density="compact" class="mt-2">{{ joinError }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="joinOpen = false">Cancel</v-btn>
          <v-btn color="#5E35B1" variant="elevated" :loading="joining" :disabled="!joinCode.trim()" @click="joinTrip">Join</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <div v-if="loading" class="text-center py-12">
      <v-progress-circular indeterminate color="#5E35B1" />
    </div>

    <template v-else>
      <div v-if="!trips.length" class="text-center py-12">
        <v-icon size="64" color="grey-lighten-1" class="mb-4">mdi-bag-suitcase-outline</v-icon>
        <div class="text-h6 text-medium-emphasis">No trips yet</div>
        <div class="text-body-2 text-medium-emphasis mt-1">Start planning your next getaway</div>
        <v-btn color="#5E35B1" variant="tonal" class="mt-4" prepend-icon="mdi-plus" to="/vacations/new">New trip</v-btn>
      </div>

      <div v-for="group in groups" :key="group.label" class="mb-6">
        <template v-if="group.items.length">
          <div class="group-label text-caption font-weight-bold text-medium-emphasis text-uppercase mb-2">
            {{ group.label }}
          </div>
          <v-card
            v-for="trip in group.items"
            :key="trip._id"
            rounded="lg"
            elevation="1"
            class="mb-2 trip-card"
            @click="router.push(`/vacations/${trip._id}`)"
          >
            <div class="trip-bar" :style="{ background: trip.color || '#5E35B1' }" />
            <v-card-text class="py-3 pl-5">
              <div class="d-flex align-center ga-2">
                <span class="text-h6 font-weight-bold">{{ trip.name }}</span>
                <v-chip size="x-small" :color="statusColor(trip.status)" variant="flat" label>{{ statusLabel(trip.status) }}</v-chip>
              </div>
              <div v-if="trip.destination" class="text-body-2 text-medium-emphasis mt-1">
                <v-icon size="13" class="mr-1">mdi-map-marker-outline</v-icon>{{ trip.destination }}
              </div>
              <div class="text-body-2 text-medium-emphasis mt-1">{{ dateSummary(trip) }}</div>
            </v-card-text>
          </v-card>
        </template>
      </div>
    </template>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { format } from 'date-fns';
import { tripsApi } from '../services/api';
import { openRecord } from '../services/e2ee';
import * as replica from '../services/replica';

const router = useRouter();
const loading = ref(true);
const trips = ref([]);

const joinOpen = ref(false);
const joinCode = ref('');
const joining = ref(false);
const joinError = ref('');

async function joinTrip() {
  joining.value = true;
  joinError.value = '';
  try {
    const { data } = await tripsApi.joinShare(joinCode.value.trim().toUpperCase());
    joinOpen.value = false;
    joinCode.value = '';
    router.push(`/vacations/${data.tripId}`);
  } catch (e) {
    joinError.value = e.response?.data?.error || 'Could not join';
  } finally {
    joining.value = false;
  }
}

const todayStr = new Date().toISOString().slice(0, 10);

function fmt(d) { return d ? format(new Date(d), 'MMM d, yyyy') : null; }

function dateSummary(trip) {
  if (trip.status === 'considering') {
    const n = trip.candidateRanges?.length ?? 0;
    if (!n) return 'No dates chosen yet';
    if (n === 1) return `${fmt(trip.candidateRanges[0].start)} – ${fmt(trip.candidateRanges[0].end)} (option)`;
    return `${n} date options under consideration`;
  }
  if (trip.startDate) {
    const end = trip.endDate && trip.endDate !== trip.startDate ? ` – ${fmt(trip.endDate)}` : '';
    return `${fmt(trip.startDate)}${end}`;
  }
  return 'No dates set';
}

function statusLabel(s) {
  return { considering: 'Considering', booked: 'Booked', completed: 'Past' }[s] ?? s;
}
function statusColor(s) {
  return { considering: '#FB8C00', booked: '#5E35B1', completed: '#757575' }[s] ?? '#757575';
}

// Effective end used for the upcoming/past split (booked trips with no endDate use startDate)
function endStr(trip) {
  const d = trip.endDate || trip.startDate;
  return d ? new Date(d).toISOString().slice(0, 10) : null;
}

const groups = computed(() => {
  const considering = trips.value.filter(t => t.status === 'considering');
  const booked = trips.value.filter(t => t.status === 'booked');
  const upcoming = booked.filter(t => !endStr(t) || endStr(t) >= todayStr);
  const past = trips.value.filter(t => t.status === 'completed' || (t.status === 'booked' && endStr(t) && endStr(t) < todayStr));
  const byStart = (a, b) => new Date(a.startDate || 0) - new Date(b.startDate || 0);
  return [
    { label: 'Considering', items: considering },
    { label: 'Upcoming', items: upcoming.sort(byStart) },
    { label: 'Past', items: past.sort((a, b) => byStart(b, a)) },
  ];
});

async function load() {
  loading.value = true;
  try {
    // Offline-first (Phase 4b): sync the replica, fall back to cache offline,
    // then decrypt content over the plaintext rows.
    const rows = await replica.syncedList('Trip', async () => (await tripsApi.list()).data);
    trips.value = await Promise.all(rows.map((t) => openRecord('Trip', t)));
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.group-label { letter-spacing: 0.08em; padding-left: 4px; }
.trip-card { cursor: pointer; display: flex; overflow: hidden; }
.trip-card:hover { opacity: 0.9; }
.trip-bar { width: 5px; flex-shrink: 0; align-self: stretch; }
</style>
