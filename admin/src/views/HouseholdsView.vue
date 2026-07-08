<template>
  <v-container class="py-6" style="max-width: 1200px">
    <div class="d-flex align-center mb-4" style="gap: 12px">
      <h1 class="text-h5 font-weight-bold">Households &amp; plans</h1>
      <v-spacer />
      <v-btn variant="text" prepend-icon="mdi-refresh" :loading="loading" @click="load">Refresh</v-btn>
    </div>

    <v-text-field
      v-model="search" placeholder="Search by name or join code" prepend-inner-icon="mdi-magnify"
      density="comfortable" variant="outlined" hide-details clearable class="mb-4" style="max-width: 420px" />

    <v-card rounded="lg" variant="outlined">
      <v-card-text>
        <div v-if="loading" class="text-center py-8"><v-progress-circular indeterminate color="primary" /></div>
        <v-table v-else density="comfortable">
          <thead>
            <tr>
              <th style="width: 40px"></th>
              <th>Household</th>
              <th>Join code</th>
              <th class="text-center">Members</th>
              <th class="text-center">E2EE</th>
              <th style="width: 170px">Plan</th>
              <th class="text-caption" style="min-width: 260px">This week</th>
            </tr>
          </thead>
          <tbody>
            <template v-for="h in filtered" :key="h._id">
              <tr>
                <td>
                  <v-btn :icon="expanded === h._id ? 'mdi-chevron-up' : 'mdi-chevron-down'"
                    size="x-small" variant="text" @click="toggle(h._id)" />
                </td>
                <td class="font-weight-medium">{{ h.name }}</td>
                <td><code>{{ h.joinCode }}</code></td>
                <td class="text-center">{{ h.memberCount ?? '—' }}</td>
                <td class="text-center">
                  <v-chip v-if="h.e2eeActive" size="x-small" color="success" variant="tonal">Live</v-chip>
                  <span v-else class="text-medium-emphasis text-caption">off</span>
                </td>
                <td>
                  <v-select
                    :model-value="h.plan" :items="TIERS" density="compact" variant="outlined" hide-details
                    :loading="savingId === h._id"
                    @update:model-value="v => setPlan(h, v)" />
                </td>
                <td class="text-caption">
                  <span v-for="a in ACTIONS" :key="a.key" class="mr-3">
                    {{ a.short }} <strong>{{ h.usageThisWeek?.[a.key] || 0 }}</strong>
                  </span>
                </td>
              </tr>
              <tr v-if="expanded === h._id">
                <td colspan="7" class="bg-grey-lighten-4">
                  <div class="py-2 px-1">
                    <div class="text-caption text-medium-emphasis mb-2">
                      Weekly usage history (windows reset Wednesdays 5PM ET) · created {{ fmtDate(h.createdAt) }}
                    </div>
                    <template v-if="periodsOf(h).length">
                      <!-- Trend: newest weeks last so the sparkline reads left→right in time. -->
                      <div class="d-flex flex-wrap mb-3" style="gap: 20px">
                        <div v-for="a in ACTIONS" :key="a.key" class="d-flex align-center" style="gap: 6px">
                          <Sparkline :values="seriesOf(h, a.key)" :color="a.color" />
                          <div class="text-caption">
                            <div class="font-weight-medium">{{ a.short }}</div>
                            <div class="text-medium-emphasis">{{ totalOf(h, a.key) }} total</div>
                          </div>
                        </div>
                      </div>
                      <v-table density="compact" class="bg-transparent">
                        <thead>
                          <tr>
                            <th>Week of</th>
                            <th v-for="a in ACTIONS" :key="a.key" class="text-center">{{ a.short }}</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr v-for="p in periodsOf(h)" :key="p">
                            <td>{{ p }}</td>
                            <td v-for="a in ACTIONS" :key="a.key" class="text-center">
                              {{ h.usageHistory[p]?.[a.key] || 0 }}
                            </td>
                          </tr>
                        </tbody>
                      </v-table>
                      <div v-if="chatBreakdown(h).length" class="mt-3">
                        <div class="text-caption font-weight-medium mb-1">Chat by surface (all weeks)</div>
                        <v-chip v-for="b in chatBreakdown(h)" :key="b.surface" size="small" variant="tonal" class="mr-2 mb-1">
                          {{ b.surface }}: {{ b.count }}
                        </v-chip>
                      </div>
                    </template>
                    <div v-else class="text-medium-emphasis text-caption py-2">No usage recorded yet.</div>
                  </div>
                </td>
              </tr>
            </template>
            <tr v-if="!filtered.length">
              <td colspan="7" class="text-medium-emphasis py-4">No households found.</td>
            </tr>
          </tbody>
        </v-table>
        <div class="text-caption text-medium-emphasis mt-3">
          Legend: {{ ACTIONS.map(a => `${a.short} = ${a.label}`).join(' · ') }}
        </div>
      </v-card-text>
    </v-card>

    <SnackbarHost :snack="snack" />
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { monetizationApi } from '../services/api';
import { useSnackbar } from '../composables/useSnackbar';
import SnackbarHost from '../components/SnackbarHost.vue';
import Sparkline from '../components/Sparkline.vue';

const TIERS = ['free', 'premium', 'unlimited'];
// All five metered buckets (the old table showed only the first four).
const ACTIONS = [
  { key: 'chat', short: 'chat', label: 'AI chat (calendar/maintenance/vacation)', color: '#1976d2' },
  { key: 'scan', short: 'scan', label: 'photo/receipt scans', color: '#388e3c' },
  { key: 'generation', short: 'gen', label: 'recipe generation', color: '#f57c00' },
  { key: 'manualParse', short: 'man', label: 'manual parsing', color: '#7b1fa2' },
  { key: 'aiHelper', short: 'help', label: 'AI helpers (grocery/tags)', color: '#00838f' },
];

const { snack, success, fromError } = useSnackbar();
const loading = ref(true);
const savingId = ref(null);
const households = ref([]);
const search = ref('');
const expanded = ref(null);

const filtered = computed(() => {
  const q = (search.value || '').trim().toLowerCase();
  if (!q) return households.value;
  return households.value.filter(
    (h) => h.name.toLowerCase().includes(q) || (h.joinCode || '').toLowerCase().includes(q)
  );
});

// Period keys (ISO date of each window's Wednesday), oldest→newest. Each period
// object holds the coarse counters plus a nested `breakdown` sub-object.
function periodKeys(h) {
  return Object.keys(h.usageHistory || {}).sort();
}
// Newest first for the table.
function periodsOf(h) {
  return periodKeys(h).reverse();
}
// Chronological counts for one action, for the sparkline (oldest→newest).
function seriesOf(h, key) {
  return periodKeys(h).map((p) => h.usageHistory[p]?.[key] || 0);
}
function totalOf(h, key) {
  return seriesOf(h, key).reduce((a, b) => a + b, 0);
}
// Per-surface chat breakdown accumulated across all weeks (from meter() labels).
function chatBreakdown(h) {
  const totals = {};
  for (const p of periodKeys(h)) {
    const byS = h.usageHistory[p]?.breakdown?.chat || {};
    for (const [surface, count] of Object.entries(byS)) totals[surface] = (totals[surface] || 0) + count;
  }
  return Object.entries(totals).map(([surface, count]) => ({ surface, count })).sort((a, b) => b.count - a.count);
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString() : '—';
}

function toggle(id) {
  expanded.value = expanded.value === id ? null : id;
}

async function load() {
  loading.value = true;
  try {
    const { data } = await monetizationApi.households();
    households.value = data;
  } finally {
    loading.value = false;
  }
}

async function setPlan(h, plan) {
  savingId.value = h._id;
  try {
    await monetizationApi.setPlan({ householdId: h._id, plan });
    h.plan = plan;
    success(`${h.name} → ${plan}`);
  } catch (e) {
    fromError(e, 'Failed to update plan');
  } finally {
    savingId.value = null;
  }
}

onMounted(load);
</script>
