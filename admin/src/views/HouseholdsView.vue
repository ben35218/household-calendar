<template>
  <v-container class="py-6" style="max-width: 1100px">
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
              <th>Household</th>
              <th>Join code</th>
              <th style="width: 180px">Plan</th>
              <th class="text-caption">This week (chat / scan / gen / manual)</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in filtered" :key="h._id">
              <td class="font-weight-medium">{{ h.name }}</td>
              <td><code>{{ h.joinCode }}</code></td>
              <td>
                <v-select
                  :model-value="h.plan" :items="TIERS" density="compact" variant="outlined" hide-details
                  :loading="savingId === h._id"
                  @update:model-value="v => setPlan(h, v)" />
              </td>
              <td class="text-caption">
                {{ h.usageThisWeek.chat || 0 }} / {{ h.usageThisWeek.scan || 0 }} /
                {{ h.usageThisWeek.generation || 0 }} / {{ h.usageThisWeek.manualParse || 0 }}
              </td>
            </tr>
            <tr v-if="!filtered.length">
              <td colspan="4" class="text-medium-emphasis py-4">No households found.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>

    <v-snackbar v-model="snack.show" :color="snack.color" timeout="2500">{{ snack.text }}</v-snackbar>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { monetizationApi } from '../services/api';

const TIERS = ['free', 'premium', 'unlimited'];

const loading = ref(true);
const savingId = ref(null);
const households = ref([]);
const search = ref('');
const snack = ref({ show: false, text: '', color: 'success' });

const filtered = computed(() => {
  const q = (search.value || '').trim().toLowerCase();
  if (!q) return households.value;
  return households.value.filter(
    (h) => h.name.toLowerCase().includes(q) || (h.joinCode || '').toLowerCase().includes(q)
  );
});

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
    snack.value = { show: true, text: `${h.name} → ${plan}`, color: 'success' };
  } catch (e) {
    snack.value = { show: true, text: e.response?.data?.error || 'Failed to update plan', color: 'error' };
  } finally {
    savingId.value = null;
  }
}

onMounted(load);
</script>
