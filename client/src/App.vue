<template>
  <v-app>
    <template v-if="auth.isLoggedIn">
      <div v-if="!route.meta.hideDrawerFab" class="floating-nav">
        <v-btn variant="text" color="primary" to="/profile" :width="52" :height="52" class="avatar-btn">
          <v-avatar size="52" color="primary" class="avatar-letter">
            {{ auth.user?.firstName?.charAt(0).toUpperCase() ?? '?' }}
          </v-avatar>
        </v-btn>
      </div>

      <v-main>
        <router-view />
      </v-main>
    </template>

    <template v-else>
      <v-main>
        <router-view />
      </v-main>
    </template>

    <!-- App-wide snackbar (#6) -->
    <v-snackbar v-model="snackbar.show" :color="snackbar.color" :timeout="snackbar.timeout" location="bottom">
      {{ snackbar.text }}
      <template #actions>
        <v-btn variant="text" icon="mdi-close" @click="snackbar.show = false" />
      </template>
    </v-snackbar>

    <!-- Quota-exceeded prompt (fired by the API layer on a 402) -->
    <v-snackbar v-model="quota.show" color="warning" :timeout="8000" location="bottom">
      {{ quota.text }}
      <template #actions>
        <v-btn variant="text" @click="goUpgrade">Upgrade</v-btn>
        <v-btn variant="text" icon="mdi-close" @click="quota.show = false" />
      </template>
    </v-snackbar>

    <!-- App-wide confirm dialog (#6) -->
    <v-dialog v-model="confirmState.show" max-width="420" persistent>
      <v-card rounded="lg">
        <v-card-title class="text-h6">{{ confirmState.title }}</v-card-title>
        <v-card-text v-if="confirmState.message">{{ confirmState.message }}</v-card-text>
        <v-card-actions class="justify-end">
          <v-btn variant="text" @click="_cancel">{{ confirmState.cancelText }}</v-btn>
          <v-btn :color="confirmState.confirmColor" variant="flat" @click="_accept">{{ confirmState.confirmText }}</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </v-app>
</template>

<script setup>
import { onMounted, onUnmounted, reactive } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useAuthStore } from './stores/auth';
import { useSnackbar } from './composables/useSnackbar';
import { useConfirm } from './composables/useConfirm';

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const { snackbar } = useSnackbar();
const { confirmState, _accept, _cancel } = useConfirm();

// Global quota-exceeded prompt, raised by the API layer (api.js) on a 402.
const quota = reactive({ show: false, text: '' });
function onQuota(e) {
  const d = e.detail || {};
  const tier = d.upgradeTo ? d.upgradeTo.charAt(0).toUpperCase() + d.upgradeTo.slice(1) : 'a paid plan';
  quota.text = `You’ve hit your monthly limit for this feature. Upgrade to ${tier} for more.`;
  quota.show = true;
}
function goUpgrade() {
  quota.show = false;
  router.push('/profile/billing');
}

onMounted(() => {
  auth.init();
  window.addEventListener('hc:quota', onQuota);
});
onUnmounted(() => window.removeEventListener('hc:quota', onQuota));
</script>

<style scoped>
.floating-nav {
  position: fixed;
  top: 12px;
  left: 12px;
  z-index: 1050;
}

.avatar-btn {
  min-width: unset !important;
  padding: 0 !important;
  border-radius: 999px !important;
  background: rgba(var(--v-theme-primary), 0.18) !important;
  backdrop-filter: blur(6px);
  overflow: hidden;
}

.avatar-letter {
  font-size: 18px;
  font-weight: 600;
  color: white;
}
</style>
