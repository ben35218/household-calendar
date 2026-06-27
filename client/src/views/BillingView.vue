<template>
  <v-container class="py-6" style="max-width: 760px">
    <div class="d-flex align-center mb-4">
      <BackButton />
      <h1 class="text-h5 font-weight-bold ml-3">Plan &amp; usage</h1>
    </div>

    <div v-if="loading" class="text-center py-12"><v-progress-circular indeterminate color="primary" /></div>

    <template v-else-if="status">
      <!-- Current plan + usage -->
      <v-card rounded="lg" variant="outlined" class="mb-5">
        <v-card-text>
          <div class="d-flex align-center mb-3">
            <div>
              <div class="text-caption text-medium-emphasis">Current plan</div>
              <div class="text-h6 font-weight-bold">{{ status.planLabel }}</div>
            </div>
          </div>

          <div class="text-caption text-medium-emphasis mb-1">This month’s usage</div>
          <div v-for="a in USAGE_ACTIONS" :key="a.key" class="mb-2">
            <div class="d-flex justify-space-between text-body-2">
              <span>{{ a.label }}</span>
              <span>{{ used(a.key) }}<span v-if="quota(a.key) != null"> / {{ quota(a.key) }}</span><span v-else> / ∞</span></span>
            </div>
            <v-progress-linear :model-value="pct(a.key)" :color="pct(a.key) >= 100 ? 'error' : 'primary'" height="6" rounded class="mt-1" />
          </div>
        </v-card-text>
      </v-card>

      <!-- Model note -->
      <v-alert type="info" variant="tonal" density="comfortable" class="mb-5">
        <template v-if="status.plan === 'free'">
          Free uses our <strong>fast assistant</strong> ({{ modelLabel(status.models.freeChat) }}).
          Premium &amp; Unlimited unlock our <strong>smartest assistant</strong> ({{ modelLabel(status.models.paidChat) }}) for noticeably better answers.
        </template>
        <template v-else>
          You’re on our <strong>smartest assistant</strong> ({{ modelLabel(status.models.paidChat) }}).
        </template>
      </v-alert>

      <!-- Plan catalog -->
      <div class="d-flex flex-wrap" style="gap: 16px">
        <v-card v-for="t in status.catalog" :key="t.key" class="flex-1-1" rounded="lg"
                :variant="t.key === status.plan ? 'tonal' : 'outlined'"
                :color="t.key === status.plan ? 'primary' : undefined" style="min-width: 220px">
          <v-card-text>
            <div class="text-subtitle-1 font-weight-bold">{{ t.label }}</div>
            <div class="text-h6 my-1">{{ t.price > 0 ? '$' + t.price.toFixed(2) : 'Free' }}<span v-if="t.price > 0" class="text-caption">/mo</span></div>
            <ul class="text-body-2 text-medium-emphasis mb-3 pl-4">
              <li>Chat: {{ q(t.quotas.chat) }}</li>
              <li>Scans: {{ q(t.quotas.scan) }}</li>
              <li>Recipes: {{ q(t.quotas.generation) }}</li>
              <li>Manuals: {{ q(t.quotas.manualParse) }}</li>
            </ul>
            <v-btn v-if="t.key === status.plan" block variant="flat" color="primary" disabled>Current plan</v-btn>
            <v-btn v-else block color="primary" :loading="busy === t.key" :disabled="!status.hasHousehold" @click="select(t.key)">
              {{ t.price === 0 ? 'Switch to Free' : (rank(t.key) > rank(status.plan) ? 'Upgrade' : 'Switch') }}
            </v-btn>
          </v-card-text>
        </v-card>
      </div>

      <p v-if="!status.hasHousehold" class="text-caption text-medium-emphasis mt-4">
        Join or create a household to choose a plan.
      </p>
      <p class="text-caption text-medium-emphasis mt-4">
        Payments aren’t collected here yet — plan changes apply instantly. Billing will be handled in the mobile app.
      </p>
    </template>
  </v-container>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { billingApi } from '../services/api';
import { useSnackbar } from '../composables/useSnackbar';
import BackButton from '../components/BackButton.vue';

const { success, error: notifyError } = useSnackbar();

const TIERS = ['free', 'premium', 'unlimited'];
const USAGE_ACTIONS = [
  { key: 'chat', label: 'AI chat messages' },
  { key: 'scan', label: 'Photo / receipt scans' },
  { key: 'generation', label: 'Recipe & meal generation' },
  { key: 'manualParse', label: 'Manual lookups' },
];

const loading = ref(true);
const busy = ref('');
const status = ref(null);

const used  = (k) => status.value?.usage?.[k] || 0;
const quota = (k) => { const v = status.value?.quotas?.[k]; return v === undefined ? null : v; };
const pct   = (k) => { const lim = quota(k); return lim ? Math.min(100, Math.round((used(k) / lim) * 100)) : 0; };
const q     = (v) => (v === null || v === undefined ? 'Unlimited' : v + '/mo');
const rank  = (key) => TIERS.indexOf(key);

function modelLabel(id = '') {
  if (id.includes('haiku')) return 'Haiku';
  if (id.includes('sonnet')) return 'Sonnet';
  if (id.includes('opus')) return 'Opus';
  return id;
}

async function load() {
  loading.value = true;
  try {
    const { data } = await billingApi.status();
    status.value = data;
  } finally {
    loading.value = false;
  }
}

async function select(tier) {
  busy.value = tier;
  try {
    await billingApi.select(tier);
    await load();
    success(`You’re now on ${status.value.planLabel}.`);
  } catch (e) {
    notifyError(e.response?.data?.error || 'Could not change plan');
  } finally {
    busy.value = '';
  }
}

onMounted(load);
</script>

<style scoped>
.flex-1-1 { flex: 1 1 0; }
</style>
