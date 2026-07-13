<template>
  <v-container class="py-6" style="max-width: 1100px">
    <div class="d-flex align-center mb-1" style="gap: 12px">
      <h1 class="text-h5 font-weight-bold">Content reports</h1>
      <v-chip v-if="openCount" size="small" color="error" variant="tonal">{{ openCount }} open</v-chip>
      <v-spacer />
      <v-btn variant="text" prepend-icon="mdi-refresh" :loading="loading" @click="reload">Refresh</v-btn>
    </div>
    <p class="text-body-2 text-medium-emphasis mb-4">
      AI-generated messages users flagged as objectionable (Apple Guideline 1.2). The reported message
      is shown so it can be reviewed and acted on; triage each one when handled.
    </p>

    <div class="d-flex mb-4" style="gap: 12px; max-width: 420px">
      <v-select
        v-model="statusFilter" :items="STATUS_OPTIONS" label="Status" density="comfortable"
        variant="outlined" hide-details clearable @update:model-value="reload" />
    </div>

    <v-card rounded="lg" variant="outlined">
      <v-card-text>
        <div v-if="loading" class="text-center py-8"><v-progress-circular indeterminate color="primary" /></div>
        <template v-else>
          <div v-for="r in reports" :key="r._id" class="report-row py-3">
            <div class="d-flex align-center mb-1" style="gap: 8px">
              <v-chip size="x-small" variant="tonal" color="primary">{{ r.surface }}</v-chip>
              <v-chip size="x-small" variant="tonal" :color="statusColor(r.status)">{{ r.status }}</v-chip>
              <span class="text-caption text-medium-emphasis">{{ fmt(r.createdAt) }}</span>
              <span class="text-caption text-medium-emphasis">· {{ r.reporterEmail || 'unknown' }}</span>
              <v-spacer />
              <template v-if="r.status !== 'reviewed'">
                <v-btn size="small" variant="text" color="success" :loading="busyId === r._id"
                  @click="setStatus(r, 'reviewed')">Mark reviewed</v-btn>
              </template>
              <template v-if="r.status !== 'dismissed'">
                <v-btn size="small" variant="text" :loading="busyId === r._id"
                  @click="setStatus(r, 'dismissed')">Dismiss</v-btn>
              </template>
              <template v-if="r.status !== 'open'">
                <v-btn size="small" variant="text" :loading="busyId === r._id"
                  @click="setStatus(r, 'open')">Reopen</v-btn>
              </template>
            </div>
            <p v-if="r.reason" class="text-caption text-medium-emphasis mb-1">Reason: {{ r.reason }}</p>
            <div class="report-content text-body-2">{{ r.content || '(no content captured)' }}</div>
          </div>
          <p v-if="!reports.length" class="text-medium-emphasis py-4">No reports.</p>
        </template>

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

const STATUS_OPTIONS = ['open', 'reviewed', 'dismissed'];
const PAGE_SIZE = 50;

const { snack, fromError, success } = useSnackbar();
const loading = ref(true);
const reports = ref([]);
const statusFilter = ref('open');
const page = ref(1);
const total = ref(0);
const openCount = ref(0);
const busyId = ref(null);

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const rangeLabel = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE + 1;
  const end = Math.min(page.value * PAGE_SIZE, total.value);
  return `${start}–${end} of ${total.value}`;
});

function fmt(d) { return d ? new Date(d).toLocaleString() : '—'; }

function statusColor(status) {
  if (status === 'open') return 'error';
  if (status === 'reviewed') return 'success';
  return 'default';
}

function reload() { page.value = 1; load(); }

async function load() {
  loading.value = true;
  try {
    const { data } = await adminApi.moderation({
      status: statusFilter.value || undefined, page: page.value, pageSize: PAGE_SIZE,
    });
    reports.value = data.items;
    total.value = data.total;
    openCount.value = data.openCount;
  } catch (e) {
    fromError(e, 'Failed to load content reports');
  } finally {
    loading.value = false;
  }
}

async function setStatus(report, status) {
  busyId.value = report._id;
  try {
    await adminApi.setReportStatus(report._id, status);
    success(`Marked ${status}.`);
    await load();
  } catch (e) {
    fromError(e, 'Could not update the report');
  } finally {
    busyId.value = null;
  }
}

onMounted(load);
</script>

<style scoped>
.report-row + .report-row { border-top: 1px solid rgba(0, 0, 0, 0.08); }
.report-content {
  white-space: pre-wrap;
  background: rgba(0, 0, 0, 0.03);
  border-radius: 8px;
  padding: 10px 12px;
}
</style>
