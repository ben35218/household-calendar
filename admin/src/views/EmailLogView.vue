<template>
  <v-container class="py-6" style="max-width: 1100px">
    <div class="d-flex align-center mb-1" style="gap: 12px">
      <h1 class="text-h5 font-weight-bold">Email log</h1>
      <v-spacer />
      <v-btn variant="text" prepend-icon="mdi-refresh" :loading="loading" @click="reload">Refresh</v-btn>
    </div>
    <p class="text-body-2 text-medium-emphasis mb-4">
      Every email sent from no-reply@householdcalendar.com — invites, password resets, and
      storage-lifecycle notices. Bodies aren't stored; "dry" means SMTP wasn't configured when the
      send was attempted.
    </p>

    <div class="d-flex mb-4 flex-wrap" style="gap: 12px">
      <v-text-field
        v-model="q" label="Recipient or subject" density="comfortable" variant="outlined"
        hide-details clearable style="max-width: 320px" prepend-inner-icon="mdi-magnify"
        @keyup.enter="reload" @click:clear="reload" />
      <v-select
        v-model="statusFilter" :items="STATUS_OPTIONS" label="Status" density="comfortable"
        variant="outlined" hide-details clearable style="max-width: 180px" @update:model-value="reload" />
      <v-select
        v-model="kindFilter" :items="KIND_OPTIONS" label="Type" density="comfortable"
        variant="outlined" hide-details clearable style="max-width: 220px" @update:model-value="reload" />
    </div>

    <v-card rounded="lg" variant="outlined">
      <v-card-text>
        <div v-if="loading" class="text-center py-8"><v-progress-circular indeterminate color="primary" /></div>
        <v-table v-else density="comfortable">
          <thead>
            <tr>
              <th style="width: 180px">When</th>
              <th>To</th>
              <th>Subject</th>
              <th style="width: 160px">Type</th>
              <th style="width: 100px">Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="e in items" :key="e._id">
              <td class="text-caption">{{ fmt(e.at) }}</td>
              <td class="text-caption">{{ e.to }}</td>
              <td>
                {{ e.subject }}
                <div v-if="e.error" class="text-caption text-error">{{ e.error }}</div>
              </td>
              <td><v-chip size="small" variant="tonal">{{ e.kind }}</v-chip></td>
              <td><v-chip size="small" :color="statusColor(e.status)" variant="tonal">{{ e.status }}</v-chip></td>
            </tr>
            <tr v-if="!items.length">
              <td colspan="5" class="text-medium-emphasis py-4">No emails logged yet.</td>
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
import { emailApi } from '../services/api';
import { useSnackbar } from '../composables/useSnackbar';
import SnackbarHost from '../components/SnackbarHost.vue';

const STATUS_OPTIONS = ['sent', 'failed', 'dry'];
const KIND_OPTIONS = [
  'password_reset', 'event_invitation', 'trip_invite', 'recipe_share',
  'deletion_scheduled', 'deletion_canceled', 'deletion_purged', 'other',
];
const PAGE_SIZE = 50;

const { snack, fromError } = useSnackbar();
const loading = ref(true);
const items = ref([]);
const q = ref('');
const statusFilter = ref(null);
const kindFilter = ref(null);
const page = ref(1);
const total = ref(0);

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const rangeLabel = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE + 1;
  const end = Math.min(page.value * PAGE_SIZE, total.value);
  return `${start}–${end} of ${total.value}`;
});

function fmt(d) { return d ? new Date(d).toLocaleString() : '—'; }

function statusColor(status) {
  if (status === 'sent') return 'success';
  if (status === 'failed') return 'error';
  return 'default'; // dry
}

function reload() { page.value = 1; load(); }

async function load() {
  loading.value = true;
  try {
    const { data } = await emailApi.log({
      q: q.value || undefined,
      status: statusFilter.value || undefined,
      kind: kindFilter.value || undefined,
      page: page.value, pageSize: PAGE_SIZE,
    });
    items.value = data.items;
    total.value = data.total;
  } catch (e) {
    fromError(e, 'Failed to load email log');
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>
