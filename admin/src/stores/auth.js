import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { authApi } from '../services/api';

// Admin session. Auth is the same JWT scheme as the consumer app, but access is
// restricted to users with role === 'admin' (the server enforces this on every
// admin route; this store gates the UI and verifies role on load/login).
export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('hc_admin_token'));
  const user = ref(null);

  const isLoggedIn = computed(() => !!token.value);
  const isAdmin = computed(() => user.value?.role === 'admin');

  async function init() {
    if (!token.value) return;
    try {
      const { data } = await authApi.me();
      // Re-verify the role on every load, not just at login: an admin whose
      // access was revoked mid-session still holds a valid token, but must be
      // bounced from the UI (the server would 403 their requests anyway).
      if (data?.role !== 'admin') return logout();
      user.value = data;
    } catch {
      logout();
    }
  }

  async function login(credentials) {
    const { data } = await authApi.login(credentials);
    if (data.user?.role !== 'admin') {
      const e = new Error('This account does not have admin access.');
      e.code = 'NOT_ADMIN';
      throw e;
    }
    token.value = data.token;
    user.value = data.user;
    localStorage.setItem('hc_admin_token', data.token);
  }

  function logout() {
    token.value = null;
    user.value = null;
    localStorage.removeItem('hc_admin_token');
    if (window.location.pathname !== '/login') window.location.href = '/login';
  }

  return { token, user, isLoggedIn, isAdmin, init, login, logout };
});
