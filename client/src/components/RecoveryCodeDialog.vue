<!--
  One-time recovery-code dialog. Shown right after first-time E2EE enrollment
  (auth.pendingRecoveryCode is set). This code is a high-entropy fallback that can
  unlock the account's encrypted data if the password/passkey is lost. It is
  NEVER stored server-side — if the user loses every factor, the data is
  unrecoverable by design (no server escrow). Hence the deliberate friction here.
-->
<template>
  <v-dialog :model-value="!!code" max-width="480" persistent>
    <v-card rounded="lg">
      <v-card-title class="text-h6 d-flex align-center" style="gap: 8px">
        <v-icon color="primary">mdi-key-chain-variant</v-icon>
        Save your recovery code
      </v-card-title>
      <v-card-text>
        <p class="mb-3 text-medium-emphasis">
          Your data is end-to-end encrypted. This one-time code is the only way to
          regain access if you lose your password and other sign-in methods.
          <strong>We can’t recover it for you.</strong> Store it somewhere safe.
        </p>
        <v-sheet rounded border class="pa-4 text-center mb-1" color="grey-lighten-4">
          <code class="text-h6" style="letter-spacing: 2px">{{ code }}</code>
        </v-sheet>
        <div class="d-flex" style="gap: 8px">
          <v-btn variant="text" size="small" prepend-icon="mdi-content-copy" @click="copy">
            {{ copied ? 'Copied' : 'Copy' }}
          </v-btn>
          <v-btn variant="text" size="small" prepend-icon="mdi-download" @click="download">Download</v-btn>
        </div>
        <v-alert type="info" variant="tonal" density="compact" class="mt-3 text-caption">
          Resetting your password restores sign-in only — it does not by itself
          decrypt old data. Keep this code.
        </v-alert>
        <v-checkbox
          v-model="acknowledged" density="compact" hide-details class="mt-2"
          label="I’ve saved my recovery code somewhere safe" />
      </v-card-text>
      <v-card-actions class="justify-end">
        <v-btn color="primary" variant="flat" :disabled="!acknowledged" @click="done">Done</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, computed } from 'vue';
import { useAuthStore } from '../stores/auth';

const auth = useAuthStore();
const code = computed(() => auth.pendingRecoveryCode);
const acknowledged = ref(false);
const copied = ref(false);

async function copy() {
  try {
    await navigator.clipboard.writeText(code.value);
    copied.value = true;
    setTimeout(() => { copied.value = false; }, 1500);
  } catch { /* clipboard unavailable — user can still copy manually */ }
}

function download() {
  const blob = new Blob([`Household Calendar recovery code:\n\n${code.value}\n`], { type: 'text/plain' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'household-calendar-recovery-code.txt';
  a.click();
  URL.revokeObjectURL(url);
}

function done() {
  acknowledged.value = false;
  auth.clearRecoveryCode();
}
</script>
