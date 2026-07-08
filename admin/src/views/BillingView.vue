<template>
  <v-container class="py-6" style="max-width: 1100px">
    <div class="d-flex align-center mb-1" style="gap: 12px">
      <h1 class="text-h5 font-weight-bold">Billing</h1>
      <v-spacer />
      <v-btn variant="text" prepend-icon="mdi-refresh" :loading="loading" @click="load">Refresh</v-btn>
    </div>
    <p class="text-body-2 text-medium-emphasis mb-4">
      Subscription state per household. <strong>RevenueCat</strong> = plan driven by a real subscription/webhook;
      <strong>Manual</strong> = an admin override with no linked subscription. Payments are handled in the mobile
      app — this view is read-only.
    </p>

    <div class="d-flex flex-wrap mb-4" style="gap: 12px">
      <v-chip variant="tonal">Total: {{ households.length }}</v-chip>
      <v-chip color="primary" variant="tonal">Paid: {{ stats.paid }}</v-chip>
      <v-chip color="success" variant="tonal">RevenueCat-linked: {{ stats.revenuecat }}</v-chip>
      <v-chip color="warning" variant="tonal">Manual overrides: {{ stats.manual }}</v-chip>
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
              <th>Plan</th>
              <th>Billing source</th>
              <th>RevenueCat ID</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="h in filtered" :key="h._id">
              <td class="font-weight-medium">{{ h.name }}</td>
              <td><code>{{ h.joinCode }}</code></td>
              <td>
                <v-chip size="small" :color="h.plan === 'free' ? 'default' : 'primary'" variant="tonal">{{ h.plan }}</v-chip>
              </td>
              <td>
                <v-chip size="small" :color="h.billingSource === 'revenuecat' ? 'success' : 'warning'" variant="tonal">
                  {{ h.billingSource === 'revenuecat' ? 'RevenueCat' : 'Manual' }}
                </v-chip>
              </td>
              <td class="text-caption">
                <code v-if="h.revenueCatId">{{ h.revenueCatId }}</code>
                <span v-else class="text-medium-emphasis">—</span>
              </td>
            </tr>
            <tr v-if="!filtered.length">
              <td colspan="5" class="text-medium-emphasis py-4">No households found.</td>
            </tr>
          </tbody>
        </v-table>
      </v-card-text>
    </v-card>

    <v-alert type="info" variant="tonal" density="comfortable" class="mt-4">
      When RevenueCat webhooks are live, paid plans will flip automatically and appear here as
      "RevenueCat". Until then, plans set from <em>Households &amp; plans</em> show as "Manual".
    </v-alert>

    <SnackbarHost :snack="snack" />
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { monetizationApi } from '../services/api';
import { useSnackbar } from '../composables/useSnackbar';
import SnackbarHost from '../components/SnackbarHost.vue';

const { snack, fromError } = useSnackbar();
const loading = ref(true);
const households = ref([]);
const search = ref('');

const filtered = computed(() => {
  const q = (search.value || '').trim().toLowerCase();
  if (!q) return households.value;
  return households.value.filter(
    (h) => h.name.toLowerCase().includes(q) || (h.joinCode || '').toLowerCase().includes(q)
  );
});

const stats = computed(() => ({
  paid: households.value.filter((h) => h.plan && h.plan !== 'free').length,
  revenuecat: households.value.filter((h) => h.billingSource === 'revenuecat').length,
  manual: households.value.filter((h) => h.plan !== 'free' && h.billingSource === 'manual').length,
}));

async function load() {
  loading.value = true;
  try {
    const { data } = await monetizationApi.households();
    households.value = data;
  } catch (e) {
    fromError(e, 'Failed to load billing data');
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>
