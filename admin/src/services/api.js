import axios from 'axios';

// Mirrors the consumer client's axios pattern, but:
//   - baseURL is env-driven (absolute in prod, proxied '/api' in dev)
//   - token lives under a distinct key so it never collides with the consumer
//     web app on the same machine.
const api = axios.create({ baseURL: (import.meta.env.VITE_API_BASE_URL || '') + '/api' });

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('hc_admin_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    if (err.response?.status === 401) {
      localStorage.removeItem('hc_admin_token');
      if (window.location.pathname !== '/login') window.location.href = '/login';
    }
    return Promise.reject(err);
  }
);

export default api;

export const authApi = {
  login: (data) => api.post('/auth/login', data),
  me: () => api.get('/auth/me'),
};

// Admin-gated monetization surfaces (requireAuth + requireAdmin on the server).
export const monetizationApi = {
  get: () => api.get('/monetization-config'),
  update: (data) => api.put('/monetization-config', data),
  households: () => api.get('/monetization-config/households'),
  setPlan: (payload) => api.post('/monetization-config/plan', payload),
};
