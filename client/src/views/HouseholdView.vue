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
          <div class="text-caption text-medium-emphasis">Share this code with family. When they enter it, you'll be asked to approve them on your device.</div>
        </v-card-text>
      </v-card>

      <!-- Pending requests to join THIS household — an existing member approves. -->
      <v-card v-if="pendingRequests.length" rounded="lg" elevation="1" class="mb-4">
        <v-card-text class="pa-5">
          <div class="text-subtitle-2 font-weight-medium mb-1">Requests to join</div>
          <div class="text-caption text-medium-emphasis mb-3">
            Before approving, confirm the security code below matches what the person sees on their device.
            This proves you're granting access to the right person.
          </div>
          <v-alert v-if="!hdkReady" type="warning" variant="tonal" density="compact" class="mb-3">
            Your device is still unlocking the household key — reload if this persists.
          </v-alert>
          <div v-for="r in pendingRequests" :key="r._id" class="request-row">
            <div class="flex-grow-1 min-w-0">
              <div class="text-body-2 font-weight-medium text-truncate">{{ [r.firstName, r.lastName].filter(Boolean).join(' ') || r.email }}</div>
              <div class="text-caption text-medium-emphasis text-truncate">{{ r.email }}</div>
              <code class="fingerprint">{{ fingerprints[r._id] || '…' }}</code>
            </div>
            <div class="d-flex flex-column ga-1">
              <v-btn size="small" color="primary" variant="elevated" :loading="acting === r._id" :disabled="!hdkReady" @click="approve(r)">Approve</v-btn>
              <v-btn size="small" color="error" variant="text" :disabled="acting === r._id" @click="reject(r)">Reject</v-btn>
            </div>
          </div>
          <v-alert v-if="approveError" type="error" variant="tonal" density="compact" class="mt-2">{{ approveError }}</v-alert>
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
          <!-- Waiting for approval of our own request. -->
          <template v-if="myRequest && myRequest.status === 'pending'">
            <div class="d-flex align-center ga-2 mb-1">
              <v-progress-circular indeterminate size="18" width="2" color="primary" />
              <div class="text-subtitle-2 font-weight-medium">Waiting for approval</div>
            </div>
            <div class="text-caption text-medium-emphasis mb-3">
              A family member in “{{ myRequest.name }}” needs to approve you on their device. This stays pending until they're online.
            </div>
            <v-btn size="small" variant="text" color="error" :loading="canceling" @click="cancelRequest">Cancel request</v-btn>
          </template>

          <template v-else>
            <div class="text-subtitle-2 font-weight-medium mb-1">Join another household</div>
            <div class="text-caption text-medium-emphasis mb-3">Enter a household's invite code. A member there approves you on their device; then your data becomes shared with them.</div>
            <div class="d-flex ga-2">
              <v-text-field v-model="joinCode" label="Invite code" variant="outlined" density="compact" hide-details style="text-transform: uppercase" />
              <v-btn color="primary" variant="elevated" :loading="joining" :disabled="!joinCode.trim()" @click="join">Request</v-btn>
            </div>
            <v-alert v-if="joinError" type="error" variant="tonal" density="compact" class="mt-2">{{ joinError }}</v-alert>
          </template>
        </v-card-text>
      </v-card>

      <v-btn variant="text" color="error" size="small" prepend-icon="mdi-exit-run" :loading="leaving" @click="leave">
        Leave household
      </v-btn>
    </template>
  </v-container>
</template>

<script setup>
import { ref, onMounted, onUnmounted } from 'vue';
import { householdApi } from '../services/api';
import { useConfirm } from '../composables/useConfirm';
import {
  ensureHouseholdKey, getHDK, wrapHDKForJoiner, publicKeyFingerprint,
} from '../services/e2ee';

const { confirm } = useConfirm();
const loading = ref(true);
const household = ref(null);
const name = ref('');
const copied = ref(false);
const joinCode = ref('');
const joining = ref(false);
const joinError = ref('');
const leaving = ref(false);

const myRequest = ref(null);       // our own pending/most-recent join request
const canceling = ref(false);
const pendingRequests = ref([]);   // requests to join OUR household (approver view)
const fingerprints = ref({});      // requestId → public-key fingerprint
const acting = ref(null);          // requestId currently being approved/rejected
const approveError = ref('');
const hdkReady = ref(false);
let pollTimer = null;

async function load() {
  const { data } = await householdApi.get();
  household.value = data;
  name.value = data.name;
}

// Requests pending against our household + their verification fingerprints.
async function loadPending() {
  try {
    const { data } = await householdApi.joinRequests();
    pendingRequests.value = data;
    for (const r of data) {
      if (!fingerprints.value[r._id]) {
        fingerprints.value[r._id] = await publicKeyFingerprint(r.requesterPublicKey);
      }
    }
  } catch { /* not a member / transient — leave list as-is */ }
}

// Our own request status; when it flips to approved we're now a member.
async function loadMine() {
  try {
    const { data } = await householdApi.myJoinRequest();
    if (data.status === 'approved' && myRequest.value?.status === 'pending') {
      myRequest.value = null;
      await ensureHouseholdKey(); // our envelope now exists — unwrap the HDK
      await refreshAll();
      return;
    }
    myRequest.value = data.status === 'none' ? null : data;
  } catch { /* ignore */ }
}

async function refreshAll() {
  await Promise.all([load(), loadPending(), loadMine()]);
  hdkReady.value = getHDK() != null;
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
    const { data } = await householdApi.join(joinCode.value.trim().toUpperCase());
    joinCode.value = '';
    if (data.status === 'pending') {
      myRequest.value = { status: 'pending', name: data.name, requestId: data.requestId };
    } else {
      await refreshAll();
    }
  } catch (e) {
    joinError.value = e.response?.data?.error || 'Could not request to join';
  } finally {
    joining.value = false;
  }
}

async function cancelRequest() {
  canceling.value = true;
  try {
    await householdApi.cancelJoinRequest();
    myRequest.value = null;
  } finally {
    canceling.value = false;
  }
}

async function approve(r) {
  approveError.value = '';
  acting.value = r._id;
  try {
    const envelope = await wrapHDKForJoiner(r.requesterPublicKey, keyVersion.value);
    if (!envelope) { approveError.value = 'Your household key is not ready — reload and try again.'; return; }
    await householdApi.approveJoin(r._id, envelope);
    await refreshAll();
  } catch (e) {
    approveError.value = e.response?.data?.error || 'Could not approve';
  } finally {
    acting.value = null;
  }
}

async function reject(r) {
  acting.value = r._id;
  try {
    await householdApi.rejectJoin(r._id);
    pendingRequests.value = pendingRequests.value.filter((x) => x._id !== r._id);
  } finally {
    acting.value = null;
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
    await refreshAll();
  } finally {
    leaving.value = false;
  }
}

// The current HDK version (needed to wrap for a joiner). Fetched alongside the
// key so it always matches what the server will accept on approve.
const keyVersion = ref(0);
async function loadKeyVersion() {
  try {
    const { data } = await householdApi.getKey();
    keyVersion.value = data.currentKeyVersion || 0;
  } catch { /* ignore */ }
}

onMounted(async () => {
  try {
    await ensureHouseholdKey();
    await Promise.all([load(), loadPending(), loadMine(), loadKeyVersion()]);
    hdkReady.value = getHDK() != null;
  } finally {
    loading.value = false;
  }
  // Poll while we have a pending request out, or others might be requesting us.
  pollTimer = setInterval(() => { loadMine(); loadPending(); }, 5000);
});
onUnmounted(() => { if (pollTimer) clearInterval(pollTimer); });
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
.request-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 8px 0;
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
}
.fingerprint {
  display: inline-block;
  margin-top: 4px;
  font-size: 0.8rem;
  letter-spacing: 0.08em;
  color: rgb(var(--v-theme-primary));
}
.min-w-0 { min-width: 0; }
</style>
