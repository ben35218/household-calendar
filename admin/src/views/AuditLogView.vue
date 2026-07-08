<template>
  <v-container class="py-6" style="max-width: 1100px">
    <div class="d-flex align-center mb-1" style="gap: 12px">
      <h1 class="text-h5 font-weight-bold">Audit log</h1>
      <v-spacer />
      <v-btn variant="text" prepend-icon="mdi-refresh" :loading="loading" @click="reload">Refresh</v-btn>
    </div>
    <p class="text-body-2 text-medium-emphasis mb-4">
      E2EE key &amp; membership lifecycle plus sensitive admin actions (role &amp; plan changes).
      Content is never logged — only who did what, and when.
    </p>

    <div class="d-flex mb-4" style="gap: 12px; max-width: 420px">
      <v-select
        v-model="eventFilter" :items="EVENT_OPTIONS" label="Event type" density="comfortable"
        variant="outlined" hide-details clearable @update:model-value="reload" />
    </div>

    <v-card rounded="lg" variant="outlined">
      <v-card-text>
        <div v-if="loading" class="text-center py-8"><v-progress-circular indeterminate color="primary" /></div>
        <v-table v-else density="comfortable">
          <thead>
            <tr>
              <th style="width: 180px">When</th>
              <th>Event</th>
              <th>Household</th>
              <th>Actor</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="l in logs" :key="l._id">
              <td class="text-caption">{{ fmt(l.at) }}</td>
              <td><v-chip size="small" :color="color(l.event)" variant="tonal">{{ l.event }}</v-chip></td>
              <td>{{ l.householdName || '—' }}</td>
              <td class="text-caption">{{ l.userEmail || '—' }}</td>
              <td class="text-caption text-medium-emphasis">{{ metaStr(l.meta) }}</td>
            </tr>
            <tr v-if="!logs.length">
              <td colspan="5" class="text-medium-emphasis py-4">No audit events.</td>
            </tr>
          </tbody>
        </v-table>

        <div class="d-flex align-center mt-3" v-if="total">
          <span class="text-caption text-medium-emphasis">{{ rangeLabel }}</span>
          <v-spacer />
          <v-pagination v-model="page" :length="pageCount" :total-visible="5" density="comfortable"
            @update:model-value="load" />
        </div>
      </v-card-text>
    </v-card>

    <SnackbarHost :snack="snack" />
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { adminApi } from '../services/api';
import { useSnackbar } from '../composables/useSnackbar';
import SnackbarHost from '../components/SnackbarHost.vue';

const EVENT_OPTIONS = [
  'hdk_minted', 'member_approved', 'hdk_rotated', 'key_enrolled',
  'deletion_scheduled', 'deletion_canceled', 'deletion_purged', 'plaintext_dropped',
  'admin_role_changed', 'plan_changed',
];
const PAGE_SIZE = 50;

const { snack, fromError } = useSnackbar();
const loading = ref(true);
const logs = ref([]);
const eventFilter = ref(null);
const page = ref(1);
const total = ref(0);

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const rangeLabel = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE + 1;
  const end = Math.min(page.value * PAGE_SIZE, total.value);
  return `${start}–${end} of ${total.value}`;
});

function fmt(d) { return d ? new Date(d).toLocaleString() : '—'; }

function metaStr(meta) {
  if (!meta || !Object.keys(meta).length) return '';
  return Object.entries(meta).map(([k, v]) => `${k}: ${v}`).join(', ');
}

function color(event) {
  if (event === 'plaintext_dropped') return 'success';
  if (event === 'plan_changed' || event === 'admin_role_changed') return 'orange';
  if (event.startsWith('deletion')) return 'error';
  if (event.startsWith('hdk') || event === 'key_enrolled') return 'primary';
  return 'default';
}

function reload() { page.value = 1; load(); }

async function load() {
  loading.value = true;
  try {
    const { data } = await adminApi.audit({
      event: eventFilter.value || undefined, page: page.value, pageSize: PAGE_SIZE,
    });
    logs.value = data.items;
    total.value = data.total;
  } catch (e) {
    fromError(e, 'Failed to load audit log');
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>
