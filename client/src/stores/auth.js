import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { authApi } from '../services/api';
import { ensureEnrolledOnLogin, ensureHouseholdKey, lock } from '../services/e2ee';

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('hc_token'));
  const user = ref(null);
  // Set once, right after first-time E2EE enrollment, so the UI can show the
  // recovery code exactly once. Consumers call clearRecoveryCode() after display.
  const pendingRecoveryCode = ref(null);
  // True when the account is enrolled but the login password didn't unlock the
  // key (e.g. password changed elsewhere without re-wrapping). The UI prompts
  // for a recovery code / passkey to unlock.
  const e2eeLocked = ref(false);

  const isLoggedIn = computed(() => !!token.value);

  // Enroll (or unlock) the account's E2EE keypair after auth. Additive and
  // best-effort in Phase 1: a crypto/enrollment failure must not block login.
  async function initE2EE(password) {
    try {
      const result = await ensureEnrolledOnLogin(password);
      if (result.status === 'enrolled') pendingRecoveryCode.value = result.recoveryCode;
      e2eeLocked.value = result.status === 'locked';
      // Once unlocked, make sure this session holds the household key (owner mints
      // it lazily on first unlock). Best-effort — never blocks login.
      if (result.status !== 'locked') await ensureHouseholdKey();
    } catch (err) {
      console.warn('[e2ee] enrollment/unlock skipped:', err?.message || err);
    }
  }

  function clearRecoveryCode() {
    pendingRecoveryCode.value = null;
  }

  function clearLocked() {
    e2eeLocked.value = false;
  }

  async function init() {
    if (token.value) {
      try {
        const { data } = await authApi.me();
        user.value = data;
      } catch {
        logout();
      }
    }
  }

  async function login(credentials) {
    const { data } = await authApi.login(credentials);
    token.value = data.token;
    user.value = data.user;
    localStorage.setItem('hc_token', data.token);
    await initE2EE(credentials.password); // token is set → keysApi is authed
  }

  async function register(payload) {
    const { data } = await authApi.register(payload);
    token.value = data.token;
    user.value = data.user;
    localStorage.setItem('hc_token', data.token);
    await initE2EE(payload.password);
  }

  function setUser(data) {
    user.value = data;
  }

  function logout() {
    token.value = null;
    user.value = null;
    lock(); // drop the in-memory private key
    localStorage.removeItem('hc_token');
    window.location.href = '/login';
  }

  return {
    token, user, isLoggedIn, pendingRecoveryCode, e2eeLocked,
    init, login, register, setUser, logout, clearRecoveryCode, clearLocked,
  };
});
