<template>
  <v-container class="py-6" max-width="900">
    <div class="d-flex align-center mb-4">
      <BackButton />
      <h1 class="text-h4 font-weight-bold ml-2">{{ item?.name }}</h1>
      <v-btn
        icon="mdi-pencil"
        variant="text"
        color="white"
        size="small"
        class="ml-1"
        title="Edit item"
        :to="`/items/${$route.params.id}/edit`"
      />
      <v-spacer />
      <v-btn
        icon="mdi-delete-outline"
        variant="text"
        color="error"
        size="small"
        title="Delete item"
        @click="deleteDialog = true"
      />
    </div>

    <!-- Delete confirmation -->
    <v-dialog v-model="deleteDialog" max-width="420">
      <v-card rounded="lg">
        <v-card-title>Delete item?</v-card-title>
        <v-card-text class="text-body-2">
          This will permanently delete <strong>{{ item?.name }}</strong> along with its manuals.
          Maintenance tasks linked to this item are not removed. This can't be undone.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn :disabled="deleting" @click="deleteDialog = false">Cancel</v-btn>
          <v-btn color="error" variant="flat" :loading="deleting" @click="deleteItem">Delete</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-row v-if="item">
      <!-- ── Odometer card (vehicles only) ── -->
      <v-col v-if="isVehicle" cols="12">
        <v-card rounded="lg" elevation="1" class="mb-4">
          <v-card-title class="d-flex align-center" style="cursor: pointer;" @click="odometerOpen = !odometerOpen">
            <v-icon class="mr-2" color="primary">mdi-gauge</v-icon>
            Odometer
            <span v-if="odomCurrentKm != null" class="text-body-1 font-weight-medium ml-3">{{ odomCurrentKm.toLocaleString() }} km</span>
            <v-spacer />
            <div v-if="odomKmPerDay" class="text-caption text-medium-emphasis mr-3">
              avg {{ odomKmPerDay.toLocaleString() }} km/day
            </div>
            <v-btn variant="tonal" size="small" color="#1976D2" @click.stop="openOdomUpdate">
              Update
            </v-btn>
          </v-card-title>
          <v-expand-transition>
            <div v-show="odometerOpen">
              <v-divider />

              <v-card-text v-if="odomCurrentKm == null" class="pb-2">
                <div class="text-body-2 text-medium-emphasis">
                  No readings logged yet — log your current odometer to enable mileage tracking.
                </div>
              </v-card-text>

              <!-- Reading history -->
              <template v-if="odomLogs.length">
                <v-divider />
                <v-list density="compact" lines="one">
                  <v-list-item v-for="log in odomLogs.slice(0, 5)" :key="log._id">
                    <template #title>
                      <span class="text-body-2">{{ Number(log.reading).toLocaleString() }} km</span>
                      <span v-if="log.notes" class="text-caption text-medium-emphasis ml-2">— {{ log.notes }}</span>
                    </template>
                    <template #subtitle>
                      <span class="text-caption">{{ formatDate(log.recordedAt) }}</span>
                    </template>
                    <template #append>
                      <v-btn icon="mdi-delete" size="x-small" variant="text" color="error" @click="deleteOdomLog(log._id)" />
                    </template>
                  </v-list-item>
                </v-list>
              </template>

              <!-- Inline log reading form -->
              <v-expand-transition>
                <div v-if="odomLogOpen">
                  <v-divider />
                  <v-card-text class="pt-3 pb-2">
                    <v-text-field
                      v-model="odomReading"
                      label="Current reading (km)"
                      type="number"
                      variant="outlined"
                      density="compact"
                      :hint="odomCurrentKm ? `Last reading: ${odomCurrentKm.toLocaleString()} km` : ''"
                      persistent-hint
                      class="mb-3"
                    />
                    <v-text-field v-model="odomNotes" label="Notes (optional)" variant="outlined" density="compact" placeholder="e.g. after road trip" />
                  </v-card-text>
                  <v-card-actions class="pt-0">
                    <v-spacer />
                    <v-btn @click="odomLogOpen = false; odomReading = ''; odomNotes = ''">Cancel</v-btn>
                    <v-btn color="#1976D2" :loading="odomLogging" :disabled="!odomReading" @click="logOdometer">Save</v-btn>
                  </v-card-actions>
                </div>
              </v-expand-transition>
            </div>
          </v-expand-transition>
        </v-card>
      </v-col>

      <v-col cols="12">
        <!-- ── Manuals card ── -->
        <v-card rounded="lg" elevation="1" class="mb-4">
          <v-card-title class="d-flex align-center">
            Manuals
            <v-spacer />
            <v-btn variant="text" size="small" prepend-icon="mdi-robot-search" :loading="lookupState === 'searching'" @click="runLookup">Find</v-btn>
            <v-btn variant="text" size="small" prepend-icon="mdi-upload" @click="manualPanel = manualPanel === 'upload' ? null : 'upload'">Upload</v-btn>
            <v-btn variant="text" size="small" prepend-icon="mdi-link" @click="manualPanel = manualPanel === 'url' ? null : 'url'">From URL</v-btn>
          </v-card-title>
          <v-divider />

          <!-- Inline alert for manual operations -->
          <v-alert v-if="pageAlert.msg" :type="pageAlert.error ? 'error' : 'success'" variant="tonal" density="compact" class="ma-3" closable @click:close="pageAlert.msg = ''">
            {{ pageAlert.msg }}
          </v-alert>

          <!-- Saved manuals -->
          <v-list v-if="item.manuals?.length">
            <v-list-item
              v-for="m in item.manuals"
              :key="m._id"
              :title="m.title"
              :subtitle="`${(m.fileSizeBytes / 1024 / 1024).toFixed(1)} MB · ${m.source}`"
            >
              <template #append>
                <v-icon v-if="m.encrypted" icon="mdi-lock" size="x-small" color="success" class="mr-1" title="End-to-end encrypted" />
                <v-btn icon="mdi-eye" variant="text" size="small" :loading="openingManual === m._id" @click="openManual(m)" />
                <v-btn
                  icon="mdi-list-box-outline"
                  variant="text"
                  size="small"
                  color="primary"
                  :loading="extractingManual === m._id"
                  title="Extract maintenance tasks from this manual"
                  @click="extractTasks(m)"
                />
                <v-btn icon="mdi-download" variant="text" size="small" :loading="openingManual === m._id" @click="openManual(m)" />
                <v-btn icon="mdi-delete" variant="text" size="small" color="error" @click="deleteManual(m._id)" />
              </template>
            </v-list-item>
          </v-list>
          <!-- ── Auto-lookup section ── -->
          <template v-if="lookupState !== 'idle' || !item.manuals?.length">
            <v-divider />

            <!-- Searching state -->
            <v-list-item v-if="lookupState === 'searching'">
              <template #prepend>
                <v-progress-circular indeterminate size="20" color="primary" class="mr-3" />
              </template>
              <v-list-item-title class="text-body-2">Searching for the manual…</v-list-item-title>
              <v-list-item-subtitle>{{ lookupQuery }}</v-list-item-subtitle>
            </v-list-item>

            <!-- Error state -->
            <v-alert v-else-if="lookupState === 'error'" type="warning" variant="tonal" class="ma-3" density="compact">
              {{ lookupError }} —
              <a href="#" class="text-warning" @click.prevent="runLookup">Try again</a>
            </v-alert>

            <!-- No results -->
            <v-list-item v-else-if="lookupState === 'done' && !candidates.length">
              <v-list-item-title class="text-body-2 text-medium-emphasis">
                No manuals found automatically.
                <a href="#" class="text-primary" @click.prevent="manualPanel = 'upload'">Upload one manually</a>
                or
                <a href="#" class="text-primary" @click.prevent="manualPanel = 'url'">add from URL</a>.
              </v-list-item-title>
            </v-list-item>

            <!-- Candidates list -->
            <template v-else-if="lookupState === 'done' && candidates.length">
              <!-- Fallback: no API key configured, show search links -->
              <v-alert v-if="isFallback" type="info" variant="tonal" class="ma-3" density="compact" icon="mdi-information-outline">
                <div class="text-body-2 font-weight-medium">Automatic lookup requires a Brave Search API key</div>
                <div class="text-caption mt-1">
                  Add <code>BRAVE_SEARCH_KEY</code> to <code>server/.env</code> to enable automatic PDF search.
                  Optionally add <code>ANTHROPIC_API_KEY</code> to have Claude rank the best result.
                  For now, use one of the links below to find the manual, then paste the PDF URL using "From URL".
                </div>
              </v-alert>
              <div v-else class="px-4 pt-3 pb-1 d-flex align-center ga-1">
                <v-icon size="16" color="primary">mdi-robot</v-icon>
                <span class="text-caption text-medium-emphasis">
                  Claude found {{ candidates.length }} option{{ candidates.length !== 1 ? 's' : '' }} for <strong>{{ lookupQuery }}</strong> — pick one to save:
                </span>
              </div>
              <v-list lines="two" density="compact">
                <v-list-item
                  v-for="(c, i) in candidates"
                  :key="i"
                  class="candidate-item"
                >
                  <template #prepend>
                    <v-avatar
                      size="32"
                      :color="c.recommended ? 'amber-lighten-4' : isFallback ? 'deep-orange-lighten-4' : 'blue-grey-lighten-4'"
                      class="mr-2"
                    >
                      <v-icon size="16" :color="c.recommended ? 'amber-darken-2' : isFallback ? 'deep-orange' : 'blue-grey'">
                        {{ c.recommended ? 'mdi-star' : isFallback ? 'mdi-open-in-new' : (c.url.endsWith('.pdf') ? 'mdi-file-pdf-box' : 'mdi-web') }}
                      </v-icon>
                    </v-avatar>
                  </template>
                  <template #title>
                    <div class="d-flex align-center ga-2">
                      <span class="text-body-2">{{ c.title || c.domain }}</span>
                      <v-chip v-if="c.recommended" color="amber-darken-2" size="x-small" label prepend-icon="mdi-star">
                        Best Match
                      </v-chip>
                    </div>
                  </template>
                  <template #subtitle>
                    <span class="text-caption">{{ c.domain }}</span><br>
                    <span class="text-caption text-medium-emphasis">{{ (c.snippet || '').slice(0, 100) }}</span>
                  </template>
                  <template #append>
                    <div class="d-flex flex-column ga-1 align-end">
                      <v-btn
                        v-if="!isFallback"
                        size="x-small"
                        color="#1976D2"
                        variant="tonal"
                        :loading="savingCandidate === i"
                        :disabled="savingCandidate !== null && savingCandidate !== i"
                        @click="saveCandidate(c, i)"
                      >
                        Save
                      </v-btn>
                      <v-btn
                        v-if="!isFallback"
                        size="x-small"
                        variant="text"
                        color="secondary"
                        prepend-icon="mdi-eye"
                        @click="viewCandidate(c)"
                      >
                        View
                      </v-btn>
                      <a v-if="isFallback" :href="c.url" target="_blank" class="text-caption text-primary" style="text-decoration:none;">
                        Open
                      </a>
                    </div>
                  </template>
                </v-list-item>
              </v-list>
            </template>

            <!-- Idle — trigger button if not started yet -->
            <v-list-item v-else-if="lookupState === 'idle'">
              <v-list-item-title class="text-body-2 text-medium-emphasis">
                No manuals yet.
                <a href="#" class="text-primary" @click.prevent="runLookup">Search automatically</a>
              </v-list-item-title>
            </v-list-item>
          </template>

          <!-- Inline upload form -->
          <v-expand-transition>
            <div v-if="manualPanel === 'upload'">
              <v-divider />
              <v-card-text>
                <v-text-field v-model="uploadTitle" label="Title (optional)" variant="outlined" density="compact" class="mb-3" />
                <v-file-input v-model="uploadFile" label="PDF or image file" variant="outlined" density="compact" accept=".pdf,image/*" prepend-icon="mdi-paperclip" />
                <v-alert v-if="uploadError" type="error" variant="tonal" class="mt-2" density="compact">{{ uploadError }}</v-alert>
              </v-card-text>
              <v-card-actions>
                <v-spacer />
                <v-btn @click="manualPanel = null; uploadError = ''">Cancel</v-btn>
                <v-btn color="#1976D2" :loading="uploading" @click="doUpload">Upload</v-btn>
              </v-card-actions>
            </div>
          </v-expand-transition>

          <!-- Inline URL form -->
          <v-expand-transition>
            <div v-if="manualPanel === 'url'">
              <v-divider />
              <v-card-text>
                <v-text-field v-model="urlTitle" label="Title (optional)" variant="outlined" density="compact" class="mb-3" />
                <v-text-field v-model="manualUrl" label="PDF URL" variant="outlined" density="compact" placeholder="https://…" />
                <v-alert v-if="urlError" type="error" variant="tonal" class="mt-2" density="compact">{{ urlError }}</v-alert>
              </v-card-text>
              <v-card-actions>
                <v-spacer />
                <v-btn @click="manualPanel = null; urlError = ''">Cancel</v-btn>
                <v-btn color="#1976D2" :loading="fetchingUrl" @click="doFetchUrl">Fetch & Save</v-btn>
              </v-card-actions>
            </div>
          </v-expand-transition>

          <!-- Inline extracted tasks review -->
          <v-expand-transition>
            <div v-if="extractOpen">
              <v-divider />
              <div class="d-flex align-center pa-4">
                <v-icon color="primary" class="mr-2">mdi-clipboard-list-outline</v-icon>
                <div>
                  <div class="text-subtitle-2">Maintenance Tasks from Manual</div>
                  <div class="text-caption text-medium-emphasis">Found {{ extractedTasks.length }} tasks in <em>{{ extractManualTitle }}</em>. Deselect any you don't want.</div>
                </div>
                <v-spacer />
                <v-btn icon="mdi-close" variant="text" size="small" @click="extractOpen = false" />
              </div>
              <v-divider />
              <v-list v-if="extractedTasks.length" lines="two" density="compact" style="max-height:400px;overflow-y:auto">
                <v-list-item
                  v-for="(task, i) in extractedTasks"
                  :key="i"
                  class="px-4"
                >
                  <template #prepend>
                    <v-checkbox-btn
                      :model-value="selectedTasks.includes(i)"
                      color="primary"
                      @update:model-value="v => v ? selectedTasks.push(i) : selectedTasks.splice(selectedTasks.indexOf(i), 1)"
                    />
                  </template>
                  <template #title>
                    <span class="text-body-2 font-weight-medium">{{ task.title }}</span>
                  </template>
                  <template #subtitle>
                    <span class="text-caption">{{ task.description }}</span>
                    <div class="d-flex ga-2 mt-1 flex-wrap">
                      <v-chip size="x-small" :color="task.priority === 'high' ? 'error' : task.priority === 'medium' ? 'warning' : 'default'" label>{{ task.priority }}</v-chip>
                      <v-chip size="x-small" color="blue-grey" variant="tonal" label prepend-icon="mdi-clock-outline">{{ recurrenceLabel(task.recurrence) }}</v-chip>
                    </div>
                  </template>
                </v-list-item>
              </v-list>
              <v-alert v-else type="info" variant="tonal" class="ma-3" density="compact">
                No maintenance schedule found in this manual.
              </v-alert>
              <v-divider />
              <v-card-actions>
                <v-btn variant="text" @click="extractOpen = false">Cancel</v-btn>
                <v-spacer />
                <span class="text-caption text-medium-emphasis mr-3">{{ selectedTasks.length }} of {{ extractedTasks.length }} selected</span>
                <v-btn color="#1976D2" variant="flat" :disabled="!selectedTasks.length" :loading="creatingTasks" @click="confirmCreateTasks">
                  Create Tasks
                </v-btn>
              </v-card-actions>
            </div>
          </v-expand-transition>
        </v-card>

        <!-- Related tasks card -->
        <v-card rounded="lg" elevation="1">
          <v-card-title class="d-flex align-center">
            Maintenance Tasks
            <v-spacer />
            <v-btn icon="mdi-plus" variant="tonal" color="#1976D2" size="small" title="Add task" :to="`/tasks/new?item=${item._id}`" />
          </v-card-title>
          <v-divider />
          <template v-if="groupedTasks.length">
            <div v-for="group in groupedTasks" :key="group.id">
              <div class="d-flex align-center px-4 pt-3 pb-1">
                <span class="text-caption text-medium-emphasis font-weight-medium text-uppercase tracking-wide">
                  {{ group.label }}
                </span>
              </div>
              <v-list density="compact" class="pt-0">
                <v-list-item
                  v-for="task in group.tasks"
                  :key="task._id"
                  :title="task.title"
                  :to="`/tasks/${task._id}`"
                >
                  <template #append>
                    <v-chip color="blue-grey" variant="tonal" size="x-small" label>{{ recurrenceLabel(task.recurrence) }}</v-chip>
                  </template>
                </v-list-item>
              </v-list>
              <v-divider />
            </div>
          </template>
          <v-list-item v-else>
            <v-list-item-title class="text-medium-emphasis text-body-2">No tasks linked</v-list-item-title>
          </v-list-item>
        </v-card>
      </v-col>
    </v-row>

  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { format } from 'date-fns';
import { itemsApi, manualsApi, tasksApi, odometerApi } from '../services/api';
import { encryptAttachment, decryptAttachment, newObjectId, isUnlocked } from '../services/e2ee';

const route = useRoute();
const router = useRouter();
const item = ref(null);
const relatedTasks = ref([]);

const deleteDialog = ref(false);
const deleting = ref(false);

async function deleteItem() {
  deleting.value = true;
  try {
    await itemsApi.delete(route.params.id);
    router.push('/maintenance');
  } catch (e) {
    pageAlert.value = { msg: e.response?.data?.error || 'Failed to delete item', error: true };
    deleteDialog.value = false;
  } finally {
    deleting.value = false;
  }
}

const odometerOpen = ref(false);

const isVehicle = computed(() => item.value?.type === 'vehicle');

function openOdomUpdate() {
  odometerOpen.value = true;
  odomLogOpen.value = true;
}

// ── Odometer ──────────────────────────────────────────────────────────────────
const odomLogs = ref([]);
const odomCurrentKm = ref(null);
const odomKmPerDay = ref(null);
const odomMileageTasks = ref([]);
const odomLogOpen = ref(false);
const odomReading = ref('');
const odomNotes = ref('');
const odomLogging = ref(false);

async function loadOdometer() {
  if (!isVehicle.value) return;
  try {
    const { data } = await odometerApi.get(route.params.id);
    odomLogs.value = data.logs || [];
    odomCurrentKm.value = data.currentKm;
    odomKmPerDay.value = data.kmPerDay;
    odomMileageTasks.value = data.mileageTasks || [];
  } catch {}
}

async function logOdometer() {
  if (!odomReading.value) return;
  odomLogging.value = true;
  try {
    await odometerApi.log(route.params.id, { reading: Number(odomReading.value), notes: odomNotes.value });
    odomLogOpen.value = false;
    odomReading.value = '';
    odomNotes.value = '';
    await Promise.all([loadOdometer(), loadItem()]);
  } catch (e) {
    pageAlert.value = { msg: e.response?.data?.error || 'Failed to log reading', error: true };
  } finally {
    odomLogging.value = false;
  }
}

async function deleteOdomLog(logId) {
  await odometerApi.delete(route.params.id, logId);
  await loadOdometer();
}

// ── Task grouping (by subcategory) ──────────────────────────────────────────────
const groupedTasks = computed(() => {
  const map = new Map();
  for (const task of relatedTasks.value) {
    const subId = String(task.subcategoryId?._id || 'none');
    const label = task.subcategoryId?.name || 'General';
    if (!map.has(subId)) map.set(subId, { id: subId, label, tasks: [] });
    map.get(subId).tasks.push(task);
  }
  return [...map.values()].sort((a, b) => {
    if (a.label === 'General') return 1;
    if (b.label === 'General') return -1;
    return a.label.localeCompare(b.label);
  });
});

// ── Manual lookup state ──────────────────────────────────────────────────────
const lookupState = ref('idle'); // idle | searching | done | error
const lookupQuery = ref('');
const lookupError = ref('');
const candidates = ref([]);
const isFallback = ref(false);
const savingCandidate = ref(null);

// ── Upload / URL inline panels ────────────────────────────────────────────────
const manualPanel = ref(null); // null | 'upload' | 'url'
const uploadTitle = ref('');
const uploadFile = ref(null);
const uploading = ref(false);
const uploadError = ref('');

const urlTitle = ref('');
const manualUrl = ref('');
const fetchingUrl = ref(false);
const urlError = ref('');

const pageAlert = ref({ msg: '', error: false });

// ── Task extraction ───────────────────────────────────────────────────────────
const extractingManual = ref(null);   // manual _id currently being parsed
const openingManual = ref(null);       // manual _id currently being opened (decrypt)
const extractOpen = ref(false);
const extractedTasks = ref([]);
const extractManualId = ref(null);
const extractManualTitle = ref('');
const selectedTasks = ref([]);
const creatingTasks = ref(false);

async function extractTasks(manual) {
  extractingManual.value = manual._id;
  try {
    // Ephemeral-consent (§9.1 P4b): an encrypted manual is decrypted here and its
    // bytes posted per-request so the server can parse it without ever storing
    // plaintext. Plaintext manuals extract server-side as before.
    let file = null;
    if (manual.encrypted) {
      if (!isUnlocked()) {
        pageAlert.value = { msg: 'Unlock your account to extract tasks from this encrypted manual.', error: true };
        return;
      }
      const { data: cipher } = await manualsApi.downloadBytes(manual._id);
      const fileText = new TextDecoder().decode(new Uint8Array(cipher));
      const bytes = await decryptAttachment('Manual', manual._id, manual.keyVersion, manual.wrappedFileKey, fileText);
      if (!bytes) { pageAlert.value = { msg: 'Could not decrypt this manual.', error: true }; return; }
      file = new File([bytes], `${manual.title || 'manual'}.pdf`, { type: 'application/pdf' });
    }
    const { data } = await manualsApi.extractTasks(manual._id, file);
    extractedTasks.value = data.tasks || [];
    extractManualId.value = manual._id;
    extractManualTitle.value = data.manualTitle || manual.title;
    selectedTasks.value = extractedTasks.value.map((_, i) => i); // all selected by default
    extractOpen.value = true;
  } catch (e) {
    pageAlert.value = { msg: e.response?.data?.error || 'Could not extract tasks from this manual', error: true };
  } finally {
    extractingManual.value = null;
  }
}

async function confirmCreateTasks() {
  creatingTasks.value = true;
  try {
    const tasks = selectedTasks.value.map(i => extractedTasks.value[i]);
    await manualsApi.createTasks(extractManualId.value, {
      tasks,
      itemId: item.value?._id,
      categoryId: item.value?.categoryId?._id,
      currentKm: odomCurrentKm.value ?? undefined,
    });
    pageAlert.value = { msg: `${tasks.length} maintenance task${tasks.length !== 1 ? 's' : ''} created!`, error: false };
    extractOpen.value = false;
    await loadTasks();
  } catch (e) {
    pageAlert.value = { msg: e.response?.data?.error || 'Failed to create tasks', error: true };
  } finally {
    creatingTasks.value = false;
  }
}

const _WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const _MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function _ordinal(n) { const s=['th','st','nd','rd'],v=n%100; return n+(s[(v-20)%10]||s[v]||s[0]); }

function recurrenceLabel(r) {
  if (!r?.type) return 'No schedule';
  if (r.type === 'one-time') return 'One-time';
  if (r.type === 'calendar') {
    const months = (r.months || []).map(m => _MONTH_NAMES[m-1]).join(', ');
    const day = r.dayOfMonth ? ` on the ${_ordinal(r.dayOfMonth)}` : '';
    return months ? `Every year in ${months}${day}` : 'Calendar';
  }
  if (r.type === 'interval') {
    const n = r.intervalValue;
    const unit = n === 1 ? r.intervalUnit?.replace(/s$/, '') : r.intervalUnit;
    let label = `Every ${n} ${unit}`;
    if (r.intervalUnit === 'weeks' && r.dayOfWeek != null) label += ` on ${_WEEKDAY_NAMES[r.dayOfWeek]}`;
    if (r.intervalUnit === 'months') {
      if (r.weekOfMonth != null && r.dayOfWeek != null) {
        const pos = r.weekOfMonth === -1 ? 'last' : ['','first','second','third','fourth'][r.weekOfMonth];
        label += ` on the ${pos} ${_WEEKDAY_NAMES[r.dayOfWeek]}`;
      } else if (r.dayOfMonth) {
        label += ` on the ${_ordinal(r.dayOfMonth)}`;
      }
    }
    if (r.intervalUnit === 'years') {
      const m = r.months?.[0]; const d = r.dayOfMonth;
      if (m && d) label += ` on ${_MONTH_NAMES[m-1]} ${_ordinal(d)}`;
      else if (m) label += ` in ${_MONTH_NAMES[m-1]}`;
      else if (d) label += ` on the ${_ordinal(d)}`;
    }
    return label;
  }
  return r.type;
}

function viewManual(src) {
  window.open(src, '_blank', 'noopener');
}

// Open a manual for viewing/download. Encrypted manuals are fetched as
// ciphertext, decrypted in the browser, and opened via a blob URL; plaintext
// ones open the server URL directly.
async function openManual(m) {
  if (!m.encrypted) { viewManual(manualsApi.download(m._id)); return; }
  openingManual.value = m._id;
  try {
    const { data } = await manualsApi.downloadBytes(m._id);
    const fileText = new TextDecoder().decode(new Uint8Array(data));
    const bytes = await decryptAttachment('Manual', m._id, m.keyVersion, m.wrappedFileKey, fileText);
    if (!bytes) { pageAlert.value = { msg: 'Unlock your account to view this encrypted manual.', error: true }; return; }
    const url = URL.createObjectURL(new Blob([bytes], { type: m.fileType || 'application/pdf' }));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (e) {
    pageAlert.value = { msg: e.response?.data?.error || 'Could not open this manual.', error: true };
  } finally {
    openingManual.value = null;
  }
}

function viewCandidate(c) {
  window.open(c.url, '_blank', 'noopener');
}

function formatDate(d) { return d ? format(new Date(d), 'MMM d, yyyy') : '—'; }

async function loadItem() {
  const { data } = await itemsApi.get(route.params.id);
  item.value = data;
}

async function loadTasks() {
  const { data } = await tasksApi.list({ item: route.params.id });
  relatedTasks.value = data;
}

async function runLookup() {
  lookupState.value = 'searching';
  lookupError.value = '';
  candidates.value = [];
  try {
    const { data } = await manualsApi.autoLookup(route.params.id);
    candidates.value = data.candidates || [];
    lookupQuery.value = data.query || '';
    isFallback.value = data.isFallback || false;
    lookupState.value = 'done';
  } catch (e) {
    lookupError.value = e.response?.data?.error || 'Search failed';
    lookupState.value = 'error';
  }
}

async function saveCandidate(candidate, index) {
  savingCandidate.value = index;
  try {
    await manualsApi.fromUrl(route.params.id, {
      url: candidate.url,
      title: candidate.title || `${item.value?.name} Manual`,
    });
    candidates.value = [];
    isFallback.value = false;
    lookupState.value = 'idle';
    await loadItem();
  } catch (e) {
    pageAlert.value = { msg: e.response?.data?.error || 'Could not fetch that URL — try another or upload manually.', error: true };
  } finally {
    savingCandidate.value = null;
  }
}

async function doUpload() {
  if (!uploadFile.value) return;
  uploading.value = true;
  uploadError.value = '';
  try {
    const file = uploadFile.value[0] || uploadFile.value;
    const fd = new FormData();
    // E2EE (Phase 4c): encrypt the file client-side when the session is unlocked;
    // upload the ciphertext + wrapped key with a client-minted _id (AAD binding).
    let sealed = null;
    if (isUnlocked()) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const _id = newObjectId();
      sealed = await encryptAttachment('Manual', _id, bytes);
      if (sealed) {
        fd.append('file', new Blob([sealed.fileText], { type: 'application/octet-stream' }), `${file.name}.enc`);
        fd.append('_id', _id);
        fd.append('encrypted', 'true');
        fd.append('wrappedFileKey', sealed.wrappedKey);
        fd.append('keyVersion', String(sealed.keyVersion));
        fd.append('fileType', file.type || 'application/pdf');
      }
    }
    if (!sealed) fd.append('file', file);
    if (uploadTitle.value) fd.append('title', uploadTitle.value);
    await manualsApi.upload(route.params.id, fd);
    manualPanel.value = null;
    uploadTitle.value = '';
    uploadFile.value = null;
    candidates.value = [];
    await loadItem();
  } catch (e) {
    uploadError.value = e.response?.data?.error || 'Upload failed';
  } finally {
    uploading.value = false;
  }
}

async function doFetchUrl() {
  if (!manualUrl.value) return;
  fetchingUrl.value = true;
  urlError.value = '';
  try {
    await manualsApi.fromUrl(route.params.id, { url: manualUrl.value, title: urlTitle.value });
    manualPanel.value = null;
    manualUrl.value = '';
    urlTitle.value = '';
    candidates.value = [];
    await loadItem();
  } catch (e) {
    urlError.value = e.response?.data?.error || 'Failed to fetch URL';
  } finally {
    fetchingUrl.value = false;
  }
}

async function deleteManual(id) {
  await manualsApi.delete(id);
  await loadItem();
}

onMounted(async () => {
  await Promise.all([loadItem(), loadTasks()]);
  if (isVehicle.value) loadOdometer();
  if (item.value?.autoLookupManual !== false && !item.value?.manuals?.length) runLookup();
});
</script>

<style scoped>
.candidate-item { border-bottom: 1px solid rgba(var(--v-theme-on-surface),.06); }
.candidate-item:last-child { border-bottom: none; }
</style>
