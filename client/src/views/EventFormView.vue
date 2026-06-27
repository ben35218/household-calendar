<template>
  <div class="form-page">
    <!-- Header: back button + tabs (or title when editing) -->
    <div class="form-header">
      <div class="header-inner">
        <BackButton />
        <span v-if="isEdit" class="text-h6 font-weight-bold ml-1">Edit Event</span>
        <template v-else>
          <div class="tab-switcher">
            <button
              class="tab-btn tab-btn--event"
              :class="{ 'tab-btn--active': activeTab === 'event' }"
              aria-label="Event"
              @click="activeTab = 'event'"
            >
              <v-icon size="20" :color="activeTab === 'event' ? '#388E3C' : ''">mdi-run</v-icon>
              <v-icon size="20" :color="activeTab === 'event' ? '#7B1FA2' : ''">mdi-calendar-clock</v-icon>
            </button>
            <button
              class="tab-btn tab-btn--task"
              :class="{ 'tab-btn--active': activeTab === 'task' }"
              aria-label="Maintenance Task"
              @click="activeTab = 'task'"
            >
              <v-icon size="22" :color="activeTab === 'task' ? '#1976D2' : ''">mdi-wrench</v-icon>
            </button>
            <button
              class="tab-btn tab-btn--chore"
              :class="{ 'tab-btn--active': activeTab === 'chore' }"
              aria-label="Chore"
              @click="activeTab = 'chore'"
            >
              <v-icon size="22" :color="activeTab === 'chore' ? '#F57C00' : ''">mdi-broom</v-icon>
            </button>
          </div>
          <v-btn
            v-if="activeTab === 'task'"
            variant="text"
            size="small"
            prepend-icon="mdi-view-grid-outline"
            color="#1976D2"
            class="ml-auto"
            to="/tasks/templates"
          >Templates</v-btn>
          <v-btn
            v-if="activeTab === 'chore'"
            variant="text"
            size="small"
            prepend-icon="mdi-view-grid-outline"
            color="#F57C00"
            class="ml-auto"
            to="/chores/templates"
          >Templates</v-btn>
        </template>
      </div>
    </div>

    <div class="form-body">
      <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />

    <!-- ── EVENT FORM ──────────────────────────────────────────────────────── -->
    <v-card v-show="isEdit || activeTab === 'event'" rounded="lg" elevation="1">
      <v-card-text class="pa-5">
        <v-text-field v-model="eventForm.title" label="Title" variant="outlined" class="mb-3" autofocus />
        <v-select
          v-model="eventForm.calendarType"
          :items="calendarTypeItems"
          item-value="value"
          item-title="title"
          label="Calendar"
          variant="outlined"
          class="mb-3"
        />
        <div class="d-flex ga-3 mb-2">
          <v-text-field v-model="eventForm.date" label="Start date" type="date" variant="outlined" density="compact" hide-details />
          <v-text-field v-model="eventForm.endDate" label="End date" type="date" variant="outlined" density="compact" hide-details :min="eventForm.date" clearable />
        </div>
        <v-switch v-model="eventForm.allDay" label="All day" hide-details density="compact" inset color="primary" class="mb-3" />
        <div v-if="!eventForm.allDay" class="d-flex ga-3 mb-3">
          <v-text-field v-model="eventForm.startTime" label="Start time" type="time" variant="outlined" density="compact" hide-details />
          <v-text-field v-model="eventForm.endTime" label="End time" type="time" variant="outlined" density="compact" hide-details />
        </div>
        <v-text-field v-model="eventForm.description" label="Description (optional)" variant="outlined" class="mb-3" />
        <v-combobox
          v-model="eventForm.locationRaw"
          :items="placeSuggestions"
          item-title="description"
          return-object
          no-filter
          clearable
          :loading="placesLoading"
          label="Location (optional)"
          placeholder="Search for a business or address..."
          variant="outlined"
          class="mb-1"
          @update:search="debouncePlacesSearch"
          @update:model-value="onPlaceSelected"
        >
          <template #item="{ item, props }">
            <v-list-item v-bind="props" :title="item.raw.main_text" :subtitle="item.raw.secondary_text" />
          </template>
        </v-combobox>
        <v-text-field
          v-model="eventForm.fromAddress"
          label="From (starting location)"
          variant="outlined"
          density="compact"
          placeholder="123 Main St, Toronto, ON"
          prepend-inner-icon="mdi-map-marker-account"
          class="mb-1"
          clearable
        />
        <div v-if="travelLoading" class="text-caption text-medium-emphasis mb-3 d-flex align-center ga-1">
          <v-progress-circular size="12" width="2" indeterminate />
          Calculating drive time...
        </div>
        <div v-else-if="eventForm.travelMinutes" class="text-caption text-medium-emphasis mb-3">
          <v-icon size="14" class="mr-1">mdi-car</v-icon>
          ~{{ eventForm.travelMinutes }} min drive
          <template v-if="eventForm.travelDistanceKm"> · {{ eventForm.travelDistanceKm }} km</template>
          <strong v-if="leaveByTime"> · Leave by {{ leaveByTime }}</strong>
        </div>
        <div v-else-if="!travelLoading && eventForm.locationRaw && !eventForm.travelMinutes" class="text-caption text-medium-emphasis mb-3">
          Enter a starting location above to calculate drive time
        </div>
        <v-text-field
          v-model="eventForm.phone"
          label="Business phone (optional — for AI calling)"
          type="tel"
          variant="outlined"
          placeholder="+1 (416) 555-1234"
          hint="Type any 10-digit format — will be formatted automatically"
          persistent-hint
          class="mb-3"
          @blur="onPhoneBlur"
        />
        <v-text-field v-model="eventForm.url" label="URL (optional)" type="url" variant="outlined" placeholder="https://meet.google.com/..." class="mb-3" />
        <v-select v-model="eventForm.reminderMinutes" :items="alertItems" item-value="value" item-title="label" label="Alert" variant="outlined" class="mb-3" />
        <v-select
          v-if="eventForm.reminderMinutes !== null"
          v-model="eventForm.alert2Minutes"
          :items="alertItems"
          item-value="value"
          item-title="label"
          label="Second Alert"
          variant="outlined"
          class="mb-3"
        />
        <v-select
          v-if="memberCount > 1 && eventForm.reminderMinutes !== null"
          v-model="eventForm.alertAudience"
          :items="AUDIENCE_ITEMS"
          item-value="value"
          item-title="label"
          label="Alert who?"
          variant="outlined"
          prepend-inner-icon="mdi-account-group"
          class="mb-3"
        />
        <v-select v-model="eventForm.recurrFreq" :items="recurrFreqItems" item-value="value" item-title="title" label="Repeat" variant="outlined" :class="eventForm.recurrFreq ? 'mb-3' : ''" />
        <v-text-field v-if="eventForm.recurrFreq" v-model="eventForm.recurrUntil" label="Repeat until (optional)" type="date" variant="outlined" />
      </v-card-text>
      <v-divider />
      <v-card-actions class="pa-4">
        <v-btn v-if="isEdit" color="error" variant="text" :loading="saving" @click="deleteEvent">Delete</v-btn>
        <v-spacer />
        <v-btn variant="text" @click="goBack">Cancel</v-btn>
        <v-btn color="#388E3C" variant="elevated" :loading="saving" :disabled="!eventForm.title.trim() || !eventForm.date" @click="saveEvent">Save</v-btn>
      </v-card-actions>
    </v-card>

    <!-- ── TASK FORM ───────────────────────────────────────────────────────── -->
    <v-card v-show="!isEdit && activeTab === 'task'" rounded="lg" elevation="1">
      <v-card-text class="pa-6">
        <v-form ref="taskFormRef" @submit.prevent="saveTask">
          <v-row>
            <v-col cols="12">
              <v-text-field v-model="taskForm.title" label="Task Title *" variant="outlined" :rules="[v => !!v || 'Title is required']" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-select v-model="taskForm.categoryId" :items="categories.map(c => ({ title: c.name, value: c._id }))" label="Category" variant="outlined" clearable />
            </v-col>
            <v-col cols="12" sm="6">
              <v-select v-model="taskForm.itemId" :items="[{ title: '(No item)', value: '' }, ...items.map(i => ({ title: i.name, value: i._id }))]" label="Linked Item" variant="outlined" clearable />
            </v-col>
            <v-col cols="12">
              <v-textarea v-model="taskForm.description" label="Description" variant="outlined" rows="2" auto-grow />
            </v-col>
            <v-col cols="12">
              <v-textarea v-model="taskForm.instructions" label="How-to Instructions" variant="outlined" rows="3" auto-grow />
            </v-col>
            <v-col cols="12" sm="4">
              <v-select v-model="taskForm.priority" :items="['low', 'medium', 'high']" label="Priority" variant="outlined" />
            </v-col>
            <v-col cols="12" sm="4">
              <v-text-field v-model.number="taskForm.estimatedDurationMins" label="Est. Duration (min)" type="number" variant="outlined" />
            </v-col>
            <v-col cols="12" sm="4">
              <v-text-field v-model.number="taskForm.estimatedCost" label="Est. Cost ($)" type="number" variant="outlined" prefix="$" />
            </v-col>
          </v-row>

          <v-divider class="my-4" />
          <div class="text-subtitle-1 font-weight-medium mb-3">Recurrence</div>
          <v-row>
            <v-col cols="12" sm="4">
              <v-select v-model="taskForm.recurrence.type" :items="recurrenceTypes" label="Type" variant="outlined" />
            </v-col>

            <template v-if="taskForm.recurrence.type === 'interval'">
              <v-col cols="6" sm="4">
                <v-text-field v-model.number="taskForm.recurrence.intervalValue" label="Every" type="number" min="1" variant="outlined" />
              </v-col>
              <v-col cols="6" sm="4">
                <v-select v-model="taskForm.recurrence.intervalUnit" :items="intervalUnits" label="Unit" variant="outlined" />
              </v-col>

              <v-col v-if="taskForm.recurrence.intervalUnit === 'weeks'" cols="12">
                <div class="text-body-2 text-medium-emphasis mb-2">On (optional)</div>
                <v-chip-group v-model="taskForm.recurrence.dayOfWeek" column>
                  <v-chip v-for="(label, i) in WEEKDAYS" :key="i" :value="i" filter variant="outlined" size="small" color="primary">{{ label }}</v-chip>
                </v-chip-group>
              </v-col>

              <template v-if="taskForm.recurrence.intervalUnit === 'months'">
                <v-col cols="12">
                  <div class="text-body-2 text-medium-emphasis mb-2">On (optional)</div>
                  <v-btn-toggle v-model="monthlyMode" variant="outlined" density="compact" color="#1976D2">
                    <v-btn value="day" size="small">Specific day</v-btn>
                    <v-btn value="weekday" size="small">Day of week</v-btn>
                  </v-btn-toggle>
                </v-col>
                <v-col v-if="monthlyMode === 'day'" cols="12" sm="4">
                  <v-text-field v-model.number="taskForm.recurrence.dayOfMonth" label="Day of month" type="number" min="1" max="31" variant="outlined" hint="e.g. 15 = always on the 15th" persistent-hint />
                </v-col>
                <template v-if="monthlyMode === 'weekday'">
                  <v-col cols="12" sm="4">
                    <v-select v-model="taskForm.recurrence.weekOfMonth" :items="WEEK_OF_MONTH_ITEMS" label="Which occurrence" variant="outlined" />
                  </v-col>
                  <v-col cols="12" sm="8">
                    <div class="text-body-2 text-medium-emphasis mb-2">Weekday</div>
                    <v-chip-group v-model="taskForm.recurrence.dayOfWeek" column>
                      <v-chip v-for="(label, i) in WEEKDAYS" :key="i" :value="i" filter variant="outlined" size="small" color="primary">{{ label }}</v-chip>
                    </v-chip-group>
                  </v-col>
                </template>
              </template>

              <template v-if="taskForm.recurrence.intervalUnit === 'years'">
                <v-col cols="12" sm="4">
                  <v-select v-model="yearMonth" :items="MONTHS" label="In month (optional)" variant="outlined" clearable />
                </v-col>
                <v-col cols="12" sm="4">
                  <v-text-field v-model.number="taskForm.recurrence.dayOfMonth" label="On day (optional)" type="number" min="1" max="31" variant="outlined" />
                </v-col>
              </template>
            </template>

            <template v-if="taskForm.recurrence.type === 'calendar'">
              <v-col cols="12" sm="8">
                <v-select v-model="taskForm.recurrence.months" :items="MONTHS" label="Months" multiple chips closable-chips variant="outlined" />
              </v-col>
              <v-col cols="12" sm="4">
                <v-text-field v-model.number="taskForm.recurrence.dayOfMonth" label="On day of month" type="number" min="1" max="31" variant="outlined" hint="Which day in those months" persistent-hint />
              </v-col>
            </template>

            <v-col cols="12" sm="6">
              <v-text-field v-model="taskForm.nextDueDate" label="Next Due Date" type="date" variant="outlined" />
            </v-col>
          </v-row>

          <v-alert v-if="recurrencePreview" type="info" variant="tonal" density="compact" class="mt-2 mb-2" icon="mdi-repeat">
            {{ recurrencePreview }}
          </v-alert>

          <v-divider class="my-4" />
          <div class="text-subtitle-1 font-weight-medium mb-3">Alerts</div>
          <v-row>
            <v-col cols="12" sm="6">
              <v-select v-model="taskForm.reminderDaysBefore" :items="ALERT_DAY_ITEMS" item-title="label" item-value="value" label="Alert" variant="outlined" />
            </v-col>
            <v-col v-if="taskForm.reminderDaysBefore !== null" cols="12" sm="6">
              <v-select v-model="taskForm.alert2DaysBefore" :items="ALERT_DAY_ITEMS" item-title="label" item-value="value" label="Second alert" variant="outlined" />
            </v-col>
            <v-col v-if="memberCount > 1 && taskForm.reminderDaysBefore !== null" cols="12">
              <v-select v-model="taskForm.alertAudience" :items="AUDIENCE_ITEMS" item-title="label" item-value="value" label="Alert who?" variant="outlined" prepend-inner-icon="mdi-account-group" />
            </v-col>
          </v-row>

          <v-alert v-if="taskError" type="error" class="mt-4" variant="tonal">{{ taskError }}</v-alert>

          <div class="d-flex justify-end mt-6 ga-3">
            <v-btn @click="goBack">Cancel</v-btn>
            <v-btn type="submit" color="#1976D2" :loading="saving">Create Task</v-btn>
          </div>
        </v-form>
      </v-card-text>
    </v-card>
    <!-- ── CHORE FORM ─────────────────────────────────────────────────────── -->
    <v-card v-show="!isEdit && activeTab === 'chore'" rounded="lg" elevation="1">
      <v-card-text class="pa-6">
        <v-form ref="choreFormRef" @submit.prevent="saveChore">
          <v-row>
            <v-col cols="12">
              <v-text-field v-model="choreForm.title" label="Chore Title *" variant="outlined" :rules="[v => !!v || 'Title is required']" />
            </v-col>
            <v-col cols="12">
              <v-textarea v-model="choreForm.instructions" label="Instructions" variant="outlined" rows="2" auto-grow />
            </v-col>
            <v-col cols="12">
              <v-select
                v-model="choreForm.assignedTo"
                :items="familyOptions"
                item-title="title"
                item-value="value"
                label="Assigned to"
                variant="outlined"
                clearable
                prepend-inner-icon="mdi-account"
                placeholder="Unassigned"
              />
            </v-col>
            <v-col cols="12">
              <div class="text-subtitle-2 mb-2">Icon</div>
              <div class="icon-picker">
                <span
                  v-for="opt in CHORE_ICONS"
                  :key="opt.value"
                  class="icon-option"
                  :class="{ 'icon-option--selected': choreForm.icon === opt.value }"
                  :title="opt.label"
                  @click="choreForm.icon = opt.value"
                >
                  <v-icon size="20">{{ opt.value }}</v-icon>
                </span>
              </div>
            </v-col>
          </v-row>

          <v-divider class="my-4" />
          <div class="text-subtitle-1 font-weight-medium mb-3">Recurrence</div>
          <v-row>
            <v-col cols="12" sm="4">
              <v-select v-model="choreForm.recurrence.type" :items="recurrenceTypes" label="Type" variant="outlined" />
            </v-col>

            <template v-if="choreForm.recurrence.type === 'interval'">
              <v-col cols="6" sm="4">
                <v-text-field v-model.number="choreForm.recurrence.intervalValue" label="Every" type="number" min="1" variant="outlined" />
              </v-col>
              <v-col cols="6" sm="4">
                <v-select v-model="choreForm.recurrence.intervalUnit" :items="intervalUnits" label="Unit" variant="outlined" />
              </v-col>

              <v-col v-if="choreForm.recurrence.intervalUnit === 'weeks'" cols="12">
                <div class="text-body-2 text-medium-emphasis mb-2">On (optional)</div>
                <v-chip-group v-model="choreForm.recurrence.dayOfWeek" column>
                  <v-chip v-for="(label, i) in WEEKDAYS" :key="i" :value="i" filter variant="outlined" size="small" color="primary">{{ label }}</v-chip>
                </v-chip-group>
              </v-col>

              <template v-if="choreForm.recurrence.intervalUnit === 'months'">
                <v-col cols="12">
                  <div class="text-body-2 text-medium-emphasis mb-2">On (optional)</div>
                  <v-btn-toggle v-model="choreMonthlyMode" variant="outlined" density="compact" color="#F57C00">
                    <v-btn value="day" size="small">Specific day</v-btn>
                    <v-btn value="weekday" size="small">Day of week</v-btn>
                  </v-btn-toggle>
                </v-col>
                <v-col v-if="choreMonthlyMode === 'day'" cols="12" sm="4">
                  <v-text-field v-model.number="choreForm.recurrence.dayOfMonth" label="Day of month" type="number" min="1" max="31" variant="outlined" hint="e.g. 15 = always on the 15th" persistent-hint />
                </v-col>
                <template v-if="choreMonthlyMode === 'weekday'">
                  <v-col cols="12" sm="4">
                    <v-select v-model="choreForm.recurrence.weekOfMonth" :items="WEEK_OF_MONTH_ITEMS" label="Which occurrence" variant="outlined" />
                  </v-col>
                  <v-col cols="12" sm="8">
                    <div class="text-body-2 text-medium-emphasis mb-2">Weekday</div>
                    <v-chip-group v-model="choreForm.recurrence.dayOfWeek" column>
                      <v-chip v-for="(label, i) in WEEKDAYS" :key="i" :value="i" filter variant="outlined" size="small" color="primary">{{ label }}</v-chip>
                    </v-chip-group>
                  </v-col>
                </template>
              </template>
            </template>

            <template v-if="choreForm.recurrence.type === 'calendar'">
              <v-col cols="12" sm="8">
                <v-select v-model="choreForm.recurrence.months" :items="MONTHS" label="Months" multiple chips closable-chips variant="outlined" />
              </v-col>
              <v-col cols="12" sm="4">
                <v-text-field v-model.number="choreForm.recurrence.dayOfMonth" label="On day of month" type="number" min="1" max="31" variant="outlined" hint="Which day in those months" persistent-hint />
              </v-col>
            </template>

            <v-col cols="12" sm="6">
              <v-text-field v-model="choreForm.nextDueDate" label="Next Due Date" type="date" variant="outlined" />
            </v-col>
          </v-row>

          <v-alert v-if="choreRecurrencePreview" type="info" variant="tonal" density="compact" class="mt-2 mb-2" icon="mdi-repeat">
            {{ choreRecurrencePreview }}
          </v-alert>

          <v-divider class="my-4" />
          <div class="text-subtitle-1 font-weight-medium mb-3">Alerts</div>
          <v-row>
            <v-col cols="12" sm="6">
              <v-select v-model="choreForm.reminderDaysBefore" :items="ALERT_DAY_ITEMS" item-title="label" item-value="value" label="Alert" variant="outlined" />
            </v-col>
            <v-col v-if="choreForm.reminderDaysBefore !== null" cols="12" sm="6">
              <v-select v-model="choreForm.alert2DaysBefore" :items="ALERT_DAY_ITEMS" item-title="label" item-value="value" label="Second alert" variant="outlined" />
            </v-col>
            <v-col v-if="memberCount > 1 && choreForm.reminderDaysBefore !== null" cols="12">
              <v-select v-model="choreForm.alertAudience" :items="AUDIENCE_ITEMS" item-title="label" item-value="value" label="Alert who?" variant="outlined" prepend-inner-icon="mdi-account-group" />
            </v-col>
          </v-row>

          <v-alert v-if="choreError" type="error" class="mt-4" variant="tonal">{{ choreError }}</v-alert>

          <div class="d-flex justify-end mt-6 ga-3">
            <v-btn @click="goBack">Cancel</v-btn>
            <v-btn type="submit" color="#F57C00" :loading="saving">Create Chore</v-btn>
          </div>
        </v-form>
      </v-card-text>
    </v-card>
    </div><!-- /form-body -->
  </div><!-- /form-page -->
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { format } from 'date-fns';
import { calendarApi, placesApi, settingsApi, tasksApi, categoriesApi, itemsApi, choresApi, peopleApi } from '../services/api';
import { useSmartBack, useReturnTo } from '../composables/useSmartBack';
import { useAuthStore } from '../stores/auth';

const route  = useRoute();
const router = useRouter();
const goBack = useSmartBack();
const returnTo = useReturnTo();
const auth   = useAuthStore();

const isEdit    = computed(() => !!route.params.eventId);
const activeTab = ref(
  route.query.tab === 'task'  ? 'task'  :
  route.query.tab === 'chore' ? 'chore' : 'event'
);
const loading   = ref(false);
const saving    = ref(false);

const pageTitle = computed(() => {
  if (isEdit.value) return 'Edit Event';
  return activeTab.value === 'task' ? 'New Task' : 'New Event';
});

// ── EVENT FORM ─────────────────────────────────────────────────────────────────

const eventForm = ref({
  title:        route.query.prefill_title        || '',
  calendarType: route.query.prefill_calendarType || 'activities',
  date:         route.query.prefill_date         || route.query.date || format(new Date(), 'yyyy-MM-dd'),
  allDay:       route.query.prefill_allDay !== undefined ? route.query.prefill_allDay !== 'false' : true,
  endDate:      route.query.prefill_endDate ||
                  (route.query.prefill_allDay === 'false'
                    ? (route.query.prefill_date || route.query.date || format(new Date(), 'yyyy-MM-dd'))
                    : ''),
  startTime:    route.query.prefill_startTime    || '09:00',
  endTime:      route.query.prefill_endTime      || '10:00',
  description:  route.query.prefill_description  || '',
  locationRaw: '', phone: route.query.prefill_phone || '+1 ', url: '',
  travelMinutes: null, travelDistanceKm: null, fromAddress: '',
  reminderMinutes: route.query.prefill_reminderMinutes !== undefined
                     ? Number(route.query.prefill_reminderMinutes)
                     : null,
  alert2Minutes: null,
  alertAudience: 'everyone',
  recurrFreq:   route.query.prefill_recurrFreq   || '',
  recurrUntil: '',
});

const AUDIENCE_ITEMS = [
  { value: 'everyone', label: 'Everyone in the household' },
  { value: 'owner',    label: 'Only me' },
];
const memberCount = ref(1);

const calendarTypeItems = [
  { value: 'activities',   title: 'Activities'   },
  { value: 'appointments', title: 'Appointments' },
];

const BASE_ALERT_ITEMS = [
  { value: null,  label: 'No alert'          },
  { value: 0,     label: 'At event time'     },
  { value: 15,    label: '15 minutes before' },
  { value: 30,    label: '30 minutes before' },
  { value: 60,    label: '1 hour before'     },
  { value: 120,   label: '2 hours before'    },
  { value: 1440,  label: '1 day before'      },
  { value: 2880,  label: '2 days before'     },
];

const recurrFreqItems = [
  { value: '',        title: 'Does not repeat' },
  { value: 'daily',   title: 'Daily'           },
  { value: 'weekly',  title: 'Weekly'          },
  { value: 'monthly', title: 'Monthly'         },
  { value: 'yearly',  title: 'Yearly'          },
];

const leaveByTime = computed(() => {
  const { travelMinutes, allDay, startTime } = eventForm.value;
  if (!travelMinutes || allDay || !startTime) return null;
  const [h, m] = startTime.split(':').map(Number);
  const total  = h * 60 + m - travelMinutes;
  if (total < 0) return null;
  const lh = Math.floor(total / 60);
  const lm = total % 60;
  const ampm = lh >= 12 ? 'PM' : 'AM';
  return `${lh % 12 || 12}:${String(lm).padStart(2, '0')} ${ampm}`;
});

const alertItems = computed(() => {
  const items = [...BASE_ALERT_ITEMS];
  const { travelMinutes } = eventForm.value;
  if (travelMinutes) {
    const label = leaveByTime.value
      ? `At departure time (leave at ${leaveByTime.value})`
      : `At departure time (~${travelMinutes} min drive)`;
    items.push({ value: travelMinutes, label });
  }
  return items;
});

const placeSuggestions = ref([]);
const placesLoading    = ref(false);
let placesTimer = null;

function debouncePlacesSearch(query) {
  clearTimeout(placesTimer);
  const cur = eventForm.value.locationRaw;
  if (cur && typeof cur === 'object' && cur.description === query) return;
  if (!query || query.length < 3) { placeSuggestions.value = []; return; }
  placesTimer = setTimeout(async () => {
    placesLoading.value = true;
    try {
      const { data } = await placesApi.autocomplete(query);
      placeSuggestions.value = data.predictions ?? [];
    } catch {
      placeSuggestions.value = [];
    } finally {
      placesLoading.value = false;
    }
  }, 350);
}

async function onPlaceSelected(val) {
  if (!val || typeof val !== 'object' || !val.place_id) return;
  try {
    const { data } = await placesApi.getDetails(val.place_id);
    const rawPhone = data.result?.international_phone_number || data.result?.formatted_phone_number;
    if (rawPhone) {
      const d = rawPhone.replace(/\D/g, '');
      const local = d.startsWith('1') && d.length === 11 ? d.slice(1) : d;
      eventForm.value.phone = local.length === 10
        ? `+1 (${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`
        : rawPhone;
    }
  } catch { /* ignore */ }
  await fetchTravelTime();
}

const travelLoading = ref(false);

async function fetchTravelTime() {
  const raw = eventForm.value.locationRaw;
  const destination = raw && typeof raw === 'object' ? raw.description : (raw || '');
  const origin = eventForm.value.fromAddress?.trim();
  if (!destination) return;
  eventForm.value.travelMinutes    = null;
  eventForm.value.travelDistanceKm = null;
  travelLoading.value = true;
  try {
    const { data } = await placesApi.getTravelTime(destination, origin);
    eventForm.value.travelMinutes    = data.minutes;
    eventForm.value.travelDistanceKm = data.distanceKm;
  } catch { /* no address or Routes API not enabled */ } finally {
    travelLoading.value = false;
  }
}

let fromAddressTimer = null;
watch(() => eventForm.value.fromAddress, (val) => {
  clearTimeout(fromAddressTimer);
  if (!val || val.length < 5) return;
  fromAddressTimer = setTimeout(fetchTravelTime, 700);
});

function formatPhoneInput(raw) {
  const digits = raw.replace(/\D/g, '');
  const local = digits.startsWith('1') && digits.length === 11 ? digits.slice(1) : digits;
  if (local.length === 10) return `+1 (${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6)}`;
  return raw;
}

function onPhoneBlur() {
  const val = eventForm.value.phone;
  if (val && val.trim() !== '+1') eventForm.value.phone = formatPhoneInput(val);
}

async function saveEvent() {
  if (!eventForm.value.title.trim() || !eventForm.value.date) return;
  saving.value = true;
  try {
    const raw         = eventForm.value.locationRaw;
    const locationStr = raw && typeof raw === 'object' ? (raw.description ?? '') : (raw ?? '');
    const placeId     = raw && typeof raw === 'object' ? raw.place_id : undefined;
    const allDay      = eventForm.value.allDay;
    const startDate   = allDay
      ? `${eventForm.value.date}T12:00:00.000Z`
      : new Date(`${eventForm.value.date}T${eventForm.value.startTime}:00`).toISOString();
    const endDatePart = eventForm.value.endDate || eventForm.value.date;
    const endDate     = allDay
      ? (eventForm.value.endDate ? `${eventForm.value.endDate}T12:00:00.000Z` : undefined)
      : (eventForm.value.endTime ? new Date(`${endDatePart}T${eventForm.value.endTime}:00`).toISOString() : undefined);
    const recurrence  = eventForm.value.recurrFreq
      ? { freq: eventForm.value.recurrFreq, until: eventForm.value.recurrUntil || undefined }
      : undefined;
    const payload = {
      title:            eventForm.value.title.trim(),
      calendarType:     eventForm.value.calendarType,
      allDay, startDate, endDate,
      description:      eventForm.value.description || undefined,
      location:         locationStr || undefined,
      placeId:          placeId || undefined,
      phone:            eventForm.value.phone.replace(/\D/g, '').length >= 10
                          ? formatPhoneInput(eventForm.value.phone) : undefined,
      url:              eventForm.value.url || undefined,
      travelMinutes:    eventForm.value.travelMinutes ?? undefined,
      travelDistanceKm: eventForm.value.travelDistanceKm ?? undefined,
      reminderMinutes:  eventForm.value.reminderMinutes ?? undefined,
      alert2Minutes:    (eventForm.value.reminderMinutes !== null && eventForm.value.alert2Minutes !== null)
                          ? eventForm.value.alert2Minutes : undefined,
      alertAudience:    eventForm.value.alertAudience || 'everyone',
      recurrence,
    };
    if (isEdit.value) {
      await calendarApi.updateEvent(route.params.eventId, payload);
    } else {
      await calendarApi.createEvent(payload);
    }
    returnTo('/calendar');
  } finally {
    saving.value = false;
  }
}

async function deleteEvent() {
  saving.value = true;
  try {
    await calendarApi.deleteEvent(route.params.eventId);
    returnTo('/calendar');
  } finally {
    saving.value = false;
  }
}

// ── TASK FORM ──────────────────────────────────────────────────────────────────

const taskFormRef  = ref(null);
const categories   = ref([]);
const items        = ref([]);
const taskError    = ref('');
const monthlyMode  = ref('day');

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK_OF_MONTH_ITEMS = [
  { title: 'First', value: 1 }, { title: 'Second', value: 2 },
  { title: 'Third', value: 3 }, { title: 'Fourth', value: 4 },
  { title: 'Last',  value: -1 },
];
const MONTHS = [
  { title: 'January', value: 1 }, { title: 'February', value: 2 },
  { title: 'March', value: 3 },   { title: 'April', value: 4 },
  { title: 'May', value: 5 },     { title: 'June', value: 6 },
  { title: 'July', value: 7 },    { title: 'August', value: 8 },
  { title: 'September', value: 9 }, { title: 'October', value: 10 },
  { title: 'November', value: 11 }, { title: 'December', value: 12 },
];
const MONTH_NAMES = MONTHS.map(m => m.title);

const recurrenceTypes = [
  { title: 'Interval (every N days/weeks/months/years)', value: 'interval'  },
  { title: 'Calendar (specific months of the year)',     value: 'calendar'  },
  { title: 'One-time',                                   value: 'one-time'  },
];
const intervalUnits = [
  { title: 'Days',   value: 'days'   },
  { title: 'Weeks',  value: 'weeks'  },
  { title: 'Months', value: 'months' },
  { title: 'Years',  value: 'years'  },
];

const taskForm = ref({
  title: '', description: '', instructions: '',
  categoryId: '', itemId: route.query.item || '',
  priority: 'medium', estimatedDurationMins: '', estimatedCost: '',
  reminderDaysBefore: 0, alert2DaysBefore: null, alertAudience: 'everyone', nextDueDate: '',
  recurrence: { type: 'interval', intervalValue: 3, intervalUnit: 'months', months: [], dayOfMonth: null, dayOfWeek: null },
});

const yearMonth = computed({
  get: () => taskForm.value.recurrence.months?.[0] ?? null,
  set: (v) => { taskForm.value.recurrence.months = v ? [v] : []; },
});

function ordinal(n) {
  if (n == null) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const recurrencePreview = computed(() => {
  const r = taskForm.value.recurrence;
  if (!r.type || r.type === 'one-time') return 'Runs once';
  if (r.type === 'calendar') {
    if (!r.months?.length) return null;
    const monthStr = r.months.map(m => MONTH_NAMES[m - 1]).join(', ');
    const dayStr   = r.dayOfMonth ? ` on the ${ordinal(r.dayOfMonth)}` : '';
    return `Every year in ${monthStr}${dayStr}`;
  }
  if (r.type === 'interval') {
    if (!r.intervalValue || !r.intervalUnit) return null;
    const n    = r.intervalValue;
    const unit = n === 1 ? r.intervalUnit.replace(/s$/, '') : r.intervalUnit;
    let base   = `Every ${n} ${unit}`;
    if (r.intervalUnit === 'weeks' && r.dayOfWeek != null)
      base += ` on ${WEEKDAYS[r.dayOfWeek]}`;
    if (r.intervalUnit === 'months') {
      if (monthlyMode.value === 'weekday' && r.weekOfMonth != null && r.dayOfWeek != null)
        base += ` on the ${WEEK_OF_MONTH_ITEMS.find(w => w.value === r.weekOfMonth)?.title ?? ''} ${WEEKDAYS_FULL[r.dayOfWeek]}`;
      else if (r.dayOfMonth)
        base += ` on the ${ordinal(r.dayOfMonth)}`;
    }
    if (r.intervalUnit === 'years') {
      const month = r.months?.[0];
      const day   = r.dayOfMonth;
      if (month && day) base += ` on ${MONTH_NAMES[month - 1]} ${ordinal(day)}`;
      else if (month)   base += ` in ${MONTH_NAMES[month - 1]}`;
      else if (day)     base += ` on the ${ordinal(day)}`;
    }
    return base;
  }
  return null;
});

async function saveTask() {
  const { valid } = await taskFormRef.value.validate();
  if (!valid) return;
  saving.value   = true;
  taskError.value = '';
  try {
    const payload = { ...taskForm.value };
    if (!payload.categoryId)          delete payload.categoryId;
    if (!payload.itemId)              delete payload.itemId;
    if (!payload.nextDueDate)         delete payload.nextDueDate;
    if (payload.reminderDaysBefore == null) payload.alert2DaysBefore = null;
    if (!payload.estimatedDurationMins) delete payload.estimatedDurationMins;
    if (!payload.estimatedCost)       delete payload.estimatedCost;

    const rec = { ...payload.recurrence };
    const { dayOfWeek, dayOfMonth, weekOfMonth, months } = rec;
    delete rec.dayOfWeek; delete rec.dayOfMonth; delete rec.weekOfMonth;
    rec.months = [];

    if (rec.intervalUnit === 'weeks' && dayOfWeek != null) rec.dayOfWeek = dayOfWeek;
    if (rec.intervalUnit === 'months') {
      if (monthlyMode.value === 'weekday' && weekOfMonth != null && dayOfWeek != null) {
        rec.weekOfMonth = weekOfMonth; rec.dayOfWeek = dayOfWeek;
      } else if (monthlyMode.value === 'day' && dayOfMonth) {
        rec.dayOfMonth = dayOfMonth;
      }
    }
    if (rec.intervalUnit === 'years') {
      if (months?.length) rec.months = months;
      if (dayOfMonth)     rec.dayOfMonth = dayOfMonth;
    }
    if (rec.type === 'calendar') {
      rec.months = months || [];
      if (dayOfMonth) rec.dayOfMonth = dayOfMonth;
    }
    payload.recurrence = rec;

    if (route.query.template) payload.templateId = route.query.template;
    const { data } = await tasksApi.create(payload);
    returnTo(`/tasks/${data._id}`);
  } catch (e) {
    taskError.value = e.response?.data?.error || 'Save failed';
  } finally {
    saving.value = false;
  }
}

// ── CHORE FORM ─────────────────────────────────────────────────────────────────

const choreFormRef   = ref(null);
const choreError     = ref('');
const choreMonthlyMode = ref('day');

const CHORE_ICONS = [
  { value: 'mdi-broom',            label: 'Sweeping' },
  { value: 'mdi-washing-machine',  label: 'Laundry' },
  { value: 'mdi-dishwasher',       label: 'Dishes' },
  { value: 'mdi-trash-can',        label: 'Trash' },
  { value: 'mdi-recycle',          label: 'Recycling' },
  { value: 'mdi-shower',           label: 'Shower / Bathroom' },
  { value: 'mdi-toilet',           label: 'Toilet' },
  { value: 'mdi-flower',           label: 'Plants' },
  { value: 'mdi-leaf',             label: 'Yard Work' },
  { value: 'mdi-grass',            label: 'Mowing' },
  { value: 'mdi-wrench',           label: 'Repairs' },
  { value: 'mdi-window-closed',    label: 'Windows' },
  { value: 'mdi-food-fork-drink',  label: 'Cooking' },
  { value: 'mdi-cart',             label: 'Shopping' },
  { value: 'mdi-car',              label: 'Car Care' },
  { value: 'mdi-dog',              label: 'Pets' },
  { value: 'mdi-bed',              label: 'Bedding' },
  { value: 'mdi-sofa',             label: 'Living Room' },
  { value: 'mdi-fridge',           label: 'Fridge' },
  { value: 'mdi-lightbulb',        label: 'Lightbulbs' },
  { value: 'mdi-water',            label: 'Watering' },
  { value: 'mdi-bucket',           label: 'Mopping' },
  { value: 'mdi-spray',            label: 'Cleaning Spray' },
  { value: 'mdi-vacuum',           label: 'Vacuuming' },
  { value: 'mdi-microwave',        label: 'Microwave' },
  { value: 'mdi-fire',             label: 'Oven / Stove' },
  { value: 'mdi-mailbox-outline',  label: 'Mail & Packages' },
  { value: 'mdi-pill',             label: 'Pharmacy' },
  { value: 'mdi-garage',           label: 'Garage' },
];

const choreForm = ref({
  title: '', instructions: '',
  icon: 'mdi-broom',
  assignedTo: null,
  reminderDaysBefore: 0, alert2DaysBefore: null, alertAudience: 'everyone', nextDueDate: '',
  recurrence: { type: 'interval', intervalValue: 1, intervalUnit: 'weeks', months: [], dayOfMonth: null, dayOfWeek: null },
});

const ALERT_DAY_ITEMS = [
  { value: null, label: 'No alert'        },
  { value: 0,    label: 'On the due date' },
  { value: 1,    label: '1 day before'    },
  { value: 2,    label: '2 days before'   },
  { value: 3,    label: '3 days before'   },
  { value: 7,    label: '1 week before'   },
];

const familyOptions = ref([]);

function buildFamilyOptions(people) {
  const myId = String(auth.user?._id ?? auth.user?.id ?? '');
  return (people || [])
    .filter(p => p.type === 'family')
    .map(p => ({
      value: p._id,
      title: p.accountId && String(p.accountId) === myId ? `${p.name} (You)` : p.name,
    }));
}

const choreRecurrencePreview = computed(() => {
  const r = choreForm.value.recurrence;
  if (!r.type || r.type === 'one-time') return 'Runs once';
  if (r.type === 'calendar') {
    if (!r.months?.length) return null;
    const monthStr = r.months.map(m => MONTH_NAMES[m - 1]).join(', ');
    const dayStr   = r.dayOfMonth ? ` on the ${ordinal(r.dayOfMonth)}` : '';
    return `Every year in ${monthStr}${dayStr}`;
  }
  if (r.type === 'interval') {
    if (!r.intervalValue || !r.intervalUnit) return null;
    const n    = r.intervalValue;
    const unit = n === 1 ? r.intervalUnit.replace(/s$/, '') : r.intervalUnit;
    let base   = `Every ${n} ${unit}`;
    if (r.intervalUnit === 'weeks' && r.dayOfWeek != null)
      base += ` on ${WEEKDAYS[r.dayOfWeek]}`;
    if (r.intervalUnit === 'months') {
      if (choreMonthlyMode.value === 'weekday' && r.weekOfMonth != null && r.dayOfWeek != null)
        base += ` on the ${WEEK_OF_MONTH_ITEMS.find(w => w.value === r.weekOfMonth)?.title ?? ''} ${WEEKDAYS_FULL[r.dayOfWeek]}`;
      else if (r.dayOfMonth)
        base += ` on the ${ordinal(r.dayOfMonth)}`;
    }
    return base;
  }
  return null;
});

async function saveChore() {
  const { valid } = await choreFormRef.value.validate();
  if (!valid) return;
  saving.value    = true;
  choreError.value = '';
  try {
    const payload = { ...choreForm.value };
    if (!payload.nextDueDate) delete payload.nextDueDate;
    payload.assignedTo = payload.assignedTo || null;
    if (payload.reminderDaysBefore == null) payload.alert2DaysBefore = null;

    const rec = { ...payload.recurrence };
    const { dayOfWeek, dayOfMonth, weekOfMonth, months } = rec;
    delete rec.dayOfWeek; delete rec.dayOfMonth; delete rec.weekOfMonth;
    rec.months = [];

    if (rec.intervalUnit === 'weeks' && dayOfWeek != null) rec.dayOfWeek = dayOfWeek;
    if (rec.intervalUnit === 'months') {
      if (choreMonthlyMode.value === 'weekday' && weekOfMonth != null && dayOfWeek != null) {
        rec.weekOfMonth = weekOfMonth; rec.dayOfWeek = dayOfWeek;
      } else if (choreMonthlyMode.value === 'day' && dayOfMonth) {
        rec.dayOfMonth = dayOfMonth;
      }
    }
    if (rec.type === 'calendar') {
      rec.months = months || [];
      if (dayOfMonth) rec.dayOfMonth = dayOfMonth;
    }
    payload.recurrence = rec;

    if (route.query.template) payload.templateId = route.query.template;
    const { data } = await choresApi.create(payload);
    returnTo(`/chores/${data._id}`);
  } catch (e) {
    choreError.value = e.response?.data?.error || 'Save failed';
  } finally {
    saving.value = false;
  }
}

// ── Initialise ─────────────────────────────────────────────────────────────────

onMounted(async () => {
  const [catRes, itemsRes, settingsRes, peopleRes] = await Promise.all([
    categoriesApi.list(),
    itemsApi.list(),
    settingsApi.get(),
    peopleApi.list(),
  ]);
  categories.value    = catRes.data;
  items.value         = itemsRes.data;
  familyOptions.value = buildFamilyOptions(peopleRes.data);
  memberCount.value = settingsRes.data.householdMemberCount ?? 1;
  eventForm.value.fromAddress = settingsRes.data.homeAddress || '';

  if (isEdit.value) {
    loading.value = true;
    try {
      const { data: event } = await calendarApi.getEvent(route.params.eventId);
      const isAllDay = event.allDay !== false;
      const startStr = format(new Date(event.startDate), 'yyyy-MM-dd');
      const endD     = event.endDate ? new Date(event.endDate) : null;
      const endStr   = endD ? format(endD, 'yyyy-MM-dd') : '';
      eventForm.value = {
        title:            event.title,
        calendarType:     event.calendarType,
        date:             startStr,
        endDate:          endStr !== startStr ? endStr : '',
        allDay:           isAllDay,
        startTime:        isAllDay ? '09:00' : format(new Date(event.startDate), 'HH:mm'),
        endTime:          endD && !isAllDay ? format(endD, 'HH:mm') : '10:00',
        description:      event.description ?? '',
        locationRaw:      event.location ?? '',
        phone:            event.phone ?? '',
        url:              event.url ?? '',
        travelMinutes:    event.travelMinutes ?? null,
        travelDistanceKm: event.travelDistanceKm ?? null,
        fromAddress:      eventForm.value.fromAddress,
        reminderMinutes:  event.reminderMinutes ?? null,
        alert2Minutes:    event.alert2Minutes ?? null,
        alertAudience:    event.alertAudience ?? 'everyone',
        recurrFreq:       event.recurrence?.freq ?? '',
        recurrUntil:      event.recurrence?.until ? format(new Date(event.recurrence.until), 'yyyy-MM-dd') : '',
      };
    } finally {
      loading.value = false;
    }
  } else if (route.query.template) {
    const templateId = route.query.template;
    try {
      if (activeTab.value === 'task') {
        const { data: tpl } = await tasksApi.template(templateId);
        taskForm.value.title                = tpl.title || '';
        taskForm.value.description          = tpl.description || '';
        taskForm.value.priority             = tpl.priority || 'medium';
        taskForm.value.estimatedDurationMins = tpl.estimatedDurationMins || '';
        taskForm.value.estimatedCost        = tpl.estimatedCost || '';
        if (tpl.recurrence) {
          taskForm.value.recurrence = {
            type:          tpl.recurrence.type ?? 'interval',
            intervalValue: tpl.recurrence.intervalValue ?? 3,
            intervalUnit:  tpl.recurrence.intervalUnit ?? 'months',
            months:        tpl.recurrence.months ?? [],
            dayOfMonth:    tpl.recurrence.dayOfMonth ?? null,
            dayOfWeek:     tpl.recurrence.dayOfWeek ?? null,
            weekOfMonth:   tpl.recurrence.weekOfMonth ?? null,
          };
          if (tpl.recurrence.type === 'interval' && tpl.recurrence.intervalUnit === 'months') {
            monthlyMode.value = tpl.recurrence.weekOfMonth != null ? 'weekday' : 'day';
          }
        }
      } else if (activeTab.value === 'chore') {
        const { data: tpl } = await choresApi.template(templateId);
        choreForm.value.title        = tpl.title || '';
        choreForm.value.instructions = tpl.description || '';
        choreForm.value.icon         = tpl.icon || 'mdi-broom';
        if (tpl.recurrence) {
          choreForm.value.recurrence = {
            type:          tpl.recurrence.type ?? 'interval',
            intervalValue: tpl.recurrence.intervalValue ?? 1,
            intervalUnit:  tpl.recurrence.intervalUnit ?? 'weeks',
            months:        tpl.recurrence.months ?? [],
            dayOfMonth:    tpl.recurrence.dayOfMonth ?? null,
            dayOfWeek:     tpl.recurrence.dayOfWeek ?? null,
            weekOfMonth:   tpl.recurrence.weekOfMonth ?? null,
          };
          if (tpl.recurrence.type === 'interval' && tpl.recurrence.intervalUnit === 'months') {
            choreMonthlyMode.value = tpl.recurrence.weekOfMonth != null ? 'weekday' : 'day';
          }
        }
      }
    } catch { /* template fetch failed — form stays at defaults */ }
  }
});
</script>

<style scoped>
.form-page {
  min-height: 100vh;
}

.form-header {
  padding: 20px 16px 0;
}

.header-inner {
  max-width: 700px;
  margin: 0 auto;
  display: flex;
  align-items: center;
  position: relative;
}

.form-body {
  max-width: 700px;
  margin: 0 auto;
  padding: 16px 16px 48px;
}

.tab-switcher {
  display: flex;
  gap: 4px;
  padding: 3px;
  background: rgba(var(--v-theme-on-surface), 0.06);
  border-radius: 12px;
  align-self: center;
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
}

.tab-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 3px;
  height: 36px;
  padding: 0 10px;
  border: none;
  border-radius: 9px;
  cursor: pointer;
  background: transparent;
  transition: background 0.18s, color 0.18s;
  color: rgba(var(--v-theme-on-surface), 0.35);
  outline: none;
}

.tab-btn--task {
  padding: 0 11px;
}

.tab-btn--event.tab-btn--active {
  background: rgba(56, 142, 60, 0.10);
}

.tab-btn--task.tab-btn--active {
  background: rgba(25, 118, 210, 0.14);
}

.tab-btn--chore.tab-btn--active {
  background: rgba(245, 124, 0, 0.14);
}

.tab-btn:not(.tab-btn--active):hover {
  background: rgba(var(--v-theme-on-surface), 0.06);
  color: rgba(var(--v-theme-on-surface), 0.6);
}

.icon-picker {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}
.icon-option {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 6px;
  border: 1px solid rgba(var(--v-theme-on-surface), 0.15);
  cursor: pointer;
  transition: border-color 0.15s, background 0.15s;
  color: rgba(var(--v-theme-on-surface), 0.6);
}
.icon-option:hover {
  border-color: #F57C00;
  background: rgba(245, 124, 0, 0.08);
  color: #F57C00;
}
.icon-option--selected {
  border-color: #F57C00;
  background: rgba(245, 124, 0, 0.14);
  color: #F57C00;
}
</style>
