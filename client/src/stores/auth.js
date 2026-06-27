import { defineStore } from 'pinia';
import { ref, computed } from 'vue';
import { authApi } from '../services/api';

export const useAuthStore = defineStore('auth', () => {
  const token = ref(localStorage.getItem('hc_token'));
  const user = ref(null);

  const isLoggedIn = computed(() => !!token.value);

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
  }

  async function register(payload) {
    const { data } = await authApi.register(payload);
    token.value = data.token;
    user.value = data.user;
    localStorage.setItem('hc_token', data.token);
  }

  function setUser(data) {
    user.value = data;
  }

  function logout() {
    token.value = null;
    user.value = null;
    localStorage.removeItem('hc_token');
    window.location.href = '/login';
  }

  return { token, user, isLoggedIn, init, login, register, setUser, logout };
});
