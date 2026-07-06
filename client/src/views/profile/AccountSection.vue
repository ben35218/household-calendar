<template>
  <v-container class="py-6" max-width="700">
    <div class="d-flex align-center mb-4">
      <BackButton class="mr-2" />
      <h1 class="text-h5 font-weight-bold">Account</h1>
    </div>

    <v-card variant="flat" border rounded="lg" class="pa-4">
      <div class="text-body-2 text-medium-emphasis mb-4">Your identity and location.</div>

      <v-row dense>
        <v-col cols="12" sm="6">
          <v-text-field v-model="form.firstName" label="First Name" variant="outlined" density="comfortable" />
        </v-col>
        <v-col cols="12" sm="6">
          <v-text-field v-model="form.lastName" label="Last Name" variant="outlined" density="comfortable" />
        </v-col>
        <v-col cols="12" sm="6">
          <v-text-field v-model="form.birthdayInput" label="Your birthday" type="date" variant="outlined" density="comfortable" />
        </v-col>
        <v-col cols="12" sm="6">
          <v-select v-model="form.timezone" :items="timezones" label="Timezone" variant="outlined" density="comfortable" />
        </v-col>
        <v-col cols="12">
          <v-combobox
            v-model="addressSelected"
            :items="addressSuggestions"
            item-title="description"
            return-object
            no-filter
            :loading="addressLoading"
            label="Home address (starting point for drive-time estimates)"
            variant="outlined"
            density="comfortable"
            placeholder="123 Main St, Toronto, ON"
            hint="Used to calculate driving time to calendar event locations and local weather"
            persistent-hint
            prepend-inner-icon="mdi-map-marker-outline"
            clearable
            @update:search="onAddressSearch"
          >
            <template #item="{ item, props }">
              <v-list-item v-bind="props" :title="item.raw.main_text" :subtitle="item.raw.secondary_text" />
            </template>
          </v-combobox>
        </v-col>
      </v-row>
    </v-card>

    <!-- Sign-in & security -->
    <v-card variant="flat" border rounded="lg" class="pa-4 mt-4">
      <div class="text-subtitle-1 font-weight-medium mb-1">Sign-in &amp; security</div>
      <div class="text-body-2 text-medium-emphasis mb-4">The email and password you use to log in.</div>

      <v-list class="py-0">
        <v-list-item class="px-0">
          <v-list-item-title class="text-body-2 text-medium-emphasis">Email</v-list-item-title>
          <v-list-item-subtitle class="text-body-1 text-high-emphasis">{{ auth.user?.email }}</v-list-item-subtitle>
          <template #append>
            <v-btn variant="text" color="primary" size="small" @click="openEmailDialog">Change</v-btn>
          </template>
        </v-list-item>
        <v-divider />
        <v-list-item class="px-0">
          <v-list-item-title class="text-body-2 text-medium-emphasis">Password</v-list-item-title>
          <v-list-item-subtitle class="text-body-1 text-high-emphasis">••••••••</v-list-item-subtitle>
          <template #append>
            <v-btn variant="text" color="primary" size="small" @click="openPasswordDialog">Change</v-btn>
          </template>
        </v-list-item>
      </v-list>
    </v-card>

    <!-- Encryption & recovery -->
    <v-card variant="flat" border rounded="lg" class="pa-4 mt-4">
      <div class="text-subtitle-1 font-weight-medium mb-1">Encryption &amp; recovery</div>
      <div class="text-body-2 text-medium-emphasis mb-4">
        Your account has an end-to-end encryption key. Passkeys and your recovery
        code are extra ways to unlock it. Resetting your password restores sign-in
        only — it doesn’t by itself decrypt your data.
      </div>
      <v-list class="py-0">
        <v-list-item class="px-0">
          <v-list-item-title class="text-body-2 text-medium-emphasis">Passkey</v-list-item-title>
          <v-list-item-subtitle class="text-body-1 text-high-emphasis">
            {{ passkeySupported ? 'Unlock with Face ID / Touch ID / a security key' : 'Not supported in this browser' }}
          </v-list-item-subtitle>
          <template #append>
            <v-btn variant="text" color="primary" size="small" :loading="passkeyBusy" :disabled="!passkeySupported" @click="setupPasskey">Add</v-btn>
          </template>
        </v-list-item>
        <v-divider />
        <v-list-item class="px-0">
          <v-list-item-title class="text-body-2 text-medium-emphasis">Recovery code</v-list-item-title>
          <v-list-item-subtitle class="text-body-1 text-high-emphasis">A one-time code to regain access if you’re locked out</v-list-item-subtitle>
          <template #append>
            <v-btn variant="text" color="primary" size="small" :loading="recoveryBusy" @click="regenerate">Regenerate</v-btn>
          </template>
        </v-list-item>
      </v-list>
    </v-card>

    <!-- Push notifications -->
    <v-card variant="flat" border rounded="lg" class="pa-4 mt-4">
      <div class="d-flex align-center justify-space-between">
        <div class="pr-4">
          <div class="text-subtitle-1 font-weight-medium">Push notifications</div>
          <div class="text-body-2 text-medium-emphasis">{{ pushStatusText }}</div>
        </div>
        <v-switch
          :model-value="push.subscribed.value"
          :disabled="!push.supported.value || !push.configured.value || push.busy.value"
          :loading="push.busy.value"
          color="primary" hide-details density="comfortable"
          @update:model-value="togglePush"
        />
      </div>
    </v-card>

    <ProfileSaveBar />

    <!-- Change email dialog -->
    <v-dialog v-model="emailDialog" max-width="460">
      <v-card rounded="lg">
        <v-card-title class="pt-5 px-5">Change email</v-card-title>
        <v-divider />
        <v-card-text class="px-5 py-4">
          <v-text-field v-model="emailForm.email" label="New email" type="email" variant="outlined" density="comfortable" class="mb-3" autocomplete="email" />
          <v-text-field v-model="emailForm.currentPassword" label="Current password" type="password" variant="outlined" density="comfortable" autocomplete="current-password" />
          <v-alert v-if="emailError" type="error" variant="tonal" density="compact" class="mt-3">{{ emailError }}</v-alert>
        </v-card-text>
        <v-divider />
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn @click="emailDialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="emailSaving" :disabled="!emailForm.email.trim() || !emailForm.currentPassword" @click="saveEmail">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <!-- Change password dialog -->
    <v-dialog v-model="passwordDialog" max-width="460">
      <v-card rounded="lg">
        <v-card-title class="pt-5 px-5">Change password</v-card-title>
        <v-divider />
        <v-card-text class="px-5 py-4">
          <v-text-field v-model="passwordForm.currentPassword" label="Current password" type="password" variant="outlined" density="comfortable" class="mb-3" autocomplete="current-password" />
          <v-text-field v-model="passwordForm.newPassword" label="New password" type="password" variant="outlined" density="comfortable" class="mb-3" hint="At least 8 characters" persistent-hint autocomplete="new-password" />
          <v-text-field v-model="passwordForm.confirm" label="Confirm new password" type="password" variant="outlined" density="comfortable" autocomplete="new-password" />
          <v-alert v-if="passwordError" type="error" variant="tonal" density="compact" class="mt-3">{{ passwordError }}</v-alert>
        </v-card-text>
        <v-divider />
        <v-card-actions class="pa-4">
          <v-spacer />
          <v-btn @click="passwordDialog = false">Cancel</v-btn>
          <v-btn color="primary" :loading="passwordSaving" :disabled="!passwordReady" @click="savePassword">Save</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-snackbar v-model="snackbar" :timeout="3000" color="success">{{ snackbarMsg }}</v-snackbar>
  </v-container>
</template>

<script setup>
import { onMounted, reactive, ref, computed } from 'vue';
import ProfileSaveBar from '../../components/ProfileSaveBar.vue';
import { useProfileForm } from '../../composables/useProfileForm';
import { useAuthStore } from '../../stores/auth';
import { useSnackbar } from '../../composables/useSnackbar';
import { usePush } from '../../composables/usePush';
import { authApi } from '../../services/api';
import {
  rewrapForNewPassword, regenerateRecoveryCode, enrollPasskey, passkeySupported as e2eePasskeySupported,
} from '../../services/e2ee';

const {
  form, timezones, ensureLoaded,
  addressSelected, addressSuggestions, addressLoading, onAddressSearch,
} = useProfileForm();

const auth = useAuthStore();

const snackbar = ref(false);
const snackbarMsg = ref('');
function toast(msg) { snackbarMsg.value = msg; snackbar.value = true; }

// ── Push notifications ──────────────────────────────────────────────────────
const push = usePush();
const { error: notifyError, success: notifySuccess } = useSnackbar();

const pushStatusText = computed(() => {
  if (!push.supported.value) return 'Not supported in this browser.';
  if (!push.configured.value) return 'Push is not configured on the server yet.';
  return push.subscribed.value
    ? 'On — alerts arrive on this device.'
    : 'Turn on to get alerts on this device.';
});

async function togglePush(on) {
  try {
    if (on) { await push.subscribe(); notifySuccess('Push notifications enabled on this device'); }
    else    { await push.unsubscribe(); notifySuccess('Push notifications disabled'); }
  } catch (e) {
    notifyError(e.message || 'Could not change push settings');
  }
}

// ── Change email ────────────────────────────────────────────────────────────
const emailDialog = ref(false);
const emailSaving = ref(false);
const emailError = ref('');
const emailForm = reactive({ email: '', currentPassword: '' });

function openEmailDialog() {
  emailForm.email = auth.user?.email ?? '';
  emailForm.currentPassword = '';
  emailError.value = '';
  emailDialog.value = true;
}

async function saveEmail() {
  emailSaving.value = true;
  emailError.value = '';
  try {
    const { data } = await authApi.updateEmail({ email: emailForm.email.trim(), currentPassword: emailForm.currentPassword });
    auth.setUser({ ...auth.user, ...data });
    emailDialog.value = false;
    toast('Email updated');
  } catch (e) {
    emailError.value = e.response?.data?.error || 'Failed to update email';
  } finally {
    emailSaving.value = false;
  }
}

// ── Change password ─────────────────────────────────────────────────────────
const passwordDialog = ref(false);
const passwordSaving = ref(false);
const passwordError = ref('');
const passwordForm = reactive({ currentPassword: '', newPassword: '', confirm: '' });

const passwordReady = computed(() =>
  passwordForm.currentPassword && passwordForm.newPassword.length >= 8 && passwordForm.confirm,
);

function openPasswordDialog() {
  passwordForm.currentPassword = '';
  passwordForm.newPassword = '';
  passwordForm.confirm = '';
  passwordError.value = '';
  passwordDialog.value = true;
}

async function savePassword() {
  if (passwordForm.newPassword !== passwordForm.confirm) {
    passwordError.value = 'New passwords do not match';
    return;
  }
  passwordSaving.value = true;
  passwordError.value = '';
  try {
    await authApi.updatePassword({ currentPassword: passwordForm.currentPassword, newPassword: passwordForm.newPassword });
    // Re-wrap the E2EE key under the new password so it can still unlock the
    // account. Best-effort: if the session isn't unlocked, the old password
    // factor stays valid until the next unlock+rewrap.
    await rewrapForNewPassword(passwordForm.newPassword).catch(() => {});
    passwordDialog.value = false;
    toast('Password updated');
  } catch (e) {
    passwordError.value = e.response?.data?.error || 'Failed to update password';
  } finally {
    passwordSaving.value = false;
  }
}

// ── Encryption & recovery ─────────────────────────────────────────────────────
const passkeySupported = e2eePasskeySupported();
const passkeyBusy = ref(false);
const recoveryBusy = ref(false);

async function setupPasskey() {
  passkeyBusy.value = true;
  try {
    const r = await enrollPasskey(auth.user);
    if (r.enrolled) return toast('Passkey added — you can now unlock with it');
    const reasons = {
      locked: 'Sign out and back in first, then add a passkey.',
      unsupported: 'Passkeys aren’t supported in this browser.',
      'no-prf': 'This device can’t use a passkey for encryption (no PRF support).',
      cancelled: 'Passkey setup was cancelled.',
    };
    toast(reasons[r.reason] || 'Could not add a passkey');
  } catch (e) {
    toast(e?.message || 'Could not add a passkey');
  } finally {
    passkeyBusy.value = false;
  }
}

async function regenerate() {
  recoveryBusy.value = true;
  try {
    const code = await regenerateRecoveryCode();
    if (code) auth.pendingRecoveryCode = code; // RecoveryCodeDialog shows it once
    else toast('Sign out and back in to manage your recovery code');
  } catch (e) {
    toast(e?.message || 'Could not regenerate your recovery code');
  } finally {
    recoveryBusy.value = false;
  }
}

onMounted(async () => {
  await ensureLoaded();
  await push.refresh();
});
</script>
