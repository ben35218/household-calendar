<template>
  <v-container class="py-6" style="max-width: 1100px">
    <div class="d-flex align-center mb-4" style="gap: 12px">
      <h1 class="text-h5 font-weight-bold">Users</h1>
      <v-spacer />
      <v-btn variant="text" prepend-icon="mdi-refresh" :loading="loading" @click="load">Refresh</v-btn>
    </div>

    <v-text-field
      v-model="search" placeholder="Search by email or name" prepend-inner-icon="mdi-magnify"
      density="comfortable" variant="outlined" hide-details clearable class="mb-4" style="max-width: 420px"
      @update:model-value="onSearch" />

    <v-card rounded="lg" variant="outlined">
      <v-card-text>
        <div v-if="loading" class="text-center py-8"><v-progress-circular indeterminate color="primary" /></div>
        <v-table v-else density="comfortable">
          <thead>
            <tr>
              <th>Email</th>
              <th>Name</th>
              <th>Household</th>
              <th>App version</th>
              <th style="width: 140px">Role</th>
              <th style="width: 150px" class="text-right">Admin access</th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="u in users" :key="u._id">
              <td class="font-weight-medium">{{ u.email }}</td>
              <td>{{ [u.firstName, u.lastName].filter(Boolean).join(' ') || '—' }}</td>
              <td>{{ u.householdName || '—' }}</td>
              <td class="text-caption">
                {{ u.clientVersion || '—' }}<span v-if="u.clientPlatform" class="text-medium-emphasis"> ({{ u.clientPlatform }})</span>
              </td>
              <td>
                <v-chip size="small" :color="u.role === 'admin' ? 'primary' : 'default'" variant="tonal">{{ u.role }}</v-chip>
              </td>
              <td class="text-right">
                <v-switch
                  :model-value="u.role === 'admin'" color="primary" density="compact" hide-details inset
                  :loading="savingId === u._id" :disabled="u._id === auth.user?._id"
                  @update:model-value="v => setRole(u, v)" />
              </td>
            </tr>
            <tr v-if="!users.length">
              <td colspan="6" class="text-medium-emphasis py-4">No users found.</td>
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
import { useAuthStore } from '../stores/auth';
import { useSnackbar } from '../composables/useSnackbar';
import SnackbarHost from '../components/SnackbarHost.vue';

const auth = useAuthStore();
const { snack, success, fromError } = useSnackbar();

const PAGE_SIZE = 50;
const loading = ref(true);
const savingId = ref(null);
const users = ref([]);
const search = ref('');
const page = ref(1);
const total = ref(0);

const pageCount = computed(() => Math.max(1, Math.ceil(total.value / PAGE_SIZE)));
const rangeLabel = computed(() => {
  const start = (page.value - 1) * PAGE_SIZE + 1;
  const end = Math.min(page.value * PAGE_SIZE, total.value);
  return `${start}–${end} of ${total.value}`;
});

let searchTimer = null;
function onSearch() {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(() => { page.value = 1; load(); }, 300);
}

async function load() {
  loading.value = true;
  try {
    const { data } = await adminApi.users({ q: search.value.trim() || undefined, page: page.value, pageSize: PAGE_SIZE });
    users.value = data.items;
    total.value = data.total;
  } finally {
    loading.value = false;
  }
}

async function setRole(u, isAdmin) {
  const role = isAdmin ? 'admin' : 'user';
  savingId.value = u._id;
  try {
    await adminApi.setRole(u._id, role);
    u.role = role;
    success(`${u.email} → ${role}`);
  } catch (e) {
    fromError(e, 'Failed to update role');
  } finally {
    savingId.value = null;
  }
}

onMounted(load);
</script>
