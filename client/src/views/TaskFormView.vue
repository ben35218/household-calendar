<template>
  <v-container class="py-6" max-width="800">
    <div class="d-flex align-center mb-6">
      <BackButton />
      <h1 class="text-h4 font-weight-bold ml-2">{{ isEdit ? 'Edit Task' : 'Add Task' }}</h1>
    </div>

    <v-card rounded="lg" elevation="1">
      <v-card-text class="pa-6">
        <v-form ref="formRef" @submit.prevent="save">
          <v-row>
            <v-col cols="12">
              <v-text-field v-model="form.title" label="Task Title *" variant="outlined" :rules="[v => !!v || 'Title is required']" />
            </v-col>
            <v-col cols="12" sm="6">
              <v-select v-model="form.categoryId" :items="categories.map(c=>({title:c.name,value:c._id}))" label="Category" variant="outlined" clearable />
            </v-col>
            <v-col cols="12" sm="6">
              <v-select
                v-model="form.subcategoryId"
                :items="subcategories.map(s=>({title:s.name,value:s._id}))"
                label="Subcategory"
                variant="outlined"
                clearable
                :disabled="!form.categoryId || !subcategories.length"
                :placeholder="!form.categoryId ? 'Select a category first' : 'None'"
              />
            </v-col>
            <v-col cols="12" sm="6">
              <v-select v-model="form.itemId" :items="[{title:'(No item)',value:''}, ...items.map(i=>({title:i.name,value:i._id}))]" label="Linked Item" variant="outlined" clearable />
            </v-col>
            <v-col cols="12">
              <v-textarea v-model="form.description" label="Description" variant="outlined" rows="2" auto-grow />
            </v-col>
            <v-col cols="12">
              <v-textarea v-model="form.instructions" label="How-to Instructions" variant="outlined" rows="3" auto-grow />
            </v-col>
            <v-col cols="12" sm="4">
              <v-select v-model="form.priority" :items="['low','medium','high']" label="Priority" variant="outlined" />
            </v-col>
            <v-col cols="12" sm="4">
              <v-text-field v-model.number="form.estimatedDurationMins" label="Est. Duration (min)" type="number" variant="outlined" />
            </v-col>
            <v-col cols="12" sm="4">
              <v-text-field v-model.number="form.estimatedCost" label="Est. Cost ($)" type="number" variant="outlined" prefix="$" />
            </v-col>
          </v-row>

          <v-divider class="my-4" />
          <div class="text-subtitle-1 font-weight-medium mb-3">Recurrence</div>
          <v-row>
            <v-col cols="12" sm="4">
              <v-select v-model="form.recurrence.type" :items="recurrenceTypes" label="Type" variant="outlined" />
            </v-col>

            <!-- INTERVAL type -->
            <template v-if="form.recurrence.type === 'interval'">
              <v-col cols="6" sm="4">
                <v-text-field v-model.number="form.recurrence.intervalValue" label="Every" type="number" min="1" variant="outlined" />
              </v-col>
              <v-col cols="6" sm="4">
                <v-select v-model="form.recurrence.intervalUnit" :items="intervalUnits" label="Unit" variant="outlined" />
              </v-col>

              <!-- Weekly anchor: day of week chips -->
              <v-col v-if="form.recurrence.intervalUnit === 'weeks'" cols="12">
                <div class="text-body-2 text-medium-emphasis mb-2">On (optional)</div>
                <v-chip-group v-model="form.recurrence.dayOfWeek" column>
                  <v-chip
                    v-for="(label, i) in WEEKDAYS"
                    :key="i"
                    :value="i"
                    filter
                    variant="outlined"
                    size="small"
                    color="primary"
                  >{{ label }}</v-chip>
                </v-chip-group>
              </v-col>

              <!-- Monthly anchor: specific day OR nth weekday -->
              <template v-if="form.recurrence.intervalUnit === 'months'">
                <v-col cols="12">
                  <div class="text-body-2 text-medium-emphasis mb-2">On (optional)</div>
                  <v-btn-toggle v-model="monthlyMode" variant="outlined" density="compact" color="#1976D2">
                    <v-btn value="day" size="small">Specific day</v-btn>
                    <v-btn value="weekday" size="small">Day of week</v-btn>
                  </v-btn-toggle>
                </v-col>

                <v-col v-if="monthlyMode === 'day'" cols="12" sm="4">
                  <v-text-field
                    v-model.number="form.recurrence.dayOfMonth"
                    label="Day of month"
                    type="number"
                    min="1"
                    max="31"
                    variant="outlined"
                    hint="e.g. 15 = always on the 15th"
                    persistent-hint
                  />
                </v-col>

                <template v-if="monthlyMode === 'weekday'">
                  <v-col cols="12" sm="4">
                    <v-select
                      v-model="form.recurrence.weekOfMonth"
                      :items="WEEK_OF_MONTH_ITEMS"
                      label="Which occurrence"
                      variant="outlined"
                    />
                  </v-col>
                  <v-col cols="12" sm="8">
                    <div class="text-body-2 text-medium-emphasis mb-2">Weekday</div>
                    <v-chip-group v-model="form.recurrence.dayOfWeek" column>
                      <v-chip
                        v-for="(label, i) in WEEKDAYS"
                        :key="i"
                        :value="i"
                        filter
                        variant="outlined"
                        size="small"
                        color="primary"
                      >{{ label }}</v-chip>
                    </v-chip-group>
                  </v-col>
                </template>
              </template>

              <!-- Yearly anchor: month + day -->
              <template v-if="form.recurrence.intervalUnit === 'years'">
                <v-col cols="12" sm="4">
                  <v-select
                    v-model="yearMonth"
                    :items="MONTHS"
                    label="In month (optional)"
                    variant="outlined"
                    clearable
                  />
                </v-col>
                <v-col cols="12" sm="4">
                  <v-text-field
                    v-model.number="form.recurrence.dayOfMonth"
                    label="On day (optional)"
                    type="number"
                    min="1"
                    max="31"
                    variant="outlined"
                  />
                </v-col>
              </template>
            </template>

            <!-- CALENDAR type: pick months + day of month -->
            <template v-if="form.recurrence.type === 'calendar'">
              <v-col cols="12" sm="8">
                <v-select v-model="form.recurrence.months" :items="MONTHS" label="Months" multiple chips closable-chips variant="outlined" />
              </v-col>
              <v-col cols="12" sm="4">
                <v-text-field
                  v-model.number="form.recurrence.dayOfMonth"
                  label="On day of month"
                  type="number"
                  min="1"
                  max="31"
                  variant="outlined"
                  hint="Which day in those months"
                  persistent-hint
                />
              </v-col>
            </template>

            <v-col cols="12" sm="6">
              <v-text-field v-model="form.nextDueDate" label="Next Due Date" type="date" variant="outlined" />
            </v-col>
          </v-row>

          <!-- Live preview of the recurrence description -->
          <v-alert v-if="recurrencePreview" type="info" variant="tonal" density="compact" class="mt-2 mb-2" icon="mdi-repeat">
            {{ recurrencePreview }}
          </v-alert>

          <v-divider class="my-4" />
          <div class="text-subtitle-1 font-weight-medium mb-3">Weather</div>
          <v-row>
            <v-col cols="12">
              <v-switch
                v-model="form.weatherSensitive"
                label="Weather-sensitive (show on mowing/outdoor forecast)"
                color="success"
                hide-details
                inset
              />
            </v-col>
          </v-row>

          <v-divider class="my-4" />
          <div class="text-subtitle-1 font-weight-medium mb-3">Alerts</div>
          <v-row>
            <v-col cols="12" sm="6">
              <v-select v-model="form.reminderDaysBefore" :items="ALERT_DAY_ITEMS" item-title="label" item-value="value" label="Alert" variant="outlined" />
            </v-col>
            <v-col v-if="form.reminderDaysBefore !== null" cols="12" sm="6">
              <v-select v-model="form.alert2DaysBefore" :items="ALERT_DAY_ITEMS" item-title="label" item-value="value" label="Second alert" variant="outlined" />
            </v-col>
            <v-col v-if="memberCount > 1 && form.reminderDaysBefore !== null" cols="12">
              <v-select v-model="form.alertAudience" :items="AUDIENCE_ITEMS" item-title="label" item-value="value" label="Alert who?" variant="outlined" prepend-inner-icon="mdi-account-group" />
            </v-col>
          </v-row>

          <v-alert v-if="error" type="error" class="mt-4" variant="tonal">{{ error }}</v-alert>

          <div class="d-flex justify-end mt-6 ga-3">
            <v-btn @click="goBack">Cancel</v-btn>
            <v-btn type="submit" color="#1976D2" :loading="saving">{{ isEdit ? 'Save Changes' : 'Create Task' }}</v-btn>
          </div>
        </v-form>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { tasksApi, categoriesApi, itemsApi, settingsApi } from '../services/api';
import { sealNew, sealUpdate, openRecord } from '../services/e2ee';

// Content fields encrypted for a task (text/scalars only — refs, dates, and
// recurrence stay plaintext so the server can still schedule + populate them).
const TASK_ENC = (p) => ({
  title: p.title, description: p.description, instructions: p.instructions,
  estimatedCost: p.estimatedCost, estimatedDurationMins: p.estimatedDurationMins,
});
import { useSmartBack, useReturnTo } from '../composables/useSmartBack';

const route = useRoute();
const router = useRouter();
const goBack = useSmartBack();
const returnTo = useReturnTo();
const isEdit = computed(() => !!route.params.id);

const formRef = ref(null);
const categories = ref([]);
const subcategories = ref([]);
const items = ref([]);
const saving = ref(false);
const error = ref('');
const memberCount = ref(1);

const ALERT_DAY_ITEMS = [
  { value: null, label: 'No alert'        },
  { value: 0,    label: 'On the due date' },
  { value: 1,    label: '1 day before'    },
  { value: 2,    label: '2 days before'   },
  { value: 3,    label: '3 days before'   },
  { value: 7,    label: '1 week before'   },
];
const AUDIENCE_ITEMS = [
  { value: 'everyone', label: 'Everyone in the household' },
  { value: 'owner',    label: 'Only me' },
];

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const WEEKDAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const WEEK_OF_MONTH_ITEMS = [
  { title: 'First', value: 1 },
  { title: 'Second', value: 2 },
  { title: 'Third', value: 3 },
  { title: 'Fourth', value: 4 },
  { title: 'Last', value: -1 },
];
const monthlyMode = ref('day');
const MONTHS = [
  { title: 'January', value: 1 }, { title: 'February', value: 2 },
  { title: 'March', value: 3 }, { title: 'April', value: 4 },
  { title: 'May', value: 5 }, { title: 'June', value: 6 },
  { title: 'July', value: 7 }, { title: 'August', value: 8 },
  { title: 'September', value: 9 }, { title: 'October', value: 10 },
  { title: 'November', value: 11 }, { title: 'December', value: 12 },
];
const MONTH_NAMES = MONTHS.map(m => m.title);

const recurrenceTypes = [
  { title: 'Interval (every N days/weeks/months/years)', value: 'interval' },
  { title: 'Calendar (specific months of the year)', value: 'calendar' },
  { title: 'One-time', value: 'one-time' },
];
const intervalUnits = [
  { title: 'Days', value: 'days' },
  { title: 'Weeks', value: 'weeks' },
  { title: 'Months', value: 'months' },
  { title: 'Years', value: 'years' },
];

const form = ref({
  title: '', description: '', instructions: '',
  categoryId: '', subcategoryId: '', itemId: route.query.item || '',
  priority: 'medium', estimatedDurationMins: '', estimatedCost: '',
  reminderDaysBefore: 0, alert2DaysBefore: null, alertAudience: 'everyone',
  nextDueDate: '',
  weatherSensitive: false,
  recurrence: { type: 'interval', intervalValue: 3, intervalUnit: 'months', months: [], dayOfMonth: null, dayOfWeek: null },
});

// For yearly interval, bind the anchor month via the months[0] slot
const yearMonth = computed({
  get: () => form.value.recurrence.months?.[0] ?? null,
  set: (v) => { form.value.recurrence.months = v ? [v] : []; },
});

watch(() => form.value.categoryId, async (catId) => {
  subcategories.value = [];
  form.value.subcategoryId = '';
  if (catId) {
    const { data } = await categoriesApi.list({ parent: catId });
    subcategories.value = data;
  }
});

function ordinal(n) {
  if (n == null) return '';
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const recurrencePreview = computed(() => {
  const r = form.value.recurrence;
  if (!r.type || r.type === 'one-time') return 'Runs once';
  if (r.type === 'calendar') {
    if (!r.months?.length) return null;
    const monthStr = r.months.map(m => MONTH_NAMES[m - 1]).join(', ');
    const dayStr = r.dayOfMonth ? ` on the ${ordinal(r.dayOfMonth)}` : '';
    return `Every year in ${monthStr}${dayStr}`;
  }
  if (r.type === 'interval') {
    if (!r.intervalValue || !r.intervalUnit) return null;
    const n = r.intervalValue;
    const unit = n === 1 ? r.intervalUnit.replace(/s$/, '') : r.intervalUnit;
    let base = `Every ${n} ${unit}`;
    if (r.intervalUnit === 'weeks' && r.dayOfWeek != null) {
      base += ` on ${WEEKDAYS[r.dayOfWeek]}`;
    }
    if (r.intervalUnit === 'months') {
      if (monthlyMode.value === 'weekday' && r.weekOfMonth != null && r.dayOfWeek != null) {
        const pos = WEEK_OF_MONTH_ITEMS.find(w => w.value === r.weekOfMonth)?.title ?? '';
        base += ` on the ${pos} ${WEEKDAYS_FULL[r.dayOfWeek]}`;
      } else if (r.dayOfMonth) {
        base += ` on the ${ordinal(r.dayOfMonth)}`;
      }
    }
    if (r.intervalUnit === 'years') {
      const month = r.months?.[0];
      const day = r.dayOfMonth;
      if (month && day) base += ` on ${MONTH_NAMES[month - 1]} ${ordinal(day)}`;
      else if (month) base += ` in ${MONTH_NAMES[month - 1]}`;
      else if (day) base += ` on the ${ordinal(day)}`;
    }
    return base;
  }
  return null;
});

async function save() {
  const { valid } = await formRef.value.validate();
  if (!valid) return;
  saving.value = true;
  error.value = '';
  try {
    const payload = { ...form.value };
    if (!payload.categoryId)    delete payload.categoryId;
    if (!payload.subcategoryId) delete payload.subcategoryId;
    if (!payload.itemId) delete payload.itemId;
    if (!payload.nextDueDate) delete payload.nextDueDate;
    if (payload.reminderDaysBefore == null) payload.alert2DaysBefore = null;
    if (!payload.estimatedDurationMins) delete payload.estimatedDurationMins;
    if (!payload.estimatedCost) delete payload.estimatedCost;

    // Rebuild anchor fields — only keep what's relevant to the current unit/mode
    const rec = { ...payload.recurrence };
    const { dayOfWeek, dayOfMonth, weekOfMonth, months } = rec;
    delete rec.dayOfWeek; delete rec.dayOfMonth; delete rec.weekOfMonth;
    rec.months = [];

    if (rec.intervalUnit === 'weeks' && dayOfWeek != null) {
      rec.dayOfWeek = dayOfWeek;
    }
    if (rec.intervalUnit === 'months') {
      if (monthlyMode.value === 'weekday' && weekOfMonth != null && dayOfWeek != null) {
        rec.weekOfMonth = weekOfMonth;
        rec.dayOfWeek = dayOfWeek;
      } else if (monthlyMode.value === 'day' && dayOfMonth) {
        rec.dayOfMonth = dayOfMonth;
      }
    }
    if (rec.intervalUnit === 'years') {
      if (months?.length) rec.months = months;
      if (dayOfMonth) rec.dayOfMonth = dayOfMonth;
    }
    if (rec.type === 'calendar') {
      rec.months = months || [];
      if (dayOfMonth) rec.dayOfMonth = dayOfMonth;
    }
    payload.recurrence = rec;

    if (isEdit.value) {
      await tasksApi.update(route.params.id, await sealUpdate('MaintenanceTask', route.params.id, payload, TASK_ENC(payload)));
      returnTo(`/tasks/${route.params.id}`);
    } else {
      const { data } = await tasksApi.create(await sealNew('MaintenanceTask', payload, TASK_ENC(payload)));
      returnTo(`/tasks/${data._id}`);
    }
  } catch (e) {
    error.value = e.response?.data?.error || 'Save failed';
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  const [catRes, itemsRes, settingsRes] = await Promise.all([categoriesApi.list({ topLevel: true }), itemsApi.list(), settingsApi.get()]);
  categories.value = catRes.data;
  items.value = itemsRes.data;
  memberCount.value = settingsRes.data.householdMemberCount ?? 1;
  if (isEdit.value) {
    const { data: raw } = await tasksApi.get(route.params.id);
    const data = await openRecord('MaintenanceTask', raw); // decrypt content over plaintext
    const rec = {
      type: 'interval', intervalValue: 3, intervalUnit: 'months',
      months: [], dayOfMonth: null, dayOfWeek: null, weekOfMonth: null,
      ...(data.recurrence || {}),
    };
    const savedSubcategoryId = data.subcategoryId?._id || '';
    Object.assign(form.value, {
      ...data,
      categoryId:    data.categoryId?._id    || '',
      subcategoryId: savedSubcategoryId,
      itemId: data.itemId?._id || '',
      nextDueDate: data.nextDueDate ? data.nextDueDate.slice(0, 10) : '',
      reminderDaysBefore: data.reminderDaysBefore ?? 0,
      alert2DaysBefore: data.alert2DaysBefore ?? null,
      alertAudience: data.alertAudience ?? 'everyone',
      weatherSensitive: data.weatherSensitive ?? false,
      recurrence: rec,
    });
    // The categoryId watcher fires async and clears subcategoryId — fetch subs
    // then restore the saved value after the watcher's synchronous clear has run.
    if (data.categoryId?._id) {
      const { data: subs } = await categoriesApi.list({ parent: data.categoryId._id });
      subcategories.value = subs;
    }
    form.value.subcategoryId = savedSubcategoryId;
    // Restore monthly mode from saved data
    if (rec.intervalUnit === 'months' && rec.weekOfMonth != null) {
      monthlyMode.value = 'weekday';
    }
  }
});
</script>
