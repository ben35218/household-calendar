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

// Admin ops surfaces: users, E2EE readiness, audit log (requireAdmin-gated).
// `users` and `audit` return { items, total, page, pageSize }.
export const adminApi = {
  users: (params) => api.get('/admin/users', { params }),
  setRole: (id, role) => api.post(`/admin/users/${id}/role`, { role }),
  e2ee: () => api.get('/admin/e2ee'),
  e2eeDetail: (householdId) => api.get(`/admin/e2ee/${householdId}`),
  nudge: (householdId) => api.post(`/admin/e2ee/${householdId}/nudge`),
  audit: (params) => api.get('/admin/audit', { params }),
};

// Content-blind product-usage analytics (requireAdmin-gated).
export const analyticsApi = {
  overview: () => api.get('/admin/analytics/overview'),
  growth: (weeks) => api.get('/admin/analytics/growth', { params: { weeks } }),
  platforms: () => api.get('/admin/analytics/platforms'),
  usage: (weeks) => api.get('/admin/analytics/usage', { params: { weeks } }),
  activity: (weeks) => api.get('/admin/analytics/activity', { params: { weeks } }),
  retention: (weeks) => api.get('/admin/analytics/retention', { params: { weeks } }),
};
