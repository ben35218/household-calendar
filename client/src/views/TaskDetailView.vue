<template>
  <v-container class="py-6" max-width="800">
    <div class="d-flex align-center mb-4">
      <BackButton />
      <div class="ml-2">
        <h1 class="text-h4 font-weight-bold">{{ task?.title }}</h1>
        <div class="d-flex align-center ga-2 mt-1">
          <v-chip v-if="task?.active === false" color="grey" size="small" label prepend-icon="mdi-pause-circle">Paused</v-chip>
          <v-chip v-else-if="task" :color="statusColor" size="small" label>{{ statusLabel }}</v-chip>
        </div>
      </div>
      <v-spacer />
      <v-btn icon="mdi-delete-outline" variant="text" color="error" class="mr-1" @click="deleteDialog = true" />
      <v-btn variant="outlined" prepend-icon="mdi-pencil" :to="`/tasks/${$route.params.id}/edit`" class="mr-2">Edit</v-btn>
      <v-btn v-if="task?.active === false" variant="outlined" color="#1976D2" prepend-icon="mdi-play" :loading="pausing" class="mr-2" @click="togglePause">Resume</v-btn>
      <v-btn v-else-if="task" variant="outlined" prepend-icon="mdi-pause" :loading="pausing" class="mr-2" @click="togglePause">Pause</v-btn>
      <v-btn v-if="task?.active !== false" color="#1976D2" prepend-icon="mdi-check" @click="completeOpen = !completeOpen">Mark Done</v-btn>
    </div>

    <v-expand-transition>
      <v-card v-if="completeOpen" rounded="lg" elevation="1" class="mb-4">
        <v-card-title class="d-flex align-center">
          Mark Task Complete
          <v-spacer />
          <v-btn icon="mdi-close" variant="text" size="small" @click="completeOpen = false" />
        </v-card-title>
        <v-divider />
        <v-card-text>
          <v-text-field v-model="completeForm.completedDate" label="Completion Date" type="date" variant="outlined" class="mb-3" />
          <v-text-field
            v-if="task?.intervalKm"
            v-model="completeForm.odometerReading"
            label="Odometer reading (km)"
            type="number"
            variant="outlined"
            class="mb-3"
            prepend-inner-icon="mdi-gauge"
            hint="Required to update the mileage schedule"
            persistent-hint
          />
          <v-text-field v-model="completeForm.cost" label="Cost ($)" type="number" variant="outlined" class="mb-3" prefix="$" />
          <v-text-field v-model="completeForm.performedBy" label="Performed By" variant="outlined" class="mb-3" />
          <v-textarea v-model="completeForm.notes" label="Notes" variant="outlined" rows="2" />
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn @click="completeOpen = false">Cancel</v-btn>
          <v-btn color="#1976D2" :loading="completing" @click="doComplete">Mark Done</v-btn>
        </v-card-actions>
      </v-card>
    </v-expand-transition>

    <!-- Km remaining banner for mileage-tracked tasks -->
    <v-card v-if="task && remainingKm !== null" rounded="lg" elevation="1" class="mb-4"
      :color="remainingKm <= 0 ? 'error' : remainingKm <= 2000 ? 'warning' : 'success'"
      variant="tonal"
    >
      <v-card-text class="d-flex align-center ga-4 py-3">
        <v-icon size="32">mdi-gauge</v-icon>
        <div>
          <div class="text-h6 font-weight-bold">
            {{ remainingKm <= 0
              ? `${Math.abs(remainingKm).toLocaleString()} km overdue`
              : `${remainingKm.toLocaleString()} km remaining`
            }}
          </div>
          <div class="text-body-2">
            {{ remainingKm <= 0
              ? `Due at ${task.nextDueKm?.toLocaleString()} km — current odometer: ${currentKm?.toLocaleString()} km`
              : `Due at ${task.nextDueKm?.toLocaleString()} km — current odometer: ${currentKm?.toLocaleString()} km`
            }}
          </div>
        </div>
        <v-spacer />
        <div class="text-right">
          <div class="text-caption text-medium-emphasis">interval</div>
          <div class="text-body-2 font-weight-medium">every {{ task.intervalKm?.toLocaleString() }} km</div>
        </div>
      </v-card-text>
      <v-progress-linear
        v-if="task.lastServiceKm != null"
        :model-value="Math.min(100, ((currentKm - task.lastServiceKm) / task.intervalKm) * 100)"
        :color="remainingKm <= 0 ? 'error' : remainingKm <= 2000 ? 'warning' : 'success'"
        bg-color="surface-variant"
        height="4"
      />
    </v-card>

    <template v-if="task">
      <v-card rounded="lg" elevation="1" class="mb-4">
        <v-list class="py-2" bg-color="transparent">
          <v-list-item v-if="task.itemId" prepend-icon="mdi-link-variant" title="Linked item" :subtitle="task.itemId.name" :to="`/items/${task.itemId._id}`" />
          <v-list-item prepend-icon="mdi-calendar-outline" title="Next due" :subtitle="task.nextDueDate ? formatDate(task.nextDueDate) : 'Not set'" />
          <v-list-item v-if="task.lastCompletedAt" prepend-icon="mdi-history" title="Last completed" :subtitle="formatDate(task.lastCompletedAt)" />
          <v-list-item v-if="task.recurrence" prepend-icon="mdi-repeat" title="Recurrence" :subtitle="recurrenceLabel" />
          <v-list-item v-if="task.intervalKm" prepend-icon="mdi-gauge" title="Service interval" :subtitle="`Every ${task.intervalKm.toLocaleString()} km`" />
          <v-list-item v-if="task.lastServiceKm" prepend-icon="mdi-gauge" title="Last service" :subtitle="`${task.lastServiceKm.toLocaleString()} km`" />
          <v-list-item v-if="task.nextDueKm" prepend-icon="mdi-gauge" title="Next service at" :subtitle="`${task.nextDueKm.toLocaleString()} km`" />
          <v-list-item v-if="task.estimatedDurationMins" prepend-icon="mdi-clock-outline" title="Est. duration" :subtitle="`${task.estimatedDurationMins} min`" />
          <v-list-item v-if="task.estimatedCost" prepend-icon="mdi-currency-usd" title="Est. cost" :subtitle="`$${task.estimatedCost}`" />
          <v-list-item prepend-icon="mdi-bell-outline" title="Alerts">
            <template #subtitle>
              <span :class="{ 'text-medium-emphasis': alertSummary === 'No alerts' }">{{ alertSummary }}</span>
            </template>
          </v-list-item>
        </v-list>

        <template v-if="task.description">
          <v-divider />
          <div class="pa-4">
            <div class="text-overline text-medium-emphasis mb-1">Description</div>
            <p class="text-body-1 mb-0">{{ task.description }}</p>
          </div>
        </template>
        <template v-if="task.instructions">
          <v-divider />
          <div class="pa-4">
            <div class="text-overline text-medium-emphasis mb-1">Instructions</div>
            <p class="text-body-1 mb-0 white-space-pre-wrap">{{ task.instructions }}</p>
          </div>
        </template>
      </v-card>

      <v-card rounded="lg" elevation="1">
        <v-card-title>Completion history</v-card-title>
        <v-divider />
        <v-list bg-color="transparent">
          <template v-if="history.length">
            <v-list-item v-for="h in history" :key="h._id" prepend-icon="mdi-check-circle-outline" :title="formatDate(h.completedDate)" :subtitle="[h.performedBy, h.cost ? `$${h.cost}` : '', h.notes].filter(Boolean).join(' · ')" />
          </template>
          <v-list-item v-else>
            <v-list-item-title class="text-medium-emphasis text-body-2">No history yet</v-list-item-title>
          </v-list-item>
        </v-list>
      </v-card>
    </template>

  </v-container>

  <v-dialog v-model="deleteDialog" max-width="400">
    <v-card rounded="lg">
      <v-card-title class="d-flex align-center ga-2">
        <v-icon color="error">mdi-delete-alert</v-icon>
        Delete Task
      </v-card-title>
      <v-card-text>
        Are you sure you want to delete <strong>{{ task?.title }}</strong>? This will also remove all completion history and cannot be undone.
      </v-card-text>
      <v-card-actions>
        <v-spacer />
        <v-btn @click="deleteDialog = false">Cancel</v-btn>
        <v-btn color="error" variant="tonal" :loading="deleting" @click="doDelete">Delete</v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { format, isBefore, addDays, startOfDay } from 'date-fns';
import { tasksApi, historyApi, odometerApi } from '../services/api';
import { useReturnTo } from '../composables/useSmartBack';

const route = useRoute();
const returnTo = useReturnTo();
const task = ref(null);
const history = ref([]);
const currentKm = ref(null);
const completeOpen = ref(false);
const completing = ref(false);
const pausing = ref(false);
const deleteDialog = ref(false);
const deleting = ref(false);
const completeForm = ref({ completedDate: format(new Date(), 'yyyy-MM-dd'), cost: '', notes: '', performedBy: 'self', odometerReading: '' });

function parseCalendarDate(d) {
  const iso = new Date(d).toISOString();
  const [y, mo, day] = iso.slice(0, 10).split('-').map(Number);
  return new Date(y, mo - 1, day, 12, 0, 0);
}

function formatDate(d) { return format(parseCalendarDate(d), 'MMM d, yyyy'); }

const statusColor = computed(() => {
  if (!task.value?.nextDueDate) return 'grey';
  const due = parseCalendarDate(task.value.nextDueDate);
  if (isBefore(due, startOfDay(new Date()))) return 'error';
  if (isBefore(due, addDays(new Date(), 7))) return 'warning';
  return 'success';
});

const statusLabel = computed(() => {
  if (!task.value?.nextDueDate) return 'No date';
  const due = parseCalendarDate(task.value.nextDueDate);
  if (isBefore(due, startOfDay(new Date()))) return 'Overdue';
  if (isBefore(due, addDays(new Date(), 7))) return 'Due Soon';
  return 'Upcoming';
});

function alertPhrase(days) {
  if (days == null) return null;
  if (days === 0) return 'On the due date';
  if (days === 1) return '1 day before';
  if (days === 7) return '1 week before';
  return `${days} days before`;
}
const alertSummary = computed(() => {
  const parts = [alertPhrase(task.value?.reminderDaysBefore), alertPhrase(task.value?.alert2DaysBefore)].filter(Boolean);
  if (!parts.length) return 'No alerts';
  if (task.value?.alertAudience === 'owner') parts.push('you only');
  return parts.join(' · ');
});

const WEEKDAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
const MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
function ordinal(n) {
  const s = ['th','st','nd','rd'], v = n % 100;
  return n + (s[(v-20)%10] || s[v] || s[0]);
}

const recurrenceLabel = computed(() => {
  const r = task.value?.recurrence;
  if (!r) return '';
  if (r.type === 'one-time') return 'One-time';
  if (r.type === 'calendar') {
    const months = r.months?.map(m => MONTH_NAMES[m-1]).join(', ');
    const day = r.dayOfMonth ? ` on the ${ordinal(r.dayOfMonth)}` : '';
    return months ? `Every year in ${months}${day}` : 'Calendar';
  }
  if (r.type === 'interval') {
    const n = r.intervalValue;
    const unit = n === 1 ? r.intervalUnit?.replace(/s$/, '') : r.intervalUnit;
    let label = `Every ${n} ${unit}`;
    if (r.intervalUnit === 'weeks' && r.dayOfWeek != null) label += ` on ${WEEKDAY_NAMES[r.dayOfWeek]}`;
    if (r.intervalUnit === 'months') {
      if (r.weekOfMonth != null && r.dayOfWeek != null) {
        const pos = r.weekOfMonth === -1 ? 'last' : ['','first','second','third','fourth'][r.weekOfMonth];
        label += ` on the ${pos} ${WEEKDAY_NAMES[r.dayOfWeek]}`;
      } else if (r.dayOfMonth) {
        label += ` on the ${ordinal(r.dayOfMonth)}`;
      }
    }
    if (r.intervalUnit === 'years') {
      const m = r.months?.[0];
      const d = r.dayOfMonth;
      if (m && d) label += ` on ${MONTH_NAMES[m-1]} ${ordinal(d)}`;
      else if (m) label += ` in ${MONTH_NAMES[m-1]}`;
      else if (d) label += ` on the ${ordinal(d)}`;
    }
    return label;
  }
  return '';
});

async function togglePause() {
  pausing.value = true;
  try {
    if (task.value.active === false) {
      await tasksApi.resume(route.params.id);
    } else {
      await tasksApi.pause(route.params.id);
    }
    const { data } = await tasksApi.get(route.params.id);
    task.value = data;
  } finally {
    pausing.value = false;
  }
}

async function doComplete() {
  completing.value = true;
  try {
    const payload = { ...completeForm.value };
    if (!payload.cost) delete payload.cost;
    const { data } = await tasksApi.complete(route.params.id, payload);
    task.value = data.task;
    history.value.unshift(data.completion);
    completeOpen.value = false;
  } finally {
    completing.value = false;
  }
}

const remainingKm = computed(() => {
  if (!task.value?.intervalKm || !task.value?.nextDueKm || currentKm.value == null) return null;
  return task.value.nextDueKm - currentKm.value;
});

async function doDelete() {
  deleting.value = true;
  try {
    await tasksApi.delete(route.params.id);
    returnTo('/maintenance');
  } finally {
    deleting.value = false;
  }
}

onMounted(async () => {
  const [taskRes, histRes] = await Promise.all([
    tasksApi.get(route.params.id),
    historyApi.list({ taskId: route.params.id }),
  ]);
  task.value = taskRes.data;
  history.value = histRes.data;

  // Load current odometer if this task is linked to a vehicle item
  if (task.value?.itemId?._id && task.value?.intervalKm) {
    try {
      const { data } = await odometerApi.get(task.value.itemId._id);
      currentKm.value = data.currentKm;
    } catch {}
  }
});
</script>
