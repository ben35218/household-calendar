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

// Passkey sign-in ceremony payloads (WebAuthn JSON, verified server-side).
export interface PasskeyChallenge {
  challengeId: string;
  challenge: string; // b64url
  rpId: string;
  // Each registered credential with its E2EE PRF salt (when that credential is
  // also an unlock factor) so one assertion can sign in AND unlock.
  allowCredentials: { id: string; prfSalt: string | null }[];
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
  // Forgot password: emailed 6-digit code, then reset signs the user in.
  forgotPassword: (data: { email: string }) => api.post<{ ok: boolean }>('/auth/forgot', data),
  resetPassword: (data: { email: string; code: string; newPassword: string }) =>
    api.post<AuthResponse & { e2eeEnrolled: boolean }>('/auth/reset', data),
  // Passkey sign-in + server-verified registration (see routes/authPasskey.js).
  passkeyRegisterOptions: () => api.post<Record<string, unknown>>('/auth/passkey/register-options'),
  passkeyRegister: (response: unknown) => api.post('/auth/passkey/register', response),
  passkeyChallenge: (data: { email: string }) => api.post<PasskeyChallenge>('/auth/passkey/challenge', data),
  passkeyLogin: (data: { challengeId: string; response: unknown }) =>
    api.post<AuthResponse>('/auth/passkey/login', data),
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
  encrypted?: boolean;        // E2EE (Phase 4c): opaque ciphertext, decrypted on-device
  wrappedFileKey?: string;    // HDK-wrapped per-file key (JSON), needed to decrypt
  keyVersion?: number;        // which HDK version wrapped the file key
  fileType?: string;          // original mime type (for opening the decrypted file)
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
  // Styled recipe email sent by the server (share sheet emails are plain text).
  shareEmail: (id: string, email: string) => api.post(`/recipes/${id}/share-email`, { email }),
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
  phone?: string;
  timezone?: string;
  homeAddress?: string;
  reminderLeadDays?: number;
  groceryShoppingDay?: number;
  // Shopping cadence; for 'biweekly', groceryAnchor (YYYY-MM-DD, a known
  // shopping day) fixes which alternating week is the shopping week.
  groceryFrequency?: 'weekly' | 'biweekly';
  groceryAnchor?: string | null;
  grocerySections?: string[];
  // Encrypted home-location blob (§9.1 P5).
  householdId?: string;
  keyVersion?: number;
  enc?: { alg: string; nonce: string; ct: string };
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
  businessName?: string;
  interests?: string[];
  notes?: string;
  deviceContactId?: string;
}

// Raw device contact sent to the AI classifier; results echo back the same key.
export interface ImportContact {
  key: string;
  name: string;
  phone?: string;
  email?: string;
  birthday?: string;
  company?: string;
}

export interface ClassifiedContact {
  key: string;
  type: 'family' | 'friend' | 'service';
  name: string;
  relationship?: string;
  businessName?: string;
  address?: string;
  phone?: string;
  email?: string;
  birthday?: string;
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
  // AI-assisted import: categorize + pre-fill (+ web-search enrich professionals).
  classify: (contacts: ImportContact[], enrich = true) =>
    api.post<{ results: ClassifiedContact[] }>('/people/classify', { contacts, enrich }),
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
  ownerId: string;
  isOwner?: boolean;
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
  keyRotationPending: boolean;
  envelopes: { keyVersion: number; wrappedHDK: string }[];
}
export interface HouseholdMemberKey {
  userId: string;
  identityPublicKey: string;
}

// A household-membership invitation (replaces the join code). Sent by a member;
// accepting opens a JoinRequest a member then approves on-device.
export interface HouseholdInvitation {
  _id: string;
  householdId: string;
  fromName?: string;
  fromEmail?: string;
  householdName: string;
  toEmail?: string;
  toPhone?: string;
  toUserId?: string;
  status: 'pending' | 'accepted' | 'declined';
  respondedAt?: string;
  createdAt: string;
}
export interface RotationPayload {
  keyVersion: number;
  envelopes: { userId: string; wrappedHDK: string }[];
}

export const householdApi = {
  get: () => api.get<Household>('/household'),
  rename: (name: string) => api.put<Household>('/household', { name }),
  // Invite by email or phone (replaces the join code). Phone invites resolve to
  // an account by the invitee's saved phone; the caller texts them separately.
  invite: (target: { email?: string; phone?: string }) =>
    api.post<{ invitation: HouseholdInvitation; userExists: boolean }>('/household/invitations', target),
  sentInvitations: () => api.get<HouseholdInvitation[]>('/household/invitations'),
  revokeInvitation: (id: string) => api.delete(`/household/invitations/${id}`),
  myInvitations: () => api.get<HouseholdInvitation[]>('/household/invitations/mine'),
  acceptInvitation: (id: string) =>
    api.post<{ status: string; requestId?: string; name?: string }>(`/household/invitations/${id}/accept`),
  declineInvitation: (id: string) =>
    api.post<{ invitation: HouseholdInvitation }>(`/household/invitations/${id}/decline`),
  myJoinRequest: () => api.get<JoinRequestMine>('/household/join-requests/mine'),
  cancelJoinRequest: () => api.delete('/household/join-requests/mine'),
  joinRequests: () => api.get<JoinRequestForApprover[]>('/household/join-requests'),
  approveJoin: (id: string, envelope: HDKEnvelopePayload) => api.post(`/household/join-requests/${id}/approve`, envelope),
  rejectJoin: (id: string) => api.post(`/household/join-requests/${id}/reject`),
  getKey: () => api.get<HouseholdKeyState>('/household/key'),
  mintKey: (envelope: HDKEnvelopePayload) => api.post('/household/key', envelope),
  leave: () => api.post('/household/leave'),
  // Phase 7 member removal + lazy HDK rotation (§5.2).
  memberKeys: () => api.get<HouseholdMemberKey[]>('/household/member-keys'),
  rotateKey: (payload: RotationPayload) => api.post<{ ok: boolean; keyVersion: number }>('/household/key/rotate', payload),
  removeMember: (userId: string) => api.post(`/household/members/${userId}/remove`),
  // §9 drop readiness gate + client-version report.
  readiness: () => api.get<E2eeReadiness>('/household/e2ee/readiness'),
  reportClientVersion: (version: string, platform: string) =>
    api.post('/household/e2ee/client-version', { version, platform }),
  // §9 straggler re-encrypt pass (owner device seals records lacking ciphertext).
  stragglers: () => api.get<E2eeStragglers>('/household/e2ee/stragglers'),
  seal: (payload: { collection: string; _id: string; enc: unknown; keyVersion?: number }) =>
    api.post('/household/e2ee/seal', payload),
};

export interface E2eeStragglerGroup {
  collection: string;
  fields: string[];
  records: Record<string, unknown>[];
}
export interface E2eeStragglers {
  total: number;
  collections: E2eeStragglerGroup[];
}

export interface E2eeReadinessMember {
  userId: string;
  email: string;
  enrolled: boolean;
  hasEnvelope: boolean;
  clientVersion: string | null;
  versionOk: boolean;
}
export interface E2eeReadiness {
  e2eeActive: boolean;
  ready: boolean;
  currentKeyVersion: number;
  minAppVersion: string | null;
  perMember: E2eeReadinessMember[];
  reasons: string[];
}

// ----- Places (Google Places proxy; powers address autocomplete) -------------

export interface PlacePrediction {
  place_id: string;
  description: string;
  main_text?: string;
  secondary_text?: string;
}

export const placesApi = {
  autocomplete: (query: string, type?: string, bias?: { lat?: number; lon?: number; country?: string }) =>
    api.get<{ predictions: PlacePrediction[] }>('/places/autocomplete', {
      params: { query, ...(type ? { type } : {}), ...(bias ?? {}) },
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
  attachments?: TripItemAttachment[];
  userId?: { firstName?: string };
}

// Booking confirmation file (PDF/image). Encrypted ones (private bookings on an
// E2EE household) are ciphertext on the server; wrappedFileKey + keyVersion let
// the device decrypt after download, and fileType is the plaintext mimetype.
export interface TripItemAttachment {
  _id: string;
  filename?: string;
  fileType?: string;
  fileSizeBytes?: number;
  householdId?: string;
  encrypted?: boolean;
  wrappedFileKey?: string;
  keyVersion?: number;
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
  // Outside-household addresses (email or phone) the owner shared this trip with
  // (owner-only in the response). A non-empty list, or any collaborator, means
  // the trip is shared.
  sharedWithOutside?: { email?: string; phone?: string }[];
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
  // Attachment upload is multipart — see lib/upload (field 'file'):
  //   POST /trips/:id/items/:itemId/attachments
  removeAttachment: (id: string, itemId: string, attId: string) =>
    api.delete(`/trips/${id}/items/${itemId}/attachments/${attId}`),
  // Sharing by outside email → invitation → collaborator (mirrors calendars).
  // Set the full list of outside emails. Decrypt-on-share (§9.3): on an E2EE
  // household the first outside email must include the client-decrypted trip +
  // items so the server can re-write them as plaintext for collaborators (who
  // hold no HDK).
  // Set the trip's outside-share list. Entries are addressed by email or phone.
  setShareRecipients: (id: string, recipients: { email?: string; phone?: string }[], decrypted?: { trip: unknown; items: unknown[] }) =>
    api.put<{ sharedWithOutside: { email?: string; phone?: string }[] }>(`/trips/${id}/share`, decrypted ? { recipients, decrypted } : { recipients }),
  unshare: (id: string) => api.delete(`/trips/${id}/share`),
  leaveShare: (id: string) => api.post(`/trips/${id}/leave-share`),
  removeCollaborator: (id: string, userId: string) => api.delete(`/trips/${id}/collaborators/${userId}`),
  // Trip-share invitations addressed to me (Invitations inbox).
  invitations: () => api.get<TripInvitation[]>('/trips/invitations'),
  acceptInvitation: (id: string) =>
    api.post<{ invitation: TripInvitation; tripId: string; name: string }>(`/trips/invitations/${id}/accept`),
  declineInvitation: (id: string) =>
    api.post<{ invitation: TripInvitation }>(`/trips/invitations/${id}/decline`),
};

// A per-trip sharing invitation addressed to me. Accepting makes me a
// collaborator with live access to the itinerary.
export interface TripInvitation {
  _id: string;
  fromName?: string;
  fromEmail?: string;
  tripId: string;
  tripName: string;
  destination?: string;
  status: 'pending' | 'accepted' | 'declined';
  respondedAt?: string;
  createdAt: string;
}

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
  recurrence?: {
    freq: string;
    interval?: number;
    until?: string;
    // Weekly: which weekdays (0=Sun..6=Sat).
    daysOfWeek?: number[];
    // Monthly "each": numbered dates of the month (1..31).
    daysOfMonth?: number[];
    // Yearly: which months (1..12).
    months?: number[];
    // Monthly "on the" / yearly "days of week": ordinal (1..5, -1=last,
    // -2=next to last) + day kind. For yearly it applies within each month.
    weekOfMonth?: number;
    weekdayKind?: 'sun' | 'mon' | 'tue' | 'wed' | 'thu' | 'fri' | 'sat' | 'day' | 'weekday' | 'weekend';
  };
  // Whether cross-household invitees may see who else is invited (default true).
  guestListVisible?: boolean;
  // Set when this event is a copy accepted from a cross-household invitation —
  // the form shows "Leave event" instead of Delete.
  invitationId?: string;
  // Response-only flag on GET /calendar/events/:id: this user has view-only
  // access to the event's calendar (housemate or outside collaborator) — the
  // form renders read-only.
  readOnly?: boolean;
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

export interface CalendarRaw {
  events: CalendarEvent[];
  tasks: Task[];
  chores: Chore[];
  people: Person[];
  recipeSchedules: Record<string, unknown>[];
  trips: Trip[];
  selfId: string;
  groceryShoppingDay: number;
}

export const calendarApi = {
  get: (params?: { from?: string; to?: string }) => api.get<CalendarData>('/calendar', { params }),
  getRaw: (params?: { from?: string; to?: string }) => api.get<CalendarRaw>('/calendar/raw', { params }),
  getEvent: (id: string) => api.get<CalendarEvent>(`/calendar/events/${id}`),
  createEvent: (data: Record<string, unknown>) => api.post<CalendarEvent>('/calendar/events', data),
  updateEvent: (id: string, data: Record<string, unknown>) => api.put<CalendarEvent>(`/calendar/events/${id}`, data),
  deleteEvent: (id: string) => api.delete(`/calendar/events/${id}`),
};

// ----- Custom calendars (Calendars → Add Calendar) ----------------------------

// Per-person permission on a shared calendar.
export type CalendarAccess = 'view' | 'full';

// Server record for a user-created calendar. `key` is the client-minted
// `custom-<slug>` id that events reference via calendarType; `mine` = created
// by the requester (creator-only edit/delete); `access` = the requester's
// effective event permission on it.
export interface CustomCalendarRecord {
  _id: string;
  userId: string;
  key: string;
  name: string;
  color: string;
  alertsEnabled: boolean;
  sharedWithHousehold: boolean;
  householdAccess: CalendarAccess;
  sharedWith: { userId: string; access: CalendarAccess }[];
  sharedWithOutside: { email?: string; phone?: string; access: CalendarAccess }[];
  // ICS subscription source. Present => read-only subscribed calendar whose
  // events each device fetches/expands itself (lib/calendarFeeds).
  feedUrl?: string;
  // Present => read-only holiday calendar whose events each device computes
  // itself from this country config (lib/holidays via calendarPrefs).
  holiday?: { country: string; selectedRegions?: string[]; disabledIds?: string[] };
  mine: boolean;
  access: CalendarAccess;
}

export type CustomCalendarPayload = Omit<CustomCalendarRecord, '_id' | 'userId' | 'mine' | 'access'>;

// An outside-household calendar-sharing invitation addressed to me. Accepting
// grants live access to the calendar and its events at `access` level.
export interface CalendarInvitation {
  _id: string;
  fromName?: string;
  fromEmail?: string;
  calendarKey: string;
  calendarName: string;
  color?: string;
  access: CalendarAccess;
  status: 'pending' | 'accepted' | 'declined';
  respondedAt?: string;
  createdAt: string;
}

export const customCalendarsApi = {
  list: () => api.get<CustomCalendarRecord[]>('/calendars'),
  create: (data: CustomCalendarPayload) => api.post<CustomCalendarRecord>('/calendars', data),
  update: (key: string, data: Partial<Omit<CustomCalendarPayload, 'key'>>) =>
    api.put<CustomCalendarRecord>(`/calendars/${key}`, data),
  remove: (key: string) => api.delete(`/calendars/${key}`),
  invitations: () => api.get<CalendarInvitation[]>('/calendars/invitations'),
  acceptInvitation: (id: string) =>
    api.post<{ invitation: CalendarInvitation; calendar: CustomCalendarRecord }>(`/calendars/invitations/${id}/accept`),
  declineInvitation: (id: string) =>
    api.post<{ invitation: CalendarInvitation }>(`/calendars/invitations/${id}/decline`),
};

// ----- Event invitations (cross-household sharing by email) -------------------

// Plaintext snapshot of the event carried by an invitation (the client decrypts
// the source event and sends this alongside the eventId).
export interface InvitationEventSnapshot {
  title: string;
  description?: string;
  location?: string;
  url?: string;
  phone?: string;
  startDate: string;
  endDate?: string;
  allDay?: boolean;
  calendarType?: string;
}

export interface EventInvitation {
  _id: string;
  fromUserId: string;
  fromName?: string;
  fromEmail?: string;
  // Exactly one of toEmail/toPhone is set (SMS invites are phone-addressed).
  toEmail?: string;
  toPhone?: string;
  toUserId?: string;
  // Capability secret for the public .ics link carried by an SMS invite.
  shareToken?: string;
  eventId?: string;
  event: InvitationEventSnapshot;
  // 'left' = accepted then later left the event (copy deleted).
  status: 'pending' | 'accepted' | 'declined' | 'left';
  respondedAt?: string;
  // The recipient's copy created on accept.
  acceptedEventId?: string;
  createdAt: string;
}

export const invitationsApi = {
  // Invitations addressed to me (New = pending, Replied = accepted/declined/left).
  list: () => api.get<EventInvitation[]>('/invitations'),
  // The organizer's invitee list for one of their events.
  sentForEvent: (eventId: string) =>
    api.get<EventInvitation[]>('/invitations/sent', { params: { eventId } }),
  // Address with either email or phone. Phone invites are recorded here but
  // texted from the sender's own device (see EventInviteesScreen).
  send: (data: { eventId: string; email?: string; phone?: string; event: InvitationEventSnapshot }) =>
    api.post<{ invitation: EventInvitation; userExists: boolean }>('/invitations', data),
  accept: (id: string) =>
    api.post<{ invitation: EventInvitation; event: CalendarEvent }>(`/invitations/${id}/accept`),
  decline: (id: string) => api.post<{ invitation: EventInvitation }>(`/invitations/${id}/decline`),
  // Recipient: leave an accepted event (deletes their copy).
  leave: (id: string) => api.post<{ invitation: EventInvitation }>(`/invitations/${id}/leave`),
  // Organizer: uninvite (deletes the invitation and, if accepted, the copy).
  revoke: (id: string) => api.delete(`/invitations/${id}`),
  // Recipient: who else is invited, if the event's guestListVisible flag allows.
  guests: (id: string) => api.get<InvitationGuestList>(`/invitations/${id}/guests`),
};

// GET /invitations/:id/guests — visible:false means the organizer keeps the
// guest list private (or the source event is gone); guests is then empty.
export interface InvitationGuestList {
  visible: boolean;
  organizer?: { name?: string; email?: string };
  guests: { _id: string; toEmail?: string; toPhone?: string; status: EventInvitation['status'] }[];
}

export interface BillingSubscription {
  autoRenew: boolean | null;   // null = unknown (predates lifecycle tracking)
  expiresAt: string | null;    // renewal date, or access-until date when cancelled
  billingIssue: boolean;       // payment failed; store grace period running
  productId: string | null;    // store product id, for matching a package's price
  managedBy: { userId: string; name: string } | null; // who bought it
}

export interface BillingStatus {
  plan: string;
  planLabel: string;
  // Weekly TOKEN budget — the enforced metric shown as a % gauge in the Plan view.
  tokensUsed: number;
  weeklyTokenLimit: number | null; // null = unlimited
  tokenPct: number;                // 0–100 (0 when unlimited)
  // Per-action counts (analytics / detail; no longer the enforced cap).
  usage: Record<string, number>;
  // 'user' = free tier (each member has their own allowance); 'household' = paid
  // tiers (shared family pool). Determines whether usage is personal or shared.
  usageScope?: 'user' | 'household';
  quotas: Record<string, number | null>;
  resetsAt?: string; // ISO instant of the next weekly usage reset (Wed 5PM ET)
  hasHousehold: boolean;
  catalog: { key: string; label: string; price: number; weeklyTokenLimit?: number | null }[];
  // Subscription lifecycle (paid plans only).
  subscription?: BillingSubscription;
  // Per-member share of the pooled weekly tokens (household-scoped plans only).
  // Relative shares — member counters aren't baselined at a mid-week upgrade.
  members?: { userId: string; name: string; tokens: number }[];
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
  forecast: { date: string; weatherCode: number; tempMax: number; tempMin: number; precipProbability: number; precipSum: number; goodWeather?: boolean; sunrise?: string; sunset?: string; hours?: WeatherHour[] }[];
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

// ----- Storage mode / cloud-purge lifecycle (server: routes/storage.js) ------

export type StorageMode = 'cloud' | 'local';
export type CloudDeletionState = 'none' | 'scheduled' | 'purged';

export interface StorageState {
  storageMode: StorageMode;
  cloudDeletionState: CloudDeletionState;
  cloudDeletionScheduledAt: string | null;
  localReplicaVerifiedAt: string | null;
  canGoLocal: boolean;
  memberCount: number;
}

// The download-first manifest the client proves before the server will schedule
// a purge (§6.2). Shape mirrors services/cloudDeletion.js buildManifest.
export interface ReplicaManifest {
  total: number;
  counts: Record<string, number>;
  hash: string;
}

export const storageApi = {
  getMode: () => api.get<StorageState>('/storage'),
  switchToLocal: (manifest: ReplicaManifest) =>
    api.post<StorageState>('/storage/switch-to-local', { manifest }),
  switchToCloud: () => api.post<StorageState>('/storage/switch-to-cloud'),
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
