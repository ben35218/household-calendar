import api from './client';

// Typed endpoint groups ported from client/src/services/api.js. Wave 1 (Tasks &
// Chores) fills out the maintenance surface: tasks, chores, their templates,
// plus the supporting groups their screens need (categories, items, history,
// settings, odometer, people). Remaining groups (inventory, recipes, trips, …)
// follow the same one-line-per-endpoint pattern and land with their waves.

export interface User {
  _id: string;
  email: string;
  firstName: string;
  lastName?: string;
  role?: 'user' | 'admin';
  householdId?: string; // used as the RevenueCat app_user_id
}

export interface AuthResponse {
  token: string;
  user: User;
}

export const authApi = {
  login: (data: { email: string; password: string }) =>
    api.post<AuthResponse>('/auth/login', data),
  register: (data: { email: string; password: string; firstName: string; lastName?: string }) =>
    api.post<AuthResponse>('/auth/register', data),
  me: () => api.get<User>('/auth/me'),
  updateEmail: (data: { email: string; password: string }) => api.put('/auth/email', data),
  updatePassword: (data: { currentPassword: string; newPassword: string }) =>
    api.put('/auth/password', data),
};

// E2EE key material (Phase 1). The server is a blind store: it only sees the
// identity PUBLIC key and the private key wrapped as opaque factor envelopes.
// All crypto happens on-device in lib/e2ee.ts.
export interface StoredKeyMaterial {
  enrolled: boolean;
  identityPublicKey: string | null;
  wrappedPrivateKey: unknown[];
  keyEnrolledAt: string | null;
  keySchemaVersion: number;
}

export const keysApi = {
  me: () => api.get<StoredKeyMaterial>('/keys/me'),
  enroll: (data: { identityPublicKey: string; factors: unknown[] }) => api.post('/keys/enroll', data),
  putFactor: (envelope: unknown) => api.put('/keys/factors', envelope),
  removeFactor: (factor: string, credentialId?: string) =>
    api.delete(`/keys/factors/${factor}`, { params: credentialId ? { credentialId } : {} }),
  publicKey: (userId: string) => api.get<{ userId: string; identityPublicKey: string }>(`/keys/public/${userId}`),
};

// ----- Recurrence (shared by tasks, chores, and their templates) -------------

export type RecurrenceType = 'interval' | 'calendar' | 'one-time';
export type IntervalUnit = 'days' | 'weeks' | 'months' | 'years';

export interface Recurrence {
  type: RecurrenceType;
  intervalValue?: number;
  intervalUnit?: IntervalUnit;
  months?: number[];
  dayOfMonth?: number | null;
  dayOfWeek?: number | null;
  weekOfMonth?: number | null;
}

// ----- Tasks (maintenance) ---------------------------------------------------

export interface LinkedRef {
  _id: string;
  name: string;
}

export interface Task {
  _id: string;
  title: string;
  description?: string;
  instructions?: string;
  active?: boolean;
  categoryId?: LinkedRef | string | null;
  subcategoryId?: LinkedRef | string | null;
  itemId?: LinkedRef | string | null;
  templateId?: string;
  priority?: 'low' | 'medium' | 'high';
  estimatedDurationMins?: number;
  estimatedCost?: number;
  nextDueDate?: string;
  lastCompletedAt?: string;
  recurrence?: Recurrence;
  weatherSensitive?: boolean;
  reminderDaysBefore?: number | null;
  alert2DaysBefore?: number | null;
  alertAudience?: 'everyone' | 'owner';
  // mileage-tracked tasks
  intervalKm?: number;
  lastServiceKm?: number;
  nextDueKm?: number;
}

export interface Completion {
  _id: string;
  completedDate: string;
  performedBy?: string;
  cost?: number;
  notes?: string;
}

export const tasksApi = {
  list: (params?: Record<string, unknown>) => api.get<Task[]>('/tasks', { params }),
  get: (id: string) => api.get<Task>(`/tasks/${id}`),
  create: (data: Record<string, unknown>) => api.post<Task>('/tasks', data),
  update: (id: string, data: Record<string, unknown>) => api.put<Task>(`/tasks/${id}`, data),
  delete: (id: string) => api.delete(`/tasks/${id}`),
  complete: (id: string, data?: Record<string, unknown>) =>
    api.post<{ task: Task; completion: Completion }>(`/tasks/${id}/complete`, data),
  pause: (id: string) => api.post(`/tasks/${id}/pause`),
  resume: (id: string) => api.post(`/tasks/${id}/resume`),
  fromTemplate: (data: { templateIds: string[]; categoryId?: string }) =>
    api.post<Task[]>('/tasks/from-template', data),
  templates: (params?: Record<string, unknown>) => api.get<TaskTemplate[]>('/task-templates', { params }),
  template: (id: string) => api.get<TaskTemplate>(`/task-templates/${id}`),
  completions: (params?: Record<string, unknown>) => api.get<Completion[]>('/tasks/completions', { params }),
};

export interface TaskTemplate {
  id: string;
  title: string;
  recurrence?: Recurrence;
  priority?: 'low' | 'medium' | 'high';
  estimatedDurationMins?: number;
  estimatedCost?: number;
  intervalKm?: number;
  defaultCategoryName?: string;
}

// ----- Chores ----------------------------------------------------------------

export interface ChoreAssignee {
  _id?: string;
  accountId?: string;
  name?: string;
}

export interface Chore {
  _id: string;
  title: string;
  instructions?: string;
  description?: string;
  icon?: string;
  active?: boolean;
  assignedTo?: ChoreAssignee | string | null;
  nextDueDate?: string;
  recurrence?: Recurrence;
  reminderDaysBefore?: number | null;
  alert2DaysBefore?: number | null;
  alertAudience?: 'everyone' | 'owner';
}

export interface ChoreTemplate {
  id: string;
  title: string;
  icon?: string;
  recurrence?: Recurrence;
  defaultCategoryName?: string;
}

export const choresApi = {
  list: (params?: Record<string, unknown>) => api.get<Chore[]>('/chores', { params }),
  get: (id: string) => api.get<Chore>(`/chores/${id}`),
  create: (data: Record<string, unknown>) => api.post<Chore>('/chores', data),
  update: (id: string, data: Record<string, unknown>) => api.put<Chore>(`/chores/${id}`, data),
  delete: (id: string) => api.delete(`/chores/${id}`),
  pause: (id: string) => api.post(`/chores/${id}/pause`),
  resume: (id: string) => api.post(`/chores/${id}/resume`),
  fromTemplate: (data: { templateIds: string[] }) => api.post<Chore[]>('/chores/from-template', data),
  templates: (params?: Record<string, unknown>) => api.get<ChoreTemplate[]>('/chore-templates', { params }),
  template: (id: string) => api.get<ChoreTemplate>(`/chore-templates/${id}`),
};

// ----- Supporting groups for the maintenance screens -------------------------

export interface Category {
  _id: string;
  name: string;
  color?: string;
  icon?: string;
  parent?: string | null;
}

export const categoriesApi = {
  list: (params?: Record<string, unknown>) => api.get<Category[]>('/categories', { params }),
  create: (data: Record<string, unknown>) => api.post<Category>('/categories', data),
  update: (id: string, data: Record<string, unknown>) => api.put<Category>(`/categories/${id}`, data),
  delete: (id: string, reassignTo?: string) =>
    api.delete(`/categories/${id}`, { data: { reassignTo } }),
};

export interface CustomField {
  key: string;
  value: string;
}

export interface Manual {
  _id: string;
  title: string;
  source: string;
  fileSizeBytes: number;
  encrypted?: boolean; // E2EE (Phase 4c): opaque ciphertext; view on web for now
}

export interface Item {
  _id: string;
  name: string;
  type?: string;
  location?: string;
  categoryId?: LinkedRef | string | null;
  manufacturer?: string;
  modelNumber?: string;
  serialNumber?: string;
  purchaseDate?: string;
  warrantyExpiry?: string;
  notes?: string;
  customFields?: CustomField[];
  manuals?: Manual[];
  autoLookupManual?: boolean;
}

export const itemsApi = {
  list: (params?: Record<string, unknown>) => api.get<Item[]>('/items', { params }),
  get: (id: string) => api.get<Item>(`/items/${id}`),
  create: (data: Record<string, unknown>) => api.post<Item>('/items', data),
  update: (id: string, data: Record<string, unknown>) => api.put<Item>(`/items/${id}`, data),
  delete: (id: string) => api.delete(`/items/${id}`),
  // fromPhoto is handled via lib/upload (multipart); endpoint: POST /items/from-photo
};

export interface ManualCandidate {
  url: string;
  title?: string;
  domain?: string;
  snippet?: string;
  recommended?: boolean;
}

export interface ExtractedTask {
  title: string;
  description?: string;
  priority?: 'low' | 'medium' | 'high';
  recurrence?: Recurrence;
}

export const manualsApi = {
  fromUrl: (itemId: string, data: { url: string; title?: string }) =>
    api.post(`/manuals/items/${itemId}/from-url`, data),
  autoLookup: (itemId: string) =>
    api.post<{ candidates: ManualCandidate[]; query?: string; isFallback?: boolean }>(
      `/manuals/items/${itemId}/auto-lookup`
    ),
  extractTasks: (id: string) =>
    api.post<{ tasks: ExtractedTask[]; manualTitle?: string }>(`/manuals/${id}/extract-tasks`),
  createTasks: (id: string, data: Record<string, unknown>) => api.post(`/manuals/${id}/create-tasks`, data),
  delete: (id: string) => api.delete(`/manuals/${id}`),
  // upload is handled via lib/upload (multipart, field 'file'); endpoint:
  //   POST /manuals/items/:itemId/upload
  // download is a token-query URL built in the screen via downloadUrl():
  //   GET /manuals/:id/download?token=…
};

export interface InventoryItem {
  _id: string;
  name: string;
  quantity?: string;
  category?: string;
  purchaseDate?: string;
  expirationDate?: string;
  notes?: string;
  status?: 'active' | 'used' | 'thrown_out';
  statusDate?: string;
  wasteReason?: string;
}

export interface ReceiptExtraction {
  storeName?: string;
  items: {
    name: string;
    quantity?: string;
    category?: string;
    estimated_days_until_expiry?: number | null;
  }[];
}

export interface Ingredient {
  amount?: string;
  unit?: string;
  name: string;
}

export interface Recipe {
  _id: string;
  title: string;
  description?: string;
  imageUrl?: string;
  sourceUrl?: string;
  source?: 'manual' | 'ai' | 'url' | 'photo';
  servings?: number | null;
  prepTimeMins?: number | null;
  cookTimeMins?: number | null;
  tags?: string[];
  ingredients?: Ingredient[];
  instructions?: string[];
  // Per-step ingredient links: instructionIngredients[stepIdx] = ingredient indices.
  instructionIngredients?: number[][];
  // Per-step timer in minutes (parallel to instructions); null = no timer.
  instructionTimers?: (number | null)[];
}

export const recipesApi = {
  list: () => api.get<Recipe[]>('/recipes'),
  get: (id: string) => api.get<Recipe>(`/recipes/${id}`),
  create: (data: Record<string, unknown>) => api.post<Recipe>('/recipes', data),
  update: (id: string, data: Record<string, unknown>) => api.put<Recipe>(`/recipes/${id}`, data),
  delete: (id: string) => api.delete(`/recipes/${id}`),
  fromUrl: (url: string) => api.post<Partial<Recipe>>('/recipes/from-url', { url }),
  generateFromAi: (description: string) => api.post<Partial<Recipe>>('/recipes/generate', { description }),
  editWithAi: (recipe: Record<string, unknown>, instruction: string) =>
    api.post<Partial<Recipe>>('/recipes/edit-with-ai', { recipe, instruction }),
  computeIngredientTags: (ingredients: Ingredient[], instructions: string[]) =>
    api.post<{ instructionIngredients: number[][] }>('/recipes/compute-ingredient-tags', { ingredients, instructions }),
  // fromPhoto handled via lib/upload (field 'photo'): POST /recipes/from-photo
};

export interface RecipeSchedule {
  _id: string;
  recipeId: { _id: string; title?: string } | string;
  scheduledDate: string;
  servings?: number;
}

export interface GroceryItem {
  name: string;
  amount?: string;
}

export const recipeScheduleApi = {
  list: (params?: Record<string, unknown>) => api.get<RecipeSchedule[]>('/recipe-schedule', { params }),
  schedule: (data: { recipeId: string; scheduledDate: string; servings?: number }) =>
    api.post('/recipe-schedule', data),
  update: (id: string, data: Record<string, unknown>) => api.put(`/recipe-schedule/${id}`, data),
  remove: (id: string) => api.delete(`/recipe-schedule/${id}`),
  forRecipe: (recipeId: string) => api.get<RecipeSchedule[]>(`/recipe-schedule/for-recipe/${recipeId}`),
  groceryList: (weekStart: string) =>
    api.get<{ groceryList: GroceryItem[] }>('/recipe-schedule/grocery-list', { params: { weekStart } }),
  organizeGroceryList: (items: GroceryItem[], sectionOrder?: string[]) =>
    api.post<OrganizedGroceryList>('/recipe-schedule/organize-grocery-list', {
      items,
      sectionOrder: sectionOrder?.length ? sectionOrder : undefined,
    }),
  sessionGet: (weekStart: string) =>
    api.get<GrocerySessionState>('/recipe-schedule/session', { params: { weekStart } }),
  sessionPut: (weekStart: string, state: GrocerySessionState) =>
    api.put('/recipe-schedule/session', { weekStart, state }),
};

export interface OrganizedGroceryList {
  store_known?: boolean;
  categories: { name: string; items: GroceryItem[] }[];
}

export interface GrocerySessionState {
  checked?: Record<string, boolean>;
  substitutions?: Record<string, string>;
  notFound?: Record<string, boolean>;
  haveHome?: Record<string, boolean>;
  organizedList?: OrganizedGroceryList | null;
}

export const inventoryApi = {
  list: (params?: Record<string, unknown>) => api.get<InventoryItem[]>('/inventory', { params }),
  create: (data: Record<string, unknown>) => api.post<InventoryItem>('/inventory', data),
  update: (id: string, data: Record<string, unknown>) => api.put<InventoryItem>(`/inventory/${id}`, data),
  consume: (id: string, data: { action: 'used' | 'thrown_out'; wasteReason?: string }) =>
    api.post(`/inventory/${id}/consume`, data),
  delete: (id: string) => api.delete(`/inventory/${id}`),
  fromText: (text: string) => api.post<ReceiptExtraction>('/inventory/from-receipt-text', { text }),
  batch: (items: Record<string, unknown>[]) => api.post('/inventory/batch', { items }),
  suggestRecipes: (params: { itemNames?: string[]; ingredientMode?: string; query?: string }) =>
    api.post('/inventory/suggest-recipes', params),
  // fromPhoto (receipt) handled via lib/upload (field 'photo'):
  //   POST /inventory/from-receipt-photo
};

export const historyApi = {
  list: (params?: Record<string, unknown>) => api.get<Completion[]>('/history', { params }),
};

export interface Settings {
  householdMemberCount?: number;
  firstName?: string;
  lastName?: string;
  birthday?: string;
  timezone?: string;
  homeAddress?: string;
  reminderLeadDays?: number;
  groceryShoppingDay?: number;
  grocerySections?: string[];
  [key: string]: unknown;
}

export const settingsApi = {
  get: () => api.get<Settings>('/settings'),
  update: (data: Record<string, unknown>) => api.put<Settings>('/settings', data),
};

export interface OdometerLog {
  _id: string;
  reading: number;
  notes?: string;
  recordedAt: string;
}

export interface OdometerStatus {
  currentKm: number | null;
  kmPerDay?: number | null;
  logs?: OdometerLog[];
  mileageTasks?: unknown[];
}

export const odometerApi = {
  get: (itemId: string) => api.get<OdometerStatus>(`/vehicles/${itemId}/odometer`),
  log: (itemId: string, data: Record<string, unknown>) => api.post(`/vehicles/${itemId}/odometer`, data),
  delete: (itemId: string, logId: string) => api.delete(`/vehicles/${itemId}/odometer/${logId}`),
};

export interface Person {
  _id: string;
  name: string;
  type: 'family' | 'friend' | 'service' | string;
  accountId?: string;
  relationship?: string;
  birthday?: string;
  email?: string;
  phone?: string;
  address?: string;
  interests?: string[];
  notes?: string;
}

export const peopleApi = {
  list: (params?: Record<string, unknown>) => api.get<Person[]>('/people', { params }),
  create: (data: Record<string, unknown>) => api.post<Person>('/people', data),
  createSelf: (data: Record<string, unknown>) => api.post<Person>('/people/self', data),
  update: (id: string, data: Record<string, unknown>) => api.put<Person>(`/people/${id}`, data),
  delete: (id: string) => api.delete(`/people/${id}`),
  bulk: (people: Record<string, unknown>[]) => api.post('/people/bulk', { people }),
};

// ----- Household (sharing) ---------------------------------------------------

export interface HouseholdMember {
  _id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
}

export interface Household {
  _id: string;
  name: string;
  joinCode: string;
  ownerId: string;
  homeAddress?: string;
  // True once the household's plaintext has been dropped (§9). Gates the
  // client-side encrypted self-Person seed.
  e2eeActive?: boolean;
  members: HouseholdMember[];
}

// Approve-on-device join (Phase 2).
export interface JoinRequestMine {
  status: 'none' | 'pending' | 'approved' | 'rejected';
  requestId?: string;
  name?: string | null;
}
export interface JoinRequestForApprover {
  _id: string;
  requesterUserId: string;
  requesterPublicKey: string;
  firstName?: string | null;
  lastName?: string | null;
  email?: string | null;
  createdAt: string;
}
export interface HDKEnvelopePayload {
  wrappedHDK: string;
  keyVersion: number;
}
export interface HouseholdKeyState {
  householdId: string;
  currentKeyVersion: number;
  isOwner: boolean;
  envelopes: { keyVersion: number; wrappedHDK: string }[];
}

export const householdApi = {
  get: () => api.get<Household>('/household'),
  rename: (name: string) => api.put<Household>('/household', { name }),
  join: (joinCode: string) => api.post<{ status: string; requestId?: string; name?: string; householdId?: string }>('/household/join', { joinCode }),
  myJoinRequest: () => api.get<JoinRequestMine>('/household/join-requests/mine'),
  cancelJoinRequest: () => api.delete('/household/join-requests/mine'),
  joinRequests: () => api.get<JoinRequestForApprover[]>('/household/join-requests'),
  approveJoin: (id: string, envelope: HDKEnvelopePayload) => api.post(`/household/join-requests/${id}/approve`, envelope),
  rejectJoin: (id: string) => api.post(`/household/join-requests/${id}/reject`),
  getKey: () => api.get<HouseholdKeyState>('/household/key'),
  mintKey: (envelope: HDKEnvelopePayload) => api.post('/household/key', envelope),
  leave: () => api.post('/household/leave'),
};

// ----- Places (Google Places proxy; powers address autocomplete) -------------

export interface PlacePrediction {
  place_id: string;
  description: string;
  main_text?: string;
  secondary_text?: string;
}

export const placesApi = {
  autocomplete: (query: string, type?: string) =>
    api.get<{ predictions: PlacePrediction[] }>('/places/autocomplete', {
      params: { query, ...(type ? { type } : {}) },
    }),
  getDetails: (placeId: string) => api.get(`/places/details/${placeId}`),
  getTimezone: (placeId: string) => api.get<{ timeZoneId?: string }>(`/places/timezone/${placeId}`),
  getTravelTime: (destination: string, origin?: string) =>
    api.get<{ minutes: number; distanceKm: string }>('/places/travel-time', {
      params: { destination, origin: origin || undefined },
    }),
  routeLeg: (payload: Record<string, unknown>) => api.post('/places/route-leg', payload),
};

// ----- Trips / Vacations -----------------------------------------------------

export type TripStatus = 'considering' | 'booked' | 'completed';
export type TripItemType =
  | 'flight' | 'hotel' | 'car-rental' | 'restaurant' | 'activity' | 'transit' | 'other';

export interface TripItem {
  _id: string;
  type: TripItemType;
  title: string;
  start: string;
  end?: string;
  location?: string;
  details?: Record<string, unknown>;
  cost?: number | null;
  currency?: string;
  confirmation?: string;
  confirmed?: boolean;
  sharing?: string;
  notes?: string;
  url?: string;
  phone?: string;
  placeId?: string;
  address?: string;
  householdId?: string;
  paidByHouseholdId?: string;
  myData?: { cost?: number | null; currency?: string; confirmation?: string; confirmed?: boolean; partySize?: number };
  shares?: { householdId: string; amount?: number | null }[];
  participants?: string[];
  attachments?: { _id: string; name: string }[];
  userId?: { firstName?: string };
}

export interface CandidateRange {
  start: string;
  end: string;
  label?: string;
  note?: string;
}

export interface Trip {
  _id: string;
  name: string;
  destination?: string;
  destinationTz?: string;
  status: TripStatus;
  startDate?: string;
  endDate?: string;
  color?: string;
  notes?: string;
  candidateRanges?: CandidateRange[];
  items?: TripItem[];
  collaborators?: { _id: string; firstName?: string; lastName?: string; email?: string }[];
  shareCode?: string;
}

export interface TripBudget {
  total: number;
  budget?: number | null;
  remaining: number;
  baseCurrency: string;
  costedCount?: number;
  byType: { type: string; amount: number }[];
}

export interface SettlementPayment {
  _id: string;
  fromName: string;
  toName: string;
  amount: number;
  currency?: string;
  note?: string;
  date?: string;
}

export interface SettlementLine {
  kind?: 'booking' | 'payment';
  itemId?: string;
  type?: string;
  title?: string;
  amount: number;
}

export interface SettlementBalance {
  from?: string;
  to?: string;
  fromName: string;
  toName: string;
  amount: number;
  lines?: SettlementLine[];
}

export interface HouseholdOption {
  householdId: string;
  name: string;
}

export interface Settlement {
  baseCurrency: string;
  ratesAvailable?: boolean;
  balances: SettlementBalance[];
  payments?: SettlementPayment[];
  households?: HouseholdOption[];
  myHouseholdId?: string | null;
}

export const tripsApi = {
  list: (params?: Record<string, unknown>) => api.get<Trip[]>('/trips', { params }),
  get: (id: string) => api.get<Trip>(`/trips/${id}`),
  create: (data: Record<string, unknown>) => api.post<Trip>('/trips', data),
  update: (id: string, data: Record<string, unknown>) => api.put<Trip>(`/trips/${id}`, data),
  remove: (id: string) => api.delete(`/trips/${id}`),
  budget: (id: string) => api.get<TripBudget>(`/trips/${id}/budget`),
  families: (id: string) => api.get<{ householdId: string; name: string }[]>(`/trips/${id}/families`),
  settlement: (id: string) => api.get<Settlement>(`/trips/${id}/settlement`),
  addPayment: (id: string, data: Record<string, unknown>) => api.post(`/trips/${id}/settle-payments`, data),
  removePayment: (id: string, payId: string) => api.delete(`/trips/${id}/settle-payments/${payId}`),
  addItem: (id: string, data: Record<string, unknown>) => api.post<TripItem>(`/trips/${id}/items`, data),
  updateItem: (id: string, itemId: string, data: Record<string, unknown>) =>
    api.put<TripItem>(`/trips/${id}/items/${itemId}`, data),
  removeItem: (id: string, itemId: string) => api.delete(`/trips/${id}/items/${itemId}`),
  share: (id: string) => api.post<{ shareCode: string }>(`/trips/${id}/share`),
  unshare: (id: string) => api.delete(`/trips/${id}/share`),
  joinShare: (shareCode: string) => api.post<{ tripId: string }>('/trips/join', { shareCode }),
  leaveShare: (id: string) => api.post(`/trips/${id}/leave-share`),
};

// ----- Calendar & billing (foundation; expanded in their waves) --------------

export interface CalendarEvent {
  _id: string;
  title: string;
  calendarType: string;
  allDay?: boolean;
  startDate: string;
  endDate?: string;
  description?: string;
  location?: string;
  phone?: string;
  travelMinutes?: number | null;
  travelDistanceKm?: string | null;
  reminderMinutes?: number | null;
  alert2Minutes?: number | null;
  recurrence?: { freq: string; interval?: number; until?: string };
  // E2EE dual-write (Phase 3a): opaque ciphertext of the content + its key version.
  keyVersion?: number;
  enc?: { alg: string; nonce: string; ct: string };
}

export interface CalendarBirthday {
  id: string;
  name: string;
  date: string;
}

export interface CalendarRecipeSchedule {
  _id?: string;
  scheduledDate: string;
  recipeId?: { _id: string; title?: string } | string;
}

export interface CalendarTripOverlay {
  id: string;
  name: string;
  color?: string;
  status?: string;
  ranges: { start: string; end: string; label?: string }[];
}

// The /calendar aggregate (server: services/calendarData.js).
export interface CalendarData {
  tasks: Task[];
  chores: Chore[];
  events: CalendarEvent[];
  birthdays: CalendarBirthday[];
  recipes: CalendarRecipeSchedule[];
  groceryShopping: { id: string; date: string }[];
  trips: CalendarTripOverlay[];
}

export const calendarApi = {
  get: (params?: { from?: string; to?: string }) => api.get<CalendarData>('/calendar', { params }),
  getEvent: (id: string) => api.get<CalendarEvent>(`/calendar/events/${id}`),
  createEvent: (data: Record<string, unknown>) => api.post<CalendarEvent>('/calendar/events', data),
  updateEvent: (id: string, data: Record<string, unknown>) => api.put<CalendarEvent>(`/calendar/events/${id}`, data),
  deleteEvent: (id: string) => api.delete(`/calendar/events/${id}`),
};

export interface BillingStatus {
  plan: string;
  planLabel: string;
  usage: Record<string, number>;
  quotas: Record<string, number | null>;
  resetsAt?: string; // ISO instant of the next weekly usage reset (Wed 5PM ET)
  hasHousehold: boolean;
  catalog: { key: string; label: string; price: number }[];
}

export const billingApi = {
  status: () => api.get<BillingStatus>('/billing/status'),
};

// ----- Weather ---------------------------------------------------------------

export interface WeatherHour {
  time: string;
  hour: number;
  temperature: number;
  precipProbability: number;
  precipitation: number;
  weatherCode: number;
  description?: string;
}

export interface WeatherData {
  current: { temperature: number; weatherCode: number; description: string; humidity: number; windSpeed: number; precipitation: number };
  units: { temperature: string; wind: string; precipitation: string };
  forecast: { date: string; weatherCode: number; tempMax: number; tempMin: number; precipProbability: number; precipSum: number; goodWeather?: boolean; hours?: WeatherHour[] }[];
}

export interface OutlookWeek {
  startDate: string;
  endDate: string;
  avgTempMax: number;
  avgTempMin: number;
  totalPrecip: number;
  rainyDays: number;
  yearsInSample?: number;
}

export const weatherApi = {
  get: () => api.get<WeatherData>('/weather'),
  range: (from: string, to: string) => api.get('/weather/range', { params: { from, to } }),
  outlook: () => api.get<{ weeks: OutlookWeek[] }>('/weather/outlook'),
};

// Native push device registration (server: routes/notifications.js).
export const notificationsApi = {
  registerNative: (expoToken: string, platform: 'ios' | 'android', label?: string) =>
    api.post('/notifications/push/register-native', { expoToken, platform, label }),
  unregisterNative: (expoToken: string) =>
    api.post('/notifications/push/unregister-native', { expoToken }),
  // Tell the server this device schedules reminders on-device, so its push cron
  // skips this user (Phase 5).
  setLocalReminders: (enabled: boolean) =>
    api.post('/notifications/local-reminders', { enabled }),
};

// ----- AI form-fill assistant (server: routes/formAssist.js) -----------------
// A form describes its fields; the server asks Claude to map a plain-language
// request onto them and returns a patch keyed by field name.

export type FormAssistFieldType =
  | 'text'
  | 'number'
  | 'date'
  | 'time'
  | 'boolean'
  | 'select'
  | 'multiselect';

export interface FormAssistField {
  name: string;
  type: FormAssistFieldType;
  label: string;
  description?: string;
  options?: { label: string; value: string | number }[];
}

export interface FormAssistResponse {
  patch: Record<string, unknown>;
  note?: string;
}

export const formAssistApi = {
  fill: (data: {
    formType: string;
    fields: FormAssistField[];
    current: Record<string, unknown>;
    prompt: string;
    // When true, the server injects the household's saved contacts (name +
    // address for friends/family; name/service/address/phone for services) so
    // the assistant can resolve people/businesses the user names.
    includeContacts?: boolean;
  }) => api.post<FormAssistResponse>('/form-assist', data),
};
