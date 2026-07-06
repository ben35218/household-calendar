<template>
  <v-container class="py-6 px-4">
    <!-- Header -->
    <div class="d-flex align-center mb-6">
      <BackButton size="small" color="primary" />
      <div class="d-flex align-center justify-center flex-grow-1 ga-2">
        <v-btn icon="mdi-chevron-left" variant="tonal" color="primary" @click="router.push(`/calendar/day/${prevDayStr}`)" />
        <div class="text-center">
          <div class="text-caption text-medium-emphasis text-uppercase font-weight-medium">{{ dayOfWeek }}</div>
          <h1 class="text-h5 font-weight-bold">{{ formattedDate }}</h1>
        </div>
        <v-btn icon="mdi-chevron-right" variant="tonal" color="primary" @click="router.push(`/calendar/day/${nextDayStr}`)" />
      </div>
      <div style="width: 36px" />
    </div>

    <!-- Weather for this day -->
    <v-card v-if="dayWeather && !loading" rounded="lg" elevation="1" class="mb-4">
      <v-card-text class="py-3">
        <div class="d-flex align-center ga-3">
          <v-icon :icon="wmoIcon(dayWeather.weatherCode)" size="40" color="blue-darken-1" />
          <div>
            <div class="text-body-1 font-weight-bold">
              {{ Math.round(dayWeather.tempMax) }}° / {{ Math.round(dayWeather.tempMin) }}°
            </div>
            <div class="text-body-2 text-medium-emphasis">{{ dayWeather.description }}</div>
          </div>
          <v-spacer />
          <div class="text-body-2 text-medium-emphasis text-right">
            <div v-if="dayWeather.precipProbability > 0">{{ dayWeather.precipProbability }}% chance of rain</div>
            <div v-if="dayWeather.precipSum > 0" class="text-blue-darken-2 font-weight-medium">{{ dayWeather.precipSum }} mm expected</div>
            <div>Wind: {{ Math.round(dayWeather.windMax) }} km/h</div>
          </div>
        </div>
        <div class="mt-2">
          <v-chip
            v-if="dayWeather.goodWeather"
            color="success"
            size="small"
            prepend-icon="mdi-grass"
          >Good day to mow</v-chip>
          <v-chip
            v-else-if="dayWeather.precipProbability >= 35 || dayWeather.precipSum >= 3"
            color="warning"
            size="small"
            prepend-icon="mdi-water"
          >Wet — skip mowing</v-chip>
        </div>

        <!-- Hourly breakdown -->
        <template v-if="dayHours.length">
          <v-divider class="mt-3 mb-2" />
          <div class="text-caption text-medium-emphasis font-weight-medium text-uppercase mb-2">Hourly</div>
          <div class="d-flex ga-2 overflow-x-auto pb-1">
            <div
              v-for="h in dayHours"
              :key="h.time"
              class="hourly-slot pa-2 rounded text-center flex-shrink-0"
              :class="[
                h.precipitation > 0 ? 'hourly-slot--wet' : 'hourly-slot--dry',
                isNow(h) ? 'hourly-slot--now' : '',
              ]"
            >
              <div class="text-caption font-weight-medium" :class="isNow(h) ? 'text-primary' : 'text-medium-emphasis'">
                {{ isNow(h) ? 'Now' : hourLabel(h.hour) }}
              </div>
              <v-icon :icon="wmoIcon(h.weatherCode)" size="18" class="my-1" color="blue-grey-darken-1" />
              <div class="text-caption font-weight-medium">{{ Math.round(h.temperature) }}°</div>
              <div v-if="h.precipProbability > 0" class="text-caption text-blue-darken-1">
                {{ h.precipProbability }}%
              </div>
              <div v-if="h.precipitation > 0" class="text-caption text-blue-darken-2 font-weight-medium">
                {{ h.precipitation }}mm
              </div>
            </div>
          </div>
        </template>
      </v-card-text>
    </v-card>

    <!-- Loading -->
    <div v-if="loading" class="text-center py-12">
      <v-progress-circular indeterminate color="primary" />
    </div>

    <template v-else>
      <!-- Empty state -->
      <div v-if="allEvents.length === 0" class="text-center py-12">
        <v-icon size="64" color="grey-lighten-1" class="mb-4">mdi-calendar-blank-outline</v-icon>
        <div class="text-h6 text-medium-emphasis">Nothing scheduled</div>
        <div class="text-body-2 text-medium-emphasis mt-1">Tap + to add an event</div>
      </div>

      <template v-else>
        <!-- All-day / multi-day events -->
        <div v-if="allDayEvents.length" class="mb-5">
          <div class="section-label">All day</div>
          <v-card
            v-for="event in allDayEvents"
            :key="event._id"
            rounded="lg"
            class="mb-2 event-card"
            elevation="1"
            @click="handleEventClick(event)"
          >
            <div class="event-bar" :style="{ background: eventColor(event) }" />
            <v-card-text class="py-3 pl-5">
              <div class="d-flex align-center ga-2">
                <v-icon v-if="event._type === 'recipe'" size="16" color="#00897B">mdi-silverware-fork-knife</v-icon>
                <v-icon v-else-if="event._type === 'grocery'" size="16" color="#F9A825">mdi-cart</v-icon>
                <v-icon v-else-if="event._type === 'trip'" size="16" color="#5E35B1">mdi-bag-suitcase</v-icon>
                <span class="font-weight-medium">{{ event.title }}</span>
              </div>
              <div v-if="event._type === 'trip'" class="text-body-2 text-medium-emphasis mt-1">
                <router-link :to="`/vacations/${event._tripId}`" class="text-deep-purple">View itinerary →</router-link>
              </div>
              <div v-if="event._type === 'grocery'" class="text-body-2 text-medium-emphasis mt-1">
                <router-link :to="`/meal-planner?date=${dateStr}`" class="text-amber-darken-2">View grocery list →</router-link>
              </div>
              <div v-if="event._type === 'recipe' && event.recipeId?.description" class="text-body-2 text-medium-emphasis mt-1">{{ event.recipeId.description }}</div>
              <div v-if="event.description && event._type !== 'recipe'" class="text-body-2 text-medium-emphasis mt-1">{{ event.description }}</div>
            </v-card-text>
          </v-card>
        </div>

        <!-- Timed events -->
        <div v-if="timedEvents.length">
          <div class="section-label">Scheduled</div>
          <v-card
            v-for="event in timedEvents"
            :key="event._id"
            rounded="lg"
            class="mb-2 event-card"
            elevation="1"
            @click="handleEventClick(event)"
          >
            <div class="event-bar" :style="{ background: eventColor(event) }" />
            <v-card-text class="py-3 pl-5">
              <div class="d-flex align-start justify-space-between gap-3">
                <div class="font-weight-medium">{{ event.title }}</div>
                <div class="text-caption text-medium-emphasis flex-shrink-0">{{ eventTime(event) }}</div>
              </div>
              <div v-if="event.location" class="text-body-2 text-medium-emphasis mt-1">
                <v-icon size="12" class="mr-1">mdi-map-marker-outline</v-icon>{{ event.location }}
              </div>
              <div v-if="event.description" class="text-body-2 text-medium-emphasis mt-1">{{ event.description }}</div>
            </v-card-text>
          </v-card>
        </div>
      </template>
    </template>
  </v-container>

  <!-- Top-right: add-event -->
  <div class="top-right-fabs">
    <v-btn icon="mdi-plus" variant="tonal" color="primary" :to="`/calendar/event/new?date=${route.params.date}`" />
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { format, parseISO, addDays, subDays } from 'date-fns';
import { loadCalendarData } from '../services/calendarData';
import { loadForecast } from '../services/weather';

const WMO_ICONS = {
  0: 'mdi-weather-sunny', 1: 'mdi-weather-sunny',
  2: 'mdi-weather-partly-cloudy', 3: 'mdi-weather-cloudy',
  45: 'mdi-weather-fog', 48: 'mdi-weather-fog',
  51: 'mdi-weather-rainy', 53: 'mdi-weather-rainy', 55: 'mdi-weather-pouring',
  61: 'mdi-weather-rainy', 63: 'mdi-weather-rainy', 65: 'mdi-weather-pouring',
  71: 'mdi-weather-snowy', 73: 'mdi-weather-snowy', 75: 'mdi-weather-snowy-heavy',
  77: 'mdi-weather-snowy',
  80: 'mdi-weather-rainy', 81: 'mdi-weather-rainy', 82: 'mdi-weather-pouring',
  85: 'mdi-weather-snowy', 86: 'mdi-weather-snowy-heavy',
  95: 'mdi-weather-lightning-rainy', 96: 'mdi-weather-lightning-rainy', 99: 'mdi-weather-lightning-rainy',
};
function wmoIcon(code) { return WMO_ICONS[code] ?? 'mdi-weather-cloudy'; }

function hourLabel(h) {
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

const route  = useRoute();
const router = useRouter();

const dateStr = computed(() => route.params.date);
const loading    = ref(true);
const tasks      = ref([]);
const chores     = ref([]);
const events     = ref([]);
const birthdays  = ref([]);
const recipes    = ref([]);
const grocery    = ref(null);
const trips      = ref([]);
const dayWeather = ref(null);

// Daytime hours (6am–9pm) for the hourly breakdown strip
const dayHours = computed(() =>
  (dayWeather.value?.hours ?? []).filter(h => h.hour >= 6 && h.hour <= 21)
);

const nowHour = new Date().getHours();
const todayStr = new Date().toISOString().slice(0, 10);
function isNow(h) {
  return dateStr.value === todayStr && h.hour === nowHour;
}

const dayOfWeek     = computed(() => format(parseISO(dateStr.value), 'EEEE'));
const formattedDate = computed(() => format(parseISO(dateStr.value), 'MMMM d, yyyy'));

const prevDayStr = computed(() => format(subDays(parseISO(dateStr.value), 1), 'yyyy-MM-dd'));
const nextDayStr = computed(() => format(addDays(parseISO(dateStr.value), 1), 'yyyy-MM-dd'));

async function loadData() {
  loading.value = true;
  try {
    const from = `${dateStr.value}T00:00:00.000Z`;
    const to   = `${dateStr.value}T23:59:59.999Z`;
    const [data] = await Promise.all([
      loadCalendarData({ from, to }),
      loadForecast().then((w) => {
        dayWeather.value = w.forecast?.find(d => d.date === dateStr.value) ?? null;
      }).catch(() => {}),
    ]);
    tasks.value     = data.tasks          ?? [];
    chores.value    = data.chores         ?? [];
    events.value    = data.events         ?? [];
    birthdays.value = data.birthdays      ?? [];
    recipes.value   = data.recipes        ?? [];
    trips.value     = data.trips          ?? [];
    grocery.value   = (data.groceryShopping ?? []).find(g => g.date === dateStr.value) ?? null;
  } finally {
    loading.value = false;
  }
}

const maintenanceItems = computed(() =>
  tasks.value
    .filter(t => t.nextDueDate && new Date(t.nextDueDate).toISOString().slice(0, 10) === dateStr.value)
    .map(t => ({ ...t, _type: 'maintenance', allDay: true }))
);

const choreItems = computed(() =>
  chores.value
    .filter(c => c.nextDueDate && new Date(c.nextDueDate).toISOString().slice(0, 10) === dateStr.value)
    .map(c => ({ ...c, _type: 'chore', allDay: true }))
);

const calendarItems = computed(() =>
  events.value
    .filter(e => {
      const startStr = format(new Date(e.startDate), 'yyyy-MM-dd');
      const endStr   = e.endDate ? format(new Date(e.endDate), 'yyyy-MM-dd') : startStr;
      return dateStr.value >= startStr && dateStr.value <= endStr;
    })
    .map(e => ({ ...e, _type: 'event' }))
);

const birthdayItems = computed(() =>
  birthdays.value
    .filter(b => b.date === dateStr.value)
    .map(b => {
      const age = new Date(b.date).getFullYear() - b.birthYear;
      return { _id: b.id, title: `${b.name}'s Birthday (${age})`, _type: 'birthday', allDay: true, _birthday: b };
    })
);

const groceryItem = computed(() =>
  grocery.value ? [{ _id: `grocery-${dateStr.value}`, title: 'Grocery Shopping', _type: 'grocery', allDay: true, ...grocery.value }] : []
);

const tripItems = computed(() =>
  trips.value
    .filter(t => (t.ranges ?? []).some(r => {
      const s = new Date(r.start).toISOString().slice(0, 10);
      const e = new Date(r.end).toISOString().slice(0, 10);
      return dateStr.value >= s && dateStr.value <= e;
    }))
    .map(t => ({ _id: `trip-${t.id}`, _tripId: t.id, title: t.name, _type: 'trip', allDay: true }))
);

const allEvents = computed(() => [
  ...tripItems.value,
  ...birthdayItems.value,
  ...maintenanceItems.value,
  ...choreItems.value,
  ...recipeItems.value,
  ...groceryItem.value,
  ...calendarItems.value,
]);

const allDayEvents = computed(() =>
  allEvents.value.filter(e =>
    e.allDay || e._type === 'maintenance' || e._type === 'chore' || e._type === 'birthday' || e._type === 'recipe' || e._type === 'grocery' || e._type === 'trip'
  )
);

const timedEvents = computed(() =>
  allEvents.value
    .filter(e => !e.allDay && e._type !== 'maintenance')
    .sort((a, b) => new Date(a.startDate) - new Date(b.startDate))
);

const recipeItems = computed(() =>
  recipes.value
    .filter(s => new Date(s.scheduledDate).toISOString().slice(0, 10) === dateStr.value)
    .map(s => ({ ...s, _type: 'recipe', allDay: true, _id: s._id, title: s.recipeId?.title || 'Recipe' }))
);

const CAL_COLORS = {
  maintenance:  '#1976D2',
  activities:   '#388E3C',
  appointments: '#7B1FA2',
  chores:       '#F57C00',
  recipes:      '#00897B',
  grocery:      '#F9A825',
};

function eventColor(event) {
  if (event._type === 'maintenance') return CAL_COLORS.maintenance;
  if (event._type === 'chore')       return CAL_COLORS.chores;
  if (event._type === 'birthday')    return '#E91E63';
  if (event._type === 'recipe')      return CAL_COLORS.recipes;
  if (event._type === 'grocery')     return CAL_COLORS.grocery;
  if (event._type === 'trip')        return '#5E35B1';
  return CAL_COLORS[event.calendarType] ?? '#9E9E9E';
}

function eventTime(event) {
  return format(new Date(event.startDate), 'h:mm a');
}

function handleEventClick(event) {
  if (event._type === 'birthday')    return;
  if (event._type === 'trip') {
    router.push(`/vacations/${event._tripId}`);
  } else if (event._type === 'maintenance') {
    router.push(`/tasks/${event._id}`);
  } else if (event._type === 'chore') {
    router.push(`/chores/${event._id}`);
  } else if (event._type === 'recipe') {
    router.push(`/recipes/${event.recipeId?._id ?? event.recipeId}`);
  } else if (event._type === 'grocery') {
    router.push(`/meal-planner?date=${dateStr.value}`);
  } else {
    router.push(`/calendar/event/${event._id}`);
  }
}

onMounted(loadData);
watch(dateStr, loadData);
</script>

<style scoped>
.section-label {
  font-size: 0.7rem;
  font-weight: 600;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  color: rgba(var(--v-theme-on-surface),.45);
  margin-bottom: 8px;
}
.event-card {
  cursor: pointer;
  display: flex;
  overflow: hidden;
}
.event-card:hover { opacity: 0.88; }
.event-bar {
  width: 4px;
  flex-shrink: 0;
  align-self: stretch;
}
.top-right-fabs {
  position: fixed;
  top: 16px;
  right: 24px;
  display: flex;
  flex-direction: row;
  gap: 8px;
  align-items: center;
  z-index: 200;
  padding: 8px;
  border-radius: 999px;
}
.top-right-fabs :deep(.v-icon) {
  font-size: 1.4rem !important;
}
.hourly-slot {
  min-width: 52px;
}
.hourly-slot--wet {
  background: rgba(13, 71, 161, 0.06);
  border: 1px solid rgba(13, 71, 161, 0.18);
}
.hourly-slot--dry {
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid rgba(0, 0, 0, 0.06);
}
.hourly-slot--now {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -1px;
}
</style>
