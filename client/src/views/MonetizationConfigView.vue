<template>
  <v-container class="py-6" style="max-width: 1100px">
    <v-alert type="warning" variant="tonal" density="comfortable" class="mb-5">
      <strong>Temporary admin page — no authentication.</strong>
      This will move into a separate, secured admin app before go-live. Don’t expose it publicly.
    </v-alert>

    <h1 class="text-h5 font-weight-bold mb-1">Monetization config</h1>
    <p class="text-body-2 text-medium-emphasis mb-6">
      Single source of truth for tier prices, quotas, per-call costs, models, and the activity curve.
      Edits take effect on the server within ~30s of saving.
    </p>

    <div v-if="loading" class="text-center py-12"><v-progress-circular indeterminate color="primary" /></div>

    <template v-else-if="config">
      <!-- ===================== TIERS ===================== -->
      <v-card class="mb-5" rounded="lg" variant="outlined">
        <v-card-title class="text-subtitle-1 font-weight-bold">Tiers, prices &amp; quotas</v-card-title>
        <v-card-text>
          <div class="tier-grid">
            <div class="th"></div>
            <div v-for="t in TIERS" :key="'h'+t" class="th text-capitalize">{{ t }}</div>

            <div class="rl">Label</div>
            <v-text-field v-for="t in TIERS" :key="'lbl'+t" v-model="config.tiers[t].label" density="compact" variant="outlined" hide-details />

            <div class="rl">Price ($/mo)</div>
            <v-text-field v-for="t in TIERS" :key="'pr'+t" v-model.number="config.tiers[t].price" type="number" step="0.01" density="compact" variant="outlined" hide-details />

            <template v-for="a in ACTIONS" :key="'row'+a">
              <div class="rl">{{ actionLabel(a) }} quota</div>
              <v-text-field
                v-for="t in TIERS" :key="a+t"
                :model-value="quotaDisplay(config.tiers[t].quotas[a])"
                @update:model-value="v => setQuota(t, a, v)"
                placeholder="∞" density="compact" variant="outlined" hide-details />
            </template>
          </div>
          <p class="text-caption text-medium-emphasis mt-2">Leave a quota blank for unlimited. Helper calls are tracked but unlimited by default.</p>
        </v-card-text>
      </v-card>

      <!-- ===================== COSTS / MODELS / MISC ===================== -->
      <div class="d-flex flex-wrap" style="gap: 16px">
        <v-card class="flex-1-1" rounded="lg" variant="outlined" style="min-width: 320px">
          <v-card-title class="text-subtitle-1 font-weight-bold">Per-call cost to us ($)</v-card-title>
          <v-card-text>
            <v-text-field v-for="(_, k) in config.costs" :key="k" v-model.number="config.costs[k]" :label="k" type="number" step="0.001" density="compact" variant="outlined" class="mb-1" hide-details />
          </v-card-text>
        </v-card>

        <v-card class="flex-1-1" rounded="lg" variant="outlined" style="min-width: 320px">
          <v-card-title class="text-subtitle-1 font-weight-bold">Models, fees &amp; guards</v-card-title>
          <v-card-text>
            <v-text-field v-model="config.models.freeChat" label="Free-tier chat model" density="compact" variant="outlined" class="mb-1" hide-details />
            <v-text-field v-model="config.models.paidChat" label="Paid-tier chat model" density="compact" variant="outlined" class="mb-3" hide-details />
            <v-text-field v-model.number="config.fees.pct" label="Processor fee %" type="number" step="0.1" density="compact" variant="outlined" class="mb-1" hide-details />
            <v-text-field v-model.number="config.fees.flat" label="Processor flat fee $" type="number" step="0.01" density="compact" variant="outlined" class="mb-1" hide-details />
            <v-text-field v-model.number="config.guards.mapsPerDay" label="Maps calls / household / day" type="number" density="compact" variant="outlined" hide-details />
          </v-card-text>
        </v-card>
      </div>

      <!-- ===================== ACTIVITY CURVE ===================== -->
      <v-card class="my-5" rounded="lg" variant="outlined">
        <v-card-title class="text-subtitle-1 font-weight-bold">Activity curve (calls / household / month)</v-card-title>
        <v-card-text>
          <v-text-field v-model.number="config.activity.heavyMonths" label="Heavy (onboarding) months" type="number" density="compact" variant="outlined" style="max-width: 240px" class="mb-3" hide-details />
          <div v-for="phase in ['heavy','steady']" :key="phase" class="mb-4">
            <div class="text-subtitle-2 text-capitalize mb-2">{{ phase }} months</div>
            <div class="tier-grid">
              <div class="th"></div>
              <div v-for="t in TIERS" :key="phase+'h'+t" class="th text-capitalize">{{ t }}</div>
              <template v-for="a in PROJ_ACTIONS" :key="phase+a">
                <div class="rl">{{ actionLabel(a) }}</div>
                <v-text-field v-for="t in TIERS" :key="phase+a+t" v-model.number="config.activity[phase][t][a]" type="number" density="compact" variant="outlined" hide-details />
              </template>
            </div>
          </div>
        </v-card-text>
      </v-card>

      <!-- ===================== PROJECTION ===================== -->
      <v-card class="mb-5" rounded="lg" variant="tonal" color="primary">
        <v-card-title class="text-subtitle-1 font-weight-bold">Year-1 projection (per household)</v-card-title>
        <v-card-text>
          <v-table density="comfortable" class="bg-transparent">
            <thead>
              <tr><th>Tier</th><th class="text-right">Heavy mo. profit</th><th class="text-right">Steady mo. profit</th><th class="text-right">Year-1 profit</th><th class="text-right">Margin</th></tr>
            </thead>
            <tbody>
              <tr v-for="p in projection" :key="p.tier">
                <td class="text-capitalize font-weight-medium">{{ p.tier }}</td>
                <td class="text-right">{{ money(p.heavyProfit) }}</td>
                <td class="text-right">{{ money(p.steadyProfit) }}</td>
                <td class="text-right font-weight-bold">{{ money(p.annualProfit) }}</td>
                <td class="text-right">{{ p.margin == null ? '—' : p.margin + '%' }}</td>
              </tr>
            </tbody>
          </v-table>
          <p class="text-caption mt-1">Projection only — uses the per-call costs and activity curve above. Not used for billing.</p>
        </v-card-text>
      </v-card>

      <div class="d-flex align-center mb-8" style="gap: 12px">
        <v-btn color="primary" :loading="saving" @click="save">Save config</v-btn>
        <span v-if="savedAt" class="text-caption text-success">Saved {{ savedAt }}</span>
      </div>

      <!-- ===================== HOUSEHOLD PLAN OVERRIDE ===================== -->
      <v-card rounded="lg" variant="outlined">
        <v-card-title class="text-subtitle-1 font-weight-bold">Household plans (testing)</v-card-title>
        <v-card-text>
          <v-table density="comfortable">
            <thead>
              <tr><th>Household</th><th>Join code</th><th>Plan</th><th>This week (chat/scan/gen/manual)</th><th></th></tr>
            </thead>
            <tbody>
              <tr v-for="h in households" :key="h._id">
                <td>{{ h.name }}</td>
                <td><code>{{ h.joinCode }}</code></td>
                <td style="max-width: 160px">
                  <v-select :model-value="h.plan" :items="TIERS" density="compact" variant="outlined" hide-details
                            @update:model-value="v => setHouseholdPlan(h, v)" />
                </td>
                <td class="text-caption">
                  {{ h.usageThisWeek.chat||0 }} / {{ h.usageThisWeek.scan||0 }} / {{ h.usageThisWeek.generation||0 }} / {{ h.usageThisWeek.manualParse||0 }}
                </td>
                <td></td>
              </tr>
              <tr v-if="!households.length"><td colspan="5" class="text-medium-emphasis">No households yet.</td></tr>
            </tbody>
          </v-table>
        </v-card-text>
      </v-card>
    </template>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { monetizationApi } from '../services/api';

const TIERS = ['free', 'premium', 'unlimited'];
const ACTIONS = ['chat', 'scan', 'generation', 'manualParse', 'aiHelper'];
const PROJ_ACTIONS = ['chat', 'scan', 'generation', 'manualParse'];

const loading = ref(true);
const saving = ref(false);
const savedAt = ref('');
const config = ref(null);
const households = ref([]);

function actionLabel(a) {
  return { chat: 'Chat', scan: 'Scan', generation: 'Generation', manualParse: 'Manual parse', aiHelper: 'AI helper' }[a] || a;
}
function quotaDisplay(v) { return v === null || v === undefined ? '' : String(v); }
function setQuota(tier, action, v) {
  const trimmed = String(v).trim();
  config.value.tiers[tier].quotas[action] = trimmed === '' ? null : Number(trimmed);
}

const money = (n) => (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2);

const projection = computed(() => {
  if (!config.value) return [];
  const c = config.value;
  const heavyMonths = Number(c.activity.heavyMonths) || 0;
  const steadyMonths = 12 - heavyMonths;
  const costOf = (tier, calls) => {
    const chatCost = tier === 'free' ? c.costs.haikuChat : c.costs.sonnetChat;
    return (calls.chat || 0) * chatCost
      + (calls.scan || 0) * c.costs.scan
      + (calls.generation || 0) * c.costs.generation
      + (calls.manualParse || 0) * c.costs.manualParse
      + Number(c.costs.mapsMonthly || 0);
  };
  return TIERS.map((tier) => {
    const price = Number(c.tiers[tier].price) || 0;
    const net = price > 0 ? price - (price * (c.fees.pct / 100) + Number(c.fees.flat)) : 0;
    const heavyCost = costOf(tier, c.activity.heavy[tier]);
    const steadyCost = costOf(tier, c.activity.steady[tier]);
    const heavyProfit = net - heavyCost;
    const steadyProfit = net - steadyCost;
    const annualRevenue = net * 12;
    const annualCost = heavyMonths * heavyCost + steadyMonths * steadyCost;
    const annualProfit = annualRevenue - annualCost;
    const margin = annualRevenue > 0 ? Math.round((annualProfit / annualRevenue) * 100) : null;
    return { tier, heavyProfit, steadyProfit, annualProfit, margin };
  });
});

async function load() {
  loading.value = true;
  try {
    const [{ data: cfg }, { data: hh }] = await Promise.all([
      monetizationApi.get(),
      monetizationApi.households(),
    ]);
    config.value = cfg;
    households.value = hh;
  } finally {
    loading.value = false;
  }
}

async function save() {
  saving.value = true;
  try {
    const { tiers, costs, models, activity, fees, guards } = config.value;
    await monetizationApi.update({ tiers, costs, models, activity, fees, guards });
    savedAt.value = new Date().toLocaleTimeString();
  } finally {
    saving.value = false;
  }
}

async function setHouseholdPlan(h, plan) {
  await monetizationApi.setPlan({ householdId: h._id, plan });
  h.plan = plan;
}

onMounted(load);
</script>

<style scoped>
.tier-grid {
  display: grid;
  grid-template-columns: 160px repeat(3, 1fr);
  gap: 8px 12px;
  align-items: center;
}
.tier-grid .th { font-weight: 600; font-size: 0.85rem; }
.tier-grid .rl { font-size: 0.85rem; color: rgba(0,0,0,0.6); }
.flex-1-1 { flex: 1 1 0; }
</style>
