<template>
  <v-container class="py-6 px-4" style="max-width: 560px">
    <div class="d-flex align-center mb-4">
      <BackButton class="mr-2" />
      <h1 class="text-h5 font-weight-bold">Household</h1>
    </div>

    <div v-if="loading" class="text-center py-12">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else-if="household">
      <v-card rounded="lg" elevation="1" class="mb-4">
        <v-card-text class="pa-5">
          <v-text-field
            v-model="name"
            label="Household name"
            variant="outlined"
            density="compact"
            hide-details
            class="mb-1"
            append-inner-icon="mdi-content-save-outline"
            @keyup.enter="saveName"
            @click:append-inner="saveName"
          />
          <div class="text-caption text-medium-emphasis mb-4">Everyone in this household shares calendars, tasks, chores, recipes, people, and settings.</div>

          <div class="text-subtitle-2 font-weight-medium mb-1">Invite code</div>
          <div class="d-flex align-center ga-2 mb-1">
            <code class="join-code">{{ household.joinCode }}</code>
            <v-btn size="small" variant="tonal" color="primary" :prepend-icon="copied ? 'mdi-check' : 'mdi-content-copy'" @click="copyCode">
              {{ copied ? 'Copied' : 'Copy' }}
            </v-btn>
          </div>
          <div class="text-caption text-medium-emphasis">Share this code with family so they can join your household.</div>
        </v-card-text>
      </v-card>

      <v-card rounded="lg" elevation="1" class="mb-4">
        <v-card-text class="pa-5">
          <div class="text-subtitle-2 font-weight-medium mb-2">Members ({{ household.members.length }})</div>
          <div v-for="m in household.members" :key="m._id" class="member-row">
            <v-avatar size="32" color="primary" class="mr-3">
              <span class="text-caption font-weight-bold">{{ (m.firstName || m.email || '?').charAt(0).toUpperCase() }}</span>
            </v-avatar>
            <div class="flex-grow-1 min-w-0">
              <div class="text-body-2 font-weight-medium text-truncate">{{ [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email }}</div>
              <div class="text-caption text-medium-emphasis text-truncate">{{ m.email }}</div>
            </div>
            <v-chip v-if="String(m._id) === String(household.ownerId)" size="x-small" color="primary" variant="tonal">Owner</v-chip>
          </div>
        </v-card-text>
      </v-card>

      <v-card rounded="lg" elevation="1" class="mb-4">
        <v-card-text class="pa-5">
          <div class="text-subtitle-2 font-weight-medium mb-1">Join another household</div>
          <div class="text-caption text-medium-emphasis mb-3">Enter a household's invite code to join it. Your current data comes with you and becomes shared with that household.</div>
          <div class="d-flex ga-2">
            <v-text-field v-model="joinCode" label="Invite code" variant="outlined" density="compact" hide-details style="text-transform: uppercase" />
            <v-btn color="primary" variant="elevated" :loading="joining" :disabled="!joinCode.trim()" @click="join">Join</v-btn>
          </div>
          <v-alert v-if="joinError" type="error" variant="tonal" density="compact" class="mt-2">{{ joinError }}</v-alert>
        </v-card-text>
      </v-card>

      <v-btn variant="text" color="error" size="small" prepend-icon="mdi-exit-run" :loading="leaving" @click="leave">
        Leave household
      </v-btn>
    </template>
  </v-container>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { householdApi } from '../services/api';
import { useConfirm } from '../composables/useConfirm';

const { confirm } = useConfirm();
const router = useRouter();
const loading = ref(true);
const household = ref(null);
const name = ref('');
const copied = ref(false);
const joinCode = ref('');
const joining = ref(false);
const joinError = ref('');
const leaving = ref(false);

async function load() {
  loading.value = true;
  try {
    const { data } = await householdApi.get();
    household.value = data;
    name.value = data.name;
  } finally {
    loading.value = false;
  }
}

async function saveName() {
  if (!name.value.trim() || name.value === household.value.name) return;
  await householdApi.rename(name.value.trim());
  household.value.name = name.value.trim();
}

async function copyCode() {
  try {
    await navigator.clipboard.writeText(household.value.joinCode);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1500);
  } catch { /* clipboard unavailable */ }
}

async function join() {
  joining.value = true;
  joinError.value = '';
  try {
    await householdApi.join(joinCode.value.trim().toUpperCase());
    joinCode.value = '';
    await load();
  } catch (e) {
    joinError.value = e.response?.data?.error || 'Could not join';
  } finally {
    joining.value = false;
  }
}

async function leave() {
  if (!(await confirm({
    title: 'Leave household?',
    message: 'You’ll start a fresh household with your own data.',
    confirmText: 'Leave', confirmColor: 'error',
  }))) return;
  leaving.value = true;
  try {
    await householdApi.leave();
    await load();
  } finally {
    leaving.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.join-code {
  font-size: 1.1rem;
  font-weight: 700;
  letter-spacing: 0.15em;
  background: rgba(var(--v-theme-primary), 0.1);
  color: rgb(var(--v-theme-primary));
  padding: 6px 12px;
  border-radius: 8px;
}
.member-row {
  display: flex;
  align-items: center;
  padding: 6px 0;
}
.min-w-0 { min-width: 0; }
</style>
