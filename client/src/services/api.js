import axios from 'axios';

const api = axios.create({ baseURL: '/api' });

api.interceptors.request.use(config => {
  const token = localStorage.getItem('hc_token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) {
      localStorage.removeItem('hc_token');
      window.location.href = '/login';
    }
    // Quota exhausted on a metered AI feature — surface a global upgrade prompt
    // (App.vue listens). Callers can still handle the rejection themselves.
    if (err.response?.status === 402 && err.response?.data?.code === 'QUOTA_EXCEEDED') {
      window.dispatchEvent(new CustomEvent('hc:quota', { detail: err.response.data }));
    }
    return Promise.reject(err);
  }
);

export default api;

export const authApi = {
  register: (data) => api.post('/auth/register', data),
  login: (data) => api.post('/auth/login', data),
  me: () => api.get('/auth/me'),
  updateEmail: (data) => api.put('/auth/email', data),
  updatePassword: (data) => api.put('/auth/password', data),
};

// E2EE key material (Phase 1). The server is a blind store: it only ever sees
// the identity PUBLIC key and the private key wrapped as opaque factor
// envelopes. All crypto happens client-side in services/e2ee.js.
export const keysApi = {
  me: () => api.get('/keys/me'),
  enroll: (data) => api.post('/keys/enroll', data),
  putFactor: (envelope) => api.put('/keys/factors', envelope),
  removeFactor: (factor, credentialId) =>
    api.delete(`/keys/factors/${factor}`, { params: credentialId ? { credentialId } : {} }),
  publicKey: (userId) => api.get(`/keys/public/${userId}`),
};

export const categoriesApi = {
  list: (params) => api.get('/categories', { params }),
  create: (data) => api.post('/categories', data),
  update: (id, data) => api.put(`/categories/${id}`, data),
  delete: (id, reassignTo) => api.delete(`/categories/${id}`, { data: { reassignTo } }),
};

export const itemsApi = {
  list: (params) => api.get('/items', { params }),
  get: (id) => api.get(`/items/${id}`),
  create: (data) => api.post('/items', data),
  update: (id, data) => api.put(`/items/${id}`, data),
  delete: (id) => api.delete(`/items/${id}`),
  fromPhoto: (file) => { const f = new FormData(); f.append('photo', file); return api.post('/items/from-photo', f); },
};

export const manualsApi = {
  upload: (itemId, formData) => api.post(`/manuals/items/${itemId}/upload`, formData, { headers: { 'Content-Type': 'multipart/form-data' } }),
  fromUrl: (itemId, data) => api.post(`/manuals/items/${itemId}/from-url`, data),
  autoLookup: (itemId) => api.post(`/manuals/items/${itemId}/auto-lookup`),
  proxyUrl: (url) => `/api/manuals/proxy?token=${localStorage.getItem('hc_token')}&url=${encodeURIComponent(url)}`,
  extractTasks: (id) => api.post(`/manuals/${id}/extract-tasks`),
  createTasks: (id, data) => api.post(`/manuals/${id}/create-tasks`, data),
  download: (id) => `/api/manuals/${id}/download?token=${localStorage.getItem('hc_token')}`,
  // Authenticated fetch of the raw bytes (ciphertext for encrypted manuals).
  downloadBytes: (id) => api.get(`/manuals/${id}/download`, { responseType: 'arraybuffer' }),
  delete: (id) => api.delete(`/manuals/${id}`),
};

export const tasksApi = {
  list: (params) => api.get('/tasks', { params }),
  get: (id) => api.get(`/tasks/${id}`),
  create: (data) => api.post('/tasks', data),
  update: (id, data) => api.put(`/tasks/${id}`, data),
  delete: (id) => api.delete(`/tasks/${id}`),
  complete: (id, data) => api.post(`/tasks/${id}/complete`, data),
  pause: (id) => api.post(`/tasks/${id}/pause`),
  resume: (id) => api.post(`/tasks/${id}/resume`),
  fromTemplate: (data) => api.post('/tasks/from-template', data),
  templates: (params) => api.get('/task-templates', { params }),
  template:  (id)     => api.get(`/task-templates/${id}`),
  completions: (params) => api.get('/tasks/completions', { params }),
};

export const choresApi = {
  list: (params) => api.get('/chores', { params }),
  get: (id) => api.get(`/chores/${id}`),
  create: (data) => api.post('/chores', data),
  update: (id, data) => api.put(`/chores/${id}`, data),
  delete: (id) => api.delete(`/chores/${id}`),
  pause: (id) => api.post(`/chores/${id}/pause`),
  resume: (id) => api.post(`/chores/${id}/resume`),
  fromTemplate: (data) => api.post('/chores/from-template', data),
  templates: (params) => api.get('/chore-templates', { params }),
  template:  (id)     => api.get(`/chore-templates/${id}`),
};

export const odometerApi = {
  get: (itemId) => api.get(`/vehicles/${itemId}/odometer`),
  log: (itemId, data) => api.post(`/vehicles/${itemId}/odometer`, data),
  delete: (itemId, logId) => api.delete(`/vehicles/${itemId}/odometer/${logId}`),
};

// Note: the calendar & maintenance chat assistants use SSE streaming and are
// driven directly via fetch in the useChat composable, not through axios here.

export const calendarApi = {
  get:         (params)   => api.get('/calendar', { params }),
  getRaw:      (params)   => api.get('/calendar/raw', { params }),
  getEvent:    (id)       => api.get(`/calendar/events/${id}`),
  createEvent: (data)     => api.post('/calendar/events', data),
  updateEvent: (id, data) => api.put(`/calendar/events/${id}`, data),
  deleteEvent: (id)       => api.delete(`/calendar/events/${id}`),
};

export const placesApi = {
  autocomplete: (query, type) => api.get('/places/autocomplete', { params: { query, ...(type ? { type } : {}) } }),
  getDetails:   (placeId)     => api.get(`/places/details/${placeId}`),
  getTimezone:  (placeId)     => api.get(`/places/timezone/${placeId}`),
  getTravelTime:(destination, origin) => api.get('/places/travel-time', { params: { destination, origin: origin || undefined } }),
  routeLeg:     (payload)     => api.post('/places/route-leg', payload),
};

export const historyApi = {
  list: (params) => api.get('/history', { params }),
};

export const settingsApi = {
  get: () => api.get('/settings'),
  update: (data) => api.put('/settings', data),
};

// Push is the only notification channel; this just manages push devices.
export const notificationsApi = {
  pushKey:     ()       => api.get('/notifications/push/key'),
  subscribe:   (subscription, label) => api.post('/notifications/push/subscribe', { subscription, label }),
  unsubscribe: (endpoint)            => api.post('/notifications/push/unsubscribe', { endpoint }),
};

export const householdApi = {
  get:    ()        => api.get('/household'),
  rename: (name)    => api.put('/household', { name }),
  // Approve-on-device join: request → wait for a member to approve (Phase 2).
  join:   (joinCode) => api.post('/household/join', { joinCode }),
  myJoinRequest:    () => api.get('/household/join-requests/mine'),
  cancelJoinRequest: () => api.delete('/household/join-requests/mine'),
  joinRequests:     () => api.get('/household/join-requests'),
  approveJoin: (id, envelope) => api.post(`/household/join-requests/${id}/approve`, envelope),
  rejectJoin:  (id) => api.post(`/household/join-requests/${id}/reject`),
  // HDK envelopes.
  getKey:  ()          => api.get('/household/key'),
  mintKey: (envelope)  => api.post('/household/key', envelope),
  leave:   ()          => api.post('/household/leave'),
};

export const billingApi = {
  status: ()     => api.get('/billing/status'),
  // Placeholder upgrade — applies the plan instantly (no payment). Real payments
  // will be handled in the mobile app.
  select: (tier) => api.post('/billing/select', { tier }),
};

// TEMP: unauthenticated monetization admin config (moves to admin app pre-launch).
export const monetizationApi = {
  get:        ()             => api.get('/monetization-config'),
  update:     (data)         => api.put('/monetization-config', data),
  households: ()             => api.get('/monetization-config/households'),
  setPlan:    (payload)      => api.post('/monetization-config/plan', payload),
};

export const weatherApi = {
  get:     ()         => api.get('/weather'),
  range:   (from, to) => api.get('/weather/range', { params: { from, to } }),
  outlook: ()         => api.get('/weather/outlook'),
};

export const peopleApi = {
  list:      ()          => api.get('/people'),
  create:    (data)      => api.post('/people', data),
  createSelf:(data)      => api.post('/people/self', data),
  update:    (id, data)  => api.put(`/people/${id}`, data),
  delete:    (id)        => api.delete(`/people/${id}`),
  importVcf: (file)      => { const fd = new FormData(); fd.append('file', file); return api.post('/people/import', fd); },
  bulk:      (people)    => api.post('/people/bulk', { people }),
};

export const recipesApi = {
  list:           ()                    => api.get('/recipes'),
  get:            (id)                  => api.get(`/recipes/${id}`),
  create:         (data)                => api.post('/recipes', data),
  fromUrl:        (url)                 => api.post('/recipes/from-url', { url }),
  fromAi:         (description)         => api.post('/recipes/from-ai', { description }),
  fromPhoto:      (file)                => { const f = new FormData(); f.append('photo', file); return api.post('/recipes/from-photo', f); },
  generateFromAi: (description)         => api.post('/recipes/generate', { description }),
  editWithAi:            (recipe, instruction)        => api.post('/recipes/edit-with-ai', { recipe, instruction }),
  computeIngredientTags: (ingredients, instructions) => api.post('/recipes/compute-ingredient-tags', { ingredients, instructions }),
  update:                (id, data)                  => api.put(`/recipes/${id}`, data),
  delete:                (id)                        => api.delete(`/recipes/${id}`),
};

export const inventoryApi = {
  list:           (params)                  => api.get('/inventory', { params }),
  create:         (data)                    => api.post('/inventory', data),
  update:         (id, data)                => api.put(`/inventory/${id}`, data),
  consume:        (id, data)                => api.post(`/inventory/${id}/consume`, data),
  delete:         (id)                      => api.delete(`/inventory/${id}`),
  fromPhoto:      (file)                    => { const f = new FormData(); f.append('photo', file); return api.post('/inventory/from-receipt-photo', f); },
  fromText:       (text)                    => api.post('/inventory/from-receipt-text', { text }),
  batch:          (items)                   => api.post('/inventory/batch', { items }),
  suggestRecipes: (itemNames, ingredientMode) => api.post('/inventory/suggest-recipes', { itemNames, ingredientMode }),
};

export const tripsApi = {
  list:       (params)        => api.get('/trips', { params }),
  get:        (id)            => api.get(`/trips/${id}`),
  budget:     (id)            => api.get(`/trips/${id}/budget`),
  families:   (id)            => api.get(`/trips/${id}/families`),
  setMyBudget:(id, data)      => api.put(`/trips/${id}/my-budget`, data),
  settlement: (id)            => api.get(`/trips/${id}/settlement`),
  addPayment: (id, data)      => api.post(`/trips/${id}/settle-payments`, data),
  removePayment: (id, payId)  => api.delete(`/trips/${id}/settle-payments/${payId}`),
  create:     (data)          => api.post('/trips', data),
  update:     (id, data)      => api.put(`/trips/${id}`, data),
  remove:     (id)            => api.delete(`/trips/${id}`),
  addItem:    (id, data)      => api.post(`/trips/${id}/items`, data),
  updateItem: (id, itemId, d) => api.put(`/trips/${id}/items/${itemId}`, d),
  removeItem: (id, itemId)    => api.delete(`/trips/${id}/items/${itemId}`),
  leaveItem:  (id, itemId)    => api.post(`/trips/${id}/items/${itemId}/leave`),
  extractConfirmation: (id, { file, text }) => {
    if (file) {
      const fd = new FormData(); fd.append('file', file);
      return api.post(`/trips/${id}/items/from-confirmation`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
    }
    return api.post(`/trips/${id}/items/from-confirmation`, { text });
  },
  addAttachment: (id, itemId, file) => {
    const fd = new FormData(); fd.append('file', file);
    return api.post(`/trips/${id}/items/${itemId}/attachments`, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
  },
  removeAttachment: (id, itemId, attId) => api.delete(`/trips/${id}/items/${itemId}/attachments/${attId}`),
  attachmentUrl:    (id, itemId, attId) => `/api/trips/${id}/items/${itemId}/attachments/${attId}/download?token=${localStorage.getItem('hc_token')}`,
  share:        (id)             => api.post(`/trips/${id}/share`),
  unshare:      (id)             => api.delete(`/trips/${id}/share`),
  joinShare:    (shareCode)      => api.post('/trips/join', { shareCode }),
  leaveShare:   (id)             => api.post(`/trips/${id}/leave-share`),
  removeCollaborator: (id, userId) => api.delete(`/trips/${id}/collaborators/${userId}`),
};

export const recipeScheduleApi = {
  list:                (params)         => api.get('/recipe-schedule', { params }),
  schedule:            (data)           => api.post('/recipe-schedule', data),
  update:              (id, data)       => api.put(`/recipe-schedule/${id}`, data),
  remove:              (id)             => api.delete(`/recipe-schedule/${id}`),
  forRecipe:           (recipeId)       => api.get(`/recipe-schedule/for-recipe/${recipeId}`),
  groceryList:         (weekStart)      => api.get('/recipe-schedule/grocery-list', { params: { weekStart } }),
  organizeGroceryList: (items, store, sectionOrder) => api.post('/recipe-schedule/organize-grocery-list', { items, store: store || undefined, sectionOrder: sectionOrder?.length ? sectionOrder : undefined }),
  sessionGet:          (weekStart)      => api.get('/recipe-schedule/session', { params: { weekStart } }),
  sessionPut:          (weekStart, state) => api.put('/recipe-schedule/session', { weekStart, state }),
};
