<template>
  <v-container class="py-6" style="max-width: 1200px">
    <div class="d-flex align-center mb-1" style="gap: 12px">
      <h1 class="text-h5 font-weight-bold">E2EE ops</h1>
      <v-spacer />
      <v-btn variant="text" prepend-icon="mdi-refresh" :loading="loading" @click="load">Refresh</v-btn>
    </div>
    <p class="text-body-2 text-medium-emphasis mb-4">
      Drop-readiness across the fleet. A household is <strong>ready</strong> when every member has enrolled keys,
      holds a current-version key envelope, and is on a compatible app build.
    </p>

    <div class="d-flex mb-4" style="gap: 12px">
      <v-chip color="success" variant="tonal">Live: {{ stats.live }}</v-chip>
      <v-chip color="primary" variant="tonal">Ready to drop: {{ stats.ready }}</v-chip>
      <v-chip color="warning" variant="tonal">Not ready: {{ stats.notReady }}</v-chip>
    </div>

    <v-card rounded="lg" variant="outlined">
      <v-card-text>
        <div v-if="loading" class="text-center py-8"><v-progress-circular indeterminate color="primary" /></div>
        <v-table v-else density="comfortable">
          <thead>
            <tr>
              <th>Household</th>
              <th>Join code</th>
              <th class="text-center">HDK ver</th>
              <th class="text-center">Enrolled</th>
              <th class="text-center">Status</th>
              <th class="text-right"></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in rows" :key="h._id">
              <td class="font-weight-medium">{{ h.name }}</td>
              <td><code>{{ h.joinCode }}</code></td>
              <td class="text-center">{{ h.currentKeyVersion }}</td>
              <td class="text-center">{{ h.enrolled }} / {{ h.total }}</td>
              <td class="text-center">
                <v-chip v-if="h.e2eeActive" size="small" color="success" variant="flat">Live</v-chip>
                <v-chip v-else-if="h.ready" size="small" color="primary" variant="tonal">Ready</v-chip>
                <v-chip v-else size="small" color="warning" variant="tonal">{{ h.blockers }} blocker{{ h.blockers === 1 ? '' : 's' }}</v-chip>
              </td>
              <td class="text-right">
                <v-btn size="small" variant="text" @click="openDetail(h)">Details</v-btn>
              </td>
            </tr>
            <tr v-if="!rows.length">
              <td colspan="6" class="text-medium-emphasis py-4">No households found.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>

    <v-dialog v-model="detail.show" max-width="720">
      <v-card rounded="lg">
        <v-card-title class="d-flex align-center">
          {{ detail.data?.name }}
          <v-spacer />
          <v-chip v-if="detail.data?.ready" size="small" color="primary" variant="tonal">Ready</v-chip>
          <v-chip v-else size="small" color="warning" variant="tonal">Not ready</v-chip>
        </v-card-title>
        <v-card-text>
          <div v-if="detail.loading" class="text-center py-6"><v-progress-circular indeterminate color="primary" /></div>
          <template v-else-if="detail.data">
            <v-table density="compact" class="mb-4">
              <thead>
                <tr><th>Member</th><th class="text-center">Enrolled</th><th class="text-center">Key</th><th>App</th></tr>
              </thead>
              <tbody>
                <tr v-for="m in detail.data.members" :key="m._id">
                  <td>
                    {{ m.email }}
                    <v-chip v-if="m.isOwner" size="x-small" variant="tonal" class="ml-1">owner</v-chip>
                  </td>
                  <td class="text-center">
                    <v-icon :icon="m.enrolled ? 'mdi-check-circle' : 'mdi-close-circle'"
                      :color="m.enrolled ? 'success' : 'error'" size="small" />
                  </td>
                  <td class="text-center">
                    <v-icon :icon="m.keyCurrent ? 'mdi-check-circle' : 'mdi-alert-circle'"
                      :color="m.keyCurrent ? 'success' : 'warning'" size="small" />
                    <span class="text-caption ml-1">{{ m.keyVersion ?? '—' }}</span>
                  </td>
                  <td class="text-caption">{{ m.clientVersion || '—' }}<span v-if="m.clientPlatform" class="text-medium-emphasis"> ({{ m.clientPlatform }})</span></td>
                </tr>
              </tbody>
            </v-table>
            <div v-if="detail.data.reasons?.length">
              <div class="text-subtitle-2 mb-1">Blockers</div>
              <v-alert v-for="(r, i) in detail.data.reasons" :key="i" type="warning" variant="tonal" density="compact" class="mb-1">
                {{ r }}
              </v-alert>
            </div>
            <v-alert v-else type="success" variant="tonal" density="compact">All members ready — safe to drop plaintext.</v-alert>
          </template>
        </v-card-text>
        <v-card-actions>
          <v-btn v-if="detail.data && !detail.data.ready" color="primary" variant="tonal"
            prepend-icon="mdi-bell-ring" :loading="nudging" @click="nudge">
            Nudge blocking members
          </v-btn>
          <v-spacer />
          <v-btn variant="text" @click="detail.show = false">Close</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <SnackbarHost :snack="snack" :timeout="3500" />
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { adminApi } from '../services/api';
import { useSnackbar } from '../composables/useSnackbar';
import SnackbarHost from '../components/SnackbarHost.vue';

const { snack, notify, success, fromError } = useSnackbar();
const loading = ref(true);
const rows = ref([]);
const nudging = ref(false);
const detail = ref({ show: false, loading: false, data: null });

const stats = computed(() => ({
  live: rows.value.filter((h) => h.e2eeActive).length,
  ready: rows.value.filter((h) => !h.e2eeActive && h.ready).length,
  notReady: rows.value.filter((h) => !h.e2eeActive && !h.ready).length,
}));

async function load() {
  loading.value = true;
  try {
    const { data } = await adminApi.e2ee();
    // Not-ready first, then ready, then live — the migration to-do order.
    rows.value = data.sort((a, b) => rank(a) - rank(b));
  } catch (e) {
    fromError(e, 'Failed to load');
  } finally {
    loading.value = false;
  }
}

function rank(h) {
  if (h.e2eeActive) return 2;
  return h.ready ? 1 : 0;
}

async function openDetail(h) {
  detail.value = { show: true, loading: true, data: null };
  try {
    const { data } = await adminApi.e2eeDetail(h._id);
    detail.value.data = data;
  } catch (e) {
    fromError(e, 'Failed to load details');
    detail.value.show = false;
  } finally {
    detail.value.loading = false;
  }
}

async function nudge() {
  const h = detail.value.data;
  if (!h) return;
  nudging.value = true;
  try {
    const { data } = await adminApi.nudge(h._id);
    if (data.blocking === 0) notify('No blocking members to nudge.', 'info');
    else if (data.notified === 0) notify(`${data.blocking} blocking, but none had push enabled.`, 'warning');
    else success(`Nudged ${data.notified} of ${data.blocking} blocking member(s).`);
  } catch (e) {
    fromError(e, 'Failed to send nudge');
  } finally {
    nudging.value = false;
  }
}

onMounted(load);
</script>
