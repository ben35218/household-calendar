<!--
  Shown when the account is enrolled for E2EE but the login password didn't
  unlock the key (auth.e2eeLocked). Lets the user unlock with a passkey or their
  one-time recovery code — the "at least one factor must survive" safety net.
-->
<template>
  <v-dialog :model-value="auth.e2eeLocked" max-width="460" persistent>
    <v-card rounded="lg">
      <v-card-title class="text-h6 d-flex align-center" style="gap: 8px">
        <v-icon color="primary">mdi-lock-open-variant-outline</v-icon>
        Unlock your encrypted data
      </v-card-title>
      <v-card-text>
        <p class="text-medium-emphasis mb-4">
          You’re signed in, but this device needs to unlock your end-to-end
          encrypted data. Use a passkey or your recovery code.
        </p>

        <v-btn v-if="passkeySupported" block variant="tonal" color="primary" class="mb-4"
               prepend-icon="mdi-fingerprint" :loading="busy === 'passkey'" @click="tryPasskey">
          Unlock with a passkey
        </v-btn>

        <v-text-field
          v-model="code" label="Recovery code" variant="outlined" density="comfortable"
          placeholder="XXXXX-XXXXX-…" autocomplete="one-time-code"
          @keyup.enter="tryRecovery" />
        <v-alert v-if="error" type="error" variant="tonal" density="compact" class="mt-2">{{ error }}</v-alert>
      </v-card-text>
      <v-card-actions class="justify-end">
        <v-btn variant="text" @click="skip">Later</v-btn>
        <v-btn color="primary" variant="flat" :loading="busy === 'recovery'" :disabled="!code.trim()" @click="tryRecovery">Unlock</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref } from 'vue';
import { useAuthStore } from '../stores/auth';
import { unlockWithRecoveryCode, unlockWithPasskey, passkeySupported as e2eePasskeySupported } from '../services/e2ee';

const auth = useAuthStore();
const passkeySupported = e2eePasskeySupported();
const code = ref('');
const error = ref('');
const busy = ref(null);

async function tryPasskey() {
  busy.value = 'passkey';
  error.value = '';
  try {
    if (await unlockWithPasskey()) auth.clearLocked();
    else error.value = 'Passkey unlock didn’t work. Try your recovery code.';
  } finally {
    busy.value = null;
  }
}

async function tryRecovery() {
  if (!code.value.trim()) return;
  busy.value = 'recovery';
  error.value = '';
  try {
    if (await unlockWithRecoveryCode(code.value.trim())) { auth.clearLocked(); code.value = ''; }
    else error.value = 'That recovery code didn’t match.';
  } finally {
    busy.value = null;
  }
}

// Dismiss for now — encryption-dependent features will prompt again when needed.
function skip() {
  auth.clearLocked();
}
</script>
