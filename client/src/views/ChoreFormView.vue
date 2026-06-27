<template>
  <v-container class="py-6" max-width="800">
    <div class="d-flex align-center mb-6">
      <BackButton />
      <h1 class="text-h4 font-weight-bold ml-2">Edit Chore</h1>
    </div>

    <v-card rounded="lg" elevation="1">
      <v-card-text class="pa-6">
        <v-form ref="formRef" @submit.prevent="save">
          <v-row>
            <v-col cols="12">
              <v-text-field v-model="form.title" label="Chore Title *" variant="outlined" :rules="[v => !!v || 'Title is required']" />
            </v-col>
            <v-col cols="12">
              <v-textarea v-model="form.instructions" label="Instructions" variant="outlined" rows="2" auto-grow />
            </v-col>
            <v-col cols="12">
              <v-select
                v-model="form.assignedTo"
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
                  :class="{ 'icon-option--selected': form.icon === opt.value }"
                  :title="opt.label"
                  @click="form.icon = opt.value"
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
              <v-select v-model="form.recurrence.type" :items="recurrenceTypes" label="Type" variant="outlined" />
            </v-col>

            <template v-if="form.recurrence.type === 'interval'">
              <v-col cols="6" sm="4">
                <v-text-field v-model.number="form.recurrence.intervalValue" label="Every" type="number" min="1" variant="outlined" />
              </v-col>
              <v-col cols="6" sm="4">
                <v-select v-model="form.recurrence.intervalUnit" :items="intervalUnits" label="Unit" variant="outlined" />
              </v-col>

              <v-col v-if="form.recurrence.intervalUnit === 'weeks'" cols="12">
                <div class="text-body-2 text-medium-emphasis mb-2">On (optional)</div>
                <v-chip-group v-model="form.recurrence.dayOfWeek" column>
                  <v-chip v-for="(label, i) in WEEKDAYS" :key="i" :value="i" filter variant="outlined" size="small" color="primary">{{ label }}</v-chip>
                </v-chip-group>
              </v-col>

              <template v-if="form.recurrence.intervalUnit === 'months'">
                <v-col cols="12">
                  <div class="text-body-2 text-medium-emphasis mb-2">On (optional)</div>
                  <v-btn-toggle v-model="monthlyMode" variant="outlined" density="compact" color="#F57C00">
                    <v-btn value="day" size="small">Specific day</v-btn>
                    <v-btn value="weekday" size="small">Day of week</v-btn>
                  </v-btn-toggle>
                </v-col>
                <v-col v-if="monthlyMode === 'day'" cols="12" sm="4">
                  <v-text-field v-model.number="form.recurrence.dayOfMonth" label="Day of month" type="number" min="1" max="31" variant="outlined" hint="e.g. 15 = always on the 15th" persistent-hint />
                </v-col>
                <template v-if="monthlyMode === 'weekday'">
                  <v-col cols="12" sm="4">
                    <v-select v-model="form.recurrence.weekOfMonth" :items="WEEK_OF_MONTH_ITEMS" label="Which occurrence" variant="outlined" />
                  </v-col>
                  <v-col cols="12" sm="8">
                    <div class="text-body-2 text-medium-emphasis mb-2">Weekday</div>
                    <v-chip-group v-model="form.recurrence.dayOfWeek" column>
                      <v-chip v-for="(label, i) in WEEKDAYS" :key="i" :value="i" filter variant="outlined" size="small" color="primary">{{ label }}</v-chip>
                    </v-chip-group>
                  </v-col>
                </template>
              </template>
            </template>

            <template v-if="form.recurrence.type === 'calendar'">
              <v-col cols="12" sm="8">
                <v-select v-model="form.recurrence.months" :items="MONTHS" label="Months" multiple chips closable-chips variant="outlined" />
              </v-col>
              <v-col cols="12" sm="4">
                <v-text-field v-model.number="form.recurrence.dayOfMonth" label="On day of month" type="number" min="1" max="31" variant="outlined" hint="Which day in those months" persistent-hint />
              </v-col>
            </template>

            <v-col cols="12" sm="6">
              <v-text-field v-model="form.nextDueDate" label="Next Due Date" type="date" variant="outlined" />
            </v-col>
          </v-row>

          <v-alert v-if="recurrencePreview" type="info" variant="tonal" density="compact" class="mt-2 mb-2" icon="mdi-repeat">
            {{ recurrencePreview }}
          </v-alert>

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
            <v-btn type="submit" color="#F57C00" :loading="saving">Save Changes</v-btn>
          </div>
        </v-form>
      </v-card-text>
    </v-card>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { choresApi, peopleApi, settingsApi } from '../services/api';
import { useSmartBack, useReturnTo } from '../composables/useSmartBack';
import { useAuthStore } from '../stores/auth';

const route  = useRoute();
const router = useRouter();
const goBack = useSmartBack();
const returnTo = useReturnTo();
const auth   = useAuthStore();

const formRef  = ref(null);
const saving   = ref(false);
const error    = ref('');
const monthlyMode    = ref('day');
const familyOptions  = ref([]);
const memberCount    = ref(1);

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

const recurrenceTypes = [
  { title: 'Interval (every N days/weeks/months/years)', value: 'interval' },
  { title: 'Calendar (specific months of the year)',     value: 'calendar' },
  { title: 'One-time',                                   value: 'one-time' },
];
const intervalUnits = [
  { title: 'Days',   value: 'days'   },
  { title: 'Weeks',  value: 'weeks'  },
  { title: 'Months', value: 'months' },
  { title: 'Years',  value: 'years'  },
];

const form = ref({
  title: '', instructions: '',
  icon: 'mdi-broom',
  assignedTo: null,
  reminderDaysBefore: 0, alert2DaysBefore: null, alertAudience: 'everyone', nextDueDate: '',
  recurrence: { type: 'interval', intervalValue: 1, intervalUnit: 'weeks', months: [], dayOfMonth: null, dayOfWeek: null },
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
    return `Every year in ${r.months.map(m => MONTH_NAMES[m - 1]).join(', ')}${r.dayOfMonth ? ` on the ${ordinal(r.dayOfMonth)}` : ''}`;
  }
  if (r.type === 'interval') {
    if (!r.intervalValue || !r.intervalUnit) return null;
    const n    = r.intervalValue;
    const unit = n === 1 ? r.intervalUnit.replace(/s$/, '') : r.intervalUnit;
    let base   = `Every ${n} ${unit}`;
    if (r.intervalUnit === 'weeks' && r.dayOfWeek != null) base += ` on ${WEEKDAYS[r.dayOfWeek]}`;
    if (r.intervalUnit === 'months') {
      if (monthlyMode.value === 'weekday' && r.weekOfMonth != null && r.dayOfWeek != null)
        base += ` on the ${WEEK_OF_MONTH_ITEMS.find(w => w.value === r.weekOfMonth)?.title ?? ''} ${WEEKDAYS_FULL[r.dayOfWeek]}`;
      else if (r.dayOfMonth)
        base += ` on the ${ordinal(r.dayOfMonth)}`;
    }
    return base;
  }
  return null;
});

async function save() {
  const { valid } = await formRef.value.validate();
  if (!valid) return;
  saving.value = true;
  error.value  = '';
  try {
    const payload = { ...form.value };
    if (!payload.nextDueDate) delete payload.nextDueDate;
    payload.assignedTo = payload.assignedTo || null;
    if (payload.reminderDaysBefore == null) payload.alert2DaysBefore = null;

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
    if (rec.type === 'calendar') {
      rec.months = months || [];
      if (dayOfMonth) rec.dayOfMonth = dayOfMonth;
    }
    payload.recurrence = rec;

    await choresApi.update(route.params.id, payload);
    returnTo(`/chores/${route.params.id}`);
  } catch (e) {
    error.value = e.response?.data?.error || 'Save failed';
  } finally {
    saving.value = false;
  }
}

onMounted(async () => {
  const [choreRes, peopleRes, settingsRes] = await Promise.all([
    choresApi.get(route.params.id),
    peopleApi.list(),
    settingsApi.get(),
  ]);
  familyOptions.value = buildFamilyOptions(peopleRes.data);
  memberCount.value = settingsRes.data.householdMemberCount ?? 1;
  const data = choreRes.data;
  const rec = {
    type: 'interval', intervalValue: 1, intervalUnit: 'weeks',
    months: [], dayOfMonth: null, dayOfWeek: null, weekOfMonth: null,
    ...(data.recurrence || {}),
  };
  Object.assign(form.value, {
    ...data,
    icon: data.icon || 'mdi-broom',
    instructions: data.instructions ?? data.description ?? '',
    assignedTo: data.assignedTo?._id ?? data.assignedTo ?? null,
    nextDueDate: data.nextDueDate ? data.nextDueDate.slice(0, 10) : '',
    reminderDaysBefore: data.reminderDaysBefore ?? 0,
    alert2DaysBefore: data.alert2DaysBefore ?? null,
    alertAudience: data.alertAudience ?? 'everyone',
    recurrence: rec,
  });
  if (rec.intervalUnit === 'months' && rec.weekOfMonth != null) {
    monthlyMode.value = 'weekday';
  }
});

function buildFamilyOptions(people) {
  const myId = String(auth.user?._id ?? auth.user?.id ?? '');
  return (people || [])
    .filter(p => p.type === 'family')
    .map(p => ({
      value: p._id,
      title: p.accountId && String(p.accountId) === myId ? `${p.name} (You)` : p.name,
    }));
}
</script>

<style scoped>
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
