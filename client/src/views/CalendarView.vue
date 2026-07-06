<template>
  <v-container class="py-6 px-0 px-sm-4">
    <!-- Page header -->
    <div class="mb-4 px-4 px-sm-0">
      <h1 class="text-h4 font-weight-bold">Calendar</h1>
    </div>

    <v-progress-linear v-if="filters.filterLoading" indeterminate color="primary" class="mb-4" />

    <!-- Scrollable multi-month view -->
    <div
      v-for="m in renderedMonths"
      :key="m.key"
      :data-month-key="m.key"
      class="month-block"
    >
      <div class="month-label px-4 px-sm-0 py-2">{{ m.label }}</div>
      <div class="calendar-grid">
        <div v-for="d in dayNames" :key="d" class="day-header">{{ d }}</div>
        <div
          v-for="day in m.days"
          :key="day.date"
          class="day-cell"
          :data-date="day.date"
          :class="{ 'other-month': !day.currentMonth, 'today': day.isToday, 'last-viewed': day.date === lastInteractedDate && !day.isToday }"
          @click="navigateTo(day.date, `/calendar/day/${day.date}`)"
        >
          <div class="day-top-row">
            <div v-if="day.currentMonth" class="day-number">{{ day.day }}</div>
            <div v-if="day.weather && day.currentMonth" class="day-weather-inline">
              <v-icon
                :icon="wmoIcon(day.weather.weatherCode)"
                size="14"
                :color="day.weather.goodWeather ? 'success' : 'blue'"
              />
              <span class="weather-temp">{{ Math.round(day.weather.tempMax) }}°</span>
              <span v-if="day.weather.precipSum > 0" class="weather-rain">{{ day.weather.precipSum }}mm</span>
            </div>
          </div>
          <div class="day-events">
            <div
              v-for="trip in day.trips"
              :key="`trip_${trip.id}`"
              class="trip-bar"
              :class="{ 'trip-bar--first': trip._isFirst, 'trip-bar--last': trip._isLast, 'trip-bar--considering': trip.status === 'considering' }"
              :style="{ '--trip-color': trip.color }"
              :title="trip.name"
              @click.stop="navigateTo(day.date, `/vacations/${trip.id}`)"
            >
              <v-icon v-if="trip._isFirst" size="9" class="mr-1 flex-shrink-0">mdi-bag-suitcase</v-icon>
              <span v-if="trip._isFirst" class="chip-title">{{ trip.name }}</span>
            </div>
            <template v-for="event in day.events.slice(0, 1)" :key="`${event._id}_${event._instanceDate ?? ''}`">
              <v-chip
                v-if="event.calendarId === 'birthdays'"
                color="#E91E63"
                size="x-small"
                label
                class="mb-1 task-chip"
                @click.stop
              >
                <v-icon size="9" class="mr-1 flex-shrink-0">mdi-cake-variant</v-icon>
                <span class="chip-title">{{ event.title }}</span>
              </v-chip>
              <v-chip
                v-else-if="event.calendarId === 'canadian-holidays'"
                color="#D32F2F"
                size="x-small"
                label
                class="mb-1 task-chip"
                @click.stop
              >
                <span class="chip-title">{{ event.title }}</span>
              </v-chip>
              <v-chip
                v-else-if="event.calendarId === 'maintenance'"
                :color="eventColor(event)"
                size="x-small"
                label
                class="mb-1 task-chip"
                :to="event._link"
                @click.stop="navigateTo(day.date, event._link)"
              >
                <span class="chip-title">{{ event.title }}</span>
              </v-chip>
              <v-chip
                v-else
                :color="eventColor(event)"
                size="x-small"
                label
                class="mb-1 task-chip editable-chip"
                :class="{ 'multi-day-mid': event._isMultiDay && !event._isFirst }"
                @click.stop="navigateTo(day.date, `/calendar/event/${event._id}`)"
              >
                <v-icon v-if="!event.allDay && event._isFirst" size="8" class="mr-1 flex-shrink-0">mdi-clock-outline</v-icon>
                <span v-if="event._isMultiDay && !event._isFirst" class="event-continuation mr-1">↦</span>
                <span class="chip-title">{{ event.title }}</span>
                <v-icon v-if="event.recurrence?.freq" size="8" class="ml-1 flex-shrink-0">mdi-repeat</v-icon>
                <v-icon v-if="event._isMultiDay && !event._isLast" size="8" class="ml-1 flex-shrink-0">mdi-chevron-right</v-icon>
              </v-chip>
            </template>
            <div v-if="day.events.length > 1" class="overflow-count">
              +{{ day.events.length - 1 }} more
            </div>
          </div>
          <div class="day-chore-icons">
            <span
              v-for="task in day.tasks.slice(0, 3)"
              :key="`task_${task._id}_${task._instanceDate ?? ''}`"
              class="chore-icon-wrapper"
              :title="task.title"
              @click.stop="navigateTo(day.date, task._link)"
            >
              <v-icon size="12" :color="taskPriorityColor(task.priority)">{{ task.categoryId?.icon || 'mdi-wrench' }}</v-icon>
            </span>
            <span
              v-for="chore in day.chores.slice(0, 3)"
              :key="`chore_${chore._id}_${chore._instanceDate ?? ''}`"
              class="chore-icon-wrapper"
              :title="chore.title"
              @click.stop="navigateTo(day.date, chore._link)"
            >
              <v-icon size="12" color="#F57C00">{{ chore.icon || 'mdi-broom' }}</v-icon>
            </span>
            <span
              v-for="recipe in day.recipes.slice(0, 3)"
              :key="`recipe_${recipe._id}`"
              class="chore-icon-wrapper recipe-icon-wrapper"
              :title="recipe.recipeId?.title || 'Recipe'"
              @click.stop="navigateTo(day.date, recipe.recipeId?._id ? `/recipes/${recipe.recipeId._id}` : `/meal-planner?date=${day.date}`)"
            >
              <v-icon size="12" color="#00897B">mdi-silverware-fork-knife</v-icon>
            </span>
            <span
              v-if="day.grocery"
              class="chore-icon-wrapper grocery-icon-wrapper"
              title="Grocery Shopping"
              @click.stop="navigateTo(day.date, `/meal-planner?date=${day.date}`)"
            >
              <v-icon size="12" color="#F9A825">mdi-cart</v-icon>
            </span>
          </div>
        </div>
      </div>
    </div>
  </v-container>

  <!-- ── Top-right: chat + add-event ──────────────────────────────────────── -->
  <div class="top-right-fabs">
    <v-btn icon="mdi-format-list-bulleted" variant="text" color="primary" to="/events" />
    <v-btn icon="mdi-chat" variant="text" color="primary" to="/calendar/assistant" />
    <v-btn icon="mdi-plus" variant="text" color="primary" to="/calendar/event/new" />
  </div>

  <!-- ── Bottom-center: filter + calendar config ──────────────────────────── -->
  <div class="bottom-center-fabs">
    <CalendarFilterMenu :filters="filters" />
    <v-btn icon="mdi-calendar-multiple" variant="text" color="primary" to="/calendars" />
  </div>

  <!-- ── Bottom-left: today ────────────────────────────────────────────────── -->
  <div class="bottom-left-fab">
    <v-btn variant="text" color="primary" class="today-fab" @click="goToday">
      Today
    </v-btn>
  </div>

</template>

<script setup>
import { ref, computed, reactive, onMounted, onUnmounted, watch, nextTick } from 'vue';
import { useHolidayPrefs } from '../composables/useHolidayPrefs';
import { useRouter, onBeforeRouteLeave } from 'vue-router';
import {
  startOfMonth, endOfMonth, startOfWeek, endOfWeek,
  eachDayOfInterval, format, isSameMonth, isToday,
  isBefore, addDays, addMonths,
} from 'date-fns';
import { calendarApi, weatherApi } from '../services/api';
import { loadCalendarData } from '../services/calendarData';
import { useCalendarFilters } from '../composables/useCalendarFilters';
import CalendarFilterMenu from '../components/CalendarFilterMenu.vue';
import { getCanadianHolidays } from '../utils/canadianHolidays';

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

const router = useRouter();

const STORAGE_KEY = 'hc_calendar_visibility';

const tasks           = ref([]);
const chores          = ref([]);
const calendarEvents  = ref([]);
const birthdays       = ref([]);  // { id, name, relationship, date, birthYear }[]
const weatherByDate   = ref({});  // { 'yyyy-MM-dd': forecastDay }
const recipeSchedules = ref([]);  // scheduled recipes from API
const groceryShopping = ref([]);  // { id, date, weekStart }[]
const trips           = ref([]);  // { id, name, color, status, ranges: [{start,end,label}] }[]

const { enabledHolidays, enabledIdsList } = useHolidayPrefs();

// Reactive — recomputes when the date range or enabled holiday set changes
const holidays = computed(() => {
  if (!renderedMonthDates.value.length) return [];
  const from = startOfWeek(startOfMonth(renderedMonthDates.value[0]));
  const to   = endOfWeek(endOfMonth(renderedMonthDates.value.at(-1)));
  return getCanadianHolidays(from, to, enabledIdsList());
});

const dayNames = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const calendars = ref([
  { id: 'maintenance',        name: 'Maintenance',        color: '#1976D2', visible: true },
  { id: 'activities',         name: 'Activities',         color: '#388E3C', visible: true },
  { id: 'appointments',       name: 'Appointments',       color: '#7B1FA2', visible: true },
  { id: 'chores',             name: 'Chores',             color: '#F57C00', visible: true },
  { id: 'recipes',            name: 'Meals',              color: '#00897B', visible: true },
  { id: 'vacations',          name: 'Vacations',          color: '#5E35B1', visible: true },
  { id: 'birthdays',          name: 'Birthdays',          color: '#E91E63', visible: true },
  { id: 'canadian-holidays',  name: 'Holidays',  color: '#D32F2F', visible: true },
  { id: 'weather',            name: 'Weather',            color: '#0288D1', visible: true },
]);

const filters = reactive(useCalendarFilters());

function loadVisibility() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    if (!('canadian-holidays' in saved)) {
      calendars.value.forEach(cal => { cal.visible = true; });
      return;
    }
    calendars.value.forEach(cal => { if (cal.id in saved) cal.visible = saved[cal.id]; });
  } catch {}
}
function saveVisibility() {
  const existing = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
  const vis = { ...existing, ...Object.fromEntries(calendars.value.map(c => [c.id, c.visible])) };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(vis));
}
watch(() => calendars.value.map(c => c.visible), saveVisibility, { deep: true });

function calendarColor(calId) {
  return calendars.value.find(c => c.id === calId)?.color ?? '#999';
}

function taskPriorityColor(priority) {
  return { high: '#D32F2F', medium: '#F57C00', low: '#388E3C' }[priority] ?? '#9E9E9E';
}

function eventColor(event) {
  if (event.calendarId === 'chores')            return '#F57C00';
  if (event.calendarId === 'canadian-holidays') return '#D32F2F';
  if (event.calendarId !== 'maintenance')       return undefined;
  if (event.isCompletion) return 'success';
  const due = event.nextDueDate ? new Date(event.nextDueDate) : null;
  if (!due) return 'success';
  const today = new Date();
  if (isBefore(due, today)) return 'error';
  if (isBefore(due, addDays(today, 7))) return 'warning';
  return 'success';
}

function formatEventTime(event) {
  return format(new Date(event.startDate), 'h:mm a');
}

// ── Day computation ────────────────────────────────────────────────────────────
function computeDaysForMonth(monthDate) {
  const start = startOfWeek(startOfMonth(monthDate));
  const end   = endOfWeek(endOfMonth(monthDate));
  const visibleIds = new Set(calendars.value.filter(c => c.visible).map(c => c.id));

  const todayStr = format(new Date(), 'yyyy-MM-dd');

  return eachDayOfInterval({ start, end }).map(date => {
    const dateStr = format(date, 'yyyy-MM-dd');
    const currentMonth = isSameMonth(date, monthDate);

    // Don't render events on overflow days — they belong to the adjacent month's grid.
    if (!currentMonth) {
      return { date: dateStr, day: date.getDate(), currentMonth: false, isToday: isToday(date), events: [], chores: [], tasks: [], recipes: [], grocery: null, trips: [] };
    }

    if (filters.timeFilter === 'upcoming' && dateStr < todayStr) {
      return { date: dateStr, day: date.getDate(), currentMonth: true, isToday: isToday(date), events: [], chores: [], tasks: [], recipes: [], grocery: null, trips: [] };
    }
    if (filters.timeFilter === 'past' && dateStr >= todayStr) {
      return { date: dateStr, day: date.getDate(), currentMonth: true, isToday: isToday(date), events: [], chores: [], tasks: [], recipes: [], grocery: null, trips: [] };
    }

    const exclusiveMode = filters.showPaused || filters.showCompleted;
    const allMaintenanceTasks = [...tasks.value, ...filters.pausedTasks];
    const maintenanceEvents = visibleIds.has('maintenance')
      ? allMaintenanceTasks
          .filter(t => {
            if (!t.nextDueDate) return false;
            if (new Date(t.nextDueDate).toISOString().slice(0, 10) !== dateStr) return false;
            if (t.active === false) {
              if (!filters.showPaused) return false;
            } else {
              if (exclusiveMode) return false;
            }
            if (filters.categoryFilter.length) {
              const catId = t.categoryId?._id ?? t.categoryId ?? null;
              if (!filters.categoryFilter.includes(catId)) return false;
            }
            if (filters.itemFilter.length) {
              const itmId = t.itemId?._id ?? t.itemId ?? null;
              if (!filters.itemFilter.includes(itmId)) return false;
            }
            return true;
          })
          .map(t => ({ ...t, calendarId: 'maintenance', _link: `/tasks/${t._id}` }))
      : [];

    const completionEvents = filters.showCompleted && visibleIds.has('maintenance')
      ? filters.rawCompletions
          .filter(c => {
            if (!c.completedDate) return false;
            if (new Date(c.completedDate).toISOString().slice(0, 10) !== dateStr) return false;
            if (filters.categoryFilter.length) {
              const catId = c.taskId?.categoryId?._id ?? c.taskId?.categoryId ?? null;
              if (!filters.categoryFilter.includes(catId)) return false;
            }
            if (filters.itemFilter.length) {
              const itmId = c.taskId?.itemId ?? null;
              if (!filters.itemFilter.includes(itmId)) return false;
            }
            return true;
          })
          .map(c => ({
            _id:          c._id,
            title:        c.taskId?.title ?? 'Completed Task',
            calendarId:   'maintenance',
            isCompletion: true,
            _link:        c.taskId?._id ? `/tasks/${c.taskId._id}` : null,
          }))
      : [];

    const holidayEvents = visibleIds.has('canadian-holidays')
      ? holidays.value
          .filter(h => h.date === dateStr)
          .map(h => ({ _id: `holiday-${h.date}-${h.name}`, title: h.name, calendarId: 'canadian-holidays', allDay: true }))
      : [];

    const birthdayEventsForDay = visibleIds.has('birthdays')
      ? birthdays.value
          .filter(b => b.date === dateStr)
          .map(b => {
            const age = new Date(dateStr).getFullYear() - b.birthYear;
            return { _id: b.id, title: `${b.name} (${age})`, calendarId: 'birthdays', allDay: true, _birthday: b };
          })
      : [];

    const choreEvents = !exclusiveMode && visibleIds.has('chores')
      ? chores.value
          .filter(c => {
            if (!c.nextDueDate) return false;
            return new Date(c.nextDueDate).toISOString().slice(0, 10) === dateStr;
          })
          .map(c => ({ ...c, calendarId: 'chores', _link: `/chores/${c._id}` }))
      : [];

    const recipeEvents = !exclusiveMode && visibleIds.has('recipes')
      ? recipeSchedules.value.filter(s =>
          new Date(s.scheduledDate).toISOString().slice(0, 10) === dateStr
        )
      : [];

    const groceryEvent = !exclusiveMode && visibleIds.has('recipes')
      ? groceryShopping.value.find(g => g.date === dateStr) ?? null
      : null;

    const extraEvents = exclusiveMode ? [] : calendarEvents.value
      .filter(e => {
        if (!visibleIds.has(e.calendarType)) return false;
        const startStr = format(new Date(e.startDate), 'yyyy-MM-dd');
        const endStr   = e.endDate ? format(new Date(e.endDate), 'yyyy-MM-dd') : startStr;
        return dateStr >= startStr && dateStr <= endStr;
      })
      .map(e => {
        const startStr   = format(new Date(e.startDate), 'yyyy-MM-dd');
        const endStr     = e.endDate ? format(new Date(e.endDate), 'yyyy-MM-dd') : startStr;
        const isMultiDay = startStr !== endStr;
        return {
          ...e,
          calendarId:  e.calendarType,
          _isMultiDay: isMultiDay,
          _isFirst:    dateStr === startStr,
          _isLast:     dateStr === endStr,
        };
      });

    const tripBars = !exclusiveMode && visibleIds.has('vacations')
      ? trips.value.flatMap(t =>
          (t.ranges ?? [])
            .filter(r => {
              const startStr = format(new Date(r.start), 'yyyy-MM-dd');
              const endStr   = format(new Date(r.end), 'yyyy-MM-dd');
              return dateStr >= startStr && dateStr <= endStr;
            })
            .map(r => {
              const startStr = format(new Date(r.start), 'yyyy-MM-dd');
              const endStr   = format(new Date(r.end), 'yyyy-MM-dd');
              return {
                id: t.id, name: t.name, color: t.color || '#5E35B1', status: t.status,
                _isFirst: dateStr === startStr, _isLast: dateStr === endStr,
              };
            })
        )
      : [];

    return {
      date: dateStr,
      day:  date.getDate(),
      currentMonth: true,
      isToday: isToday(date),
      events:  [...birthdayEventsForDay, ...holidayEvents, ...completionEvents, ...extraEvents],
      chores:  choreEvents,
      tasks:   maintenanceEvents,
      recipes: recipeEvents,
      grocery: groceryEvent,
      trips:   tripBars,
      weather: visibleIds.has('weather') ? (weatherByDate.value[dateStr] ?? null) : null,
    };
  });
}

// ── Scrollable multi-month view ────────────────────────────────────────────────
const renderedMonthDates = ref([]);
const visibleMonthKey    = ref('');

const renderedMonths = computed(() =>
  renderedMonthDates.value.map(date => ({
    key:   format(date, 'yyyy-MM'),
    date,
    label: format(date, 'MMMM yyyy'),
    days:  computeDaysForMonth(date),
  }))
);

async function initView(base = new Date()) {
  // 2 past months + current + 9 future months
  renderedMonthDates.value = Array.from({ length: 12 }, (_, i) => addMonths(base, i - 2));
  visibleMonthKey.value    = format(base, 'yyyy-MM');

  const from = startOfWeek(startOfMonth(renderedMonthDates.value[0]));
  const to   = endOfWeek(endOfMonth(renderedMonthDates.value.at(-1)));
  const fromStr = format(from, 'yyyy-MM-dd');
  const toStr   = format(to,   'yyyy-MM-dd');
  const [calData] = await Promise.all([
    loadCalendarData({ from: from.toISOString(), to: to.toISOString() }),
    weatherApi.range(fromStr, toStr).then(({ data }) => {
      const map = {};
      for (const r of data.records ?? []) map[r.date] = r;
      weatherByDate.value = map;
    }).catch(() => {}),
  ]);
  tasks.value           = calData.tasks          ?? [];
  chores.value          = calData.chores         ?? [];
  calendarEvents.value  = calData.events         ?? [];
  birthdays.value       = calData.birthdays      ?? [];
  recipeSchedules.value = calData.recipes        ?? [];
  groceryShopping.value = calData.groceryShopping ?? [];
  trips.value           = calData.trips          ?? [];

  await nextTick();
  setupMonthObserver();
}

let monthObserver = null;

function setupMonthObserver() {
  if (monthObserver) monthObserver.disconnect();
  monthObserver = new IntersectionObserver(
    entries => {
      const visible = entries
        .filter(e => e.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
      if (visible.length) visibleMonthKey.value = visible[0].target.dataset.monthKey;
    },
    { rootMargin: '-5% 0px -55% 0px', threshold: 0 }
  );
  document.querySelectorAll('[data-month-key]').forEach(el => monthObserver.observe(el));
}

watch(renderedMonthDates, () => nextTick(setupMonthObserver));

function scrollToMonth(key, behavior = 'smooth') {
  const el = document.querySelector(`[data-month-key="${key}"]`);
  el?.scrollIntoView({ behavior });
}

function scrollToDate(dateStr, behavior = 'smooth') {
  const el = document.querySelector(`[data-date="${dateStr}"]`);
  el?.scrollIntoView({ behavior, block: 'center' });
}

async function goToday() {
  const key = format(new Date(), 'yyyy-MM');
  if (!renderedMonthDates.value.some(d => format(d, 'yyyy-MM') === key)) {
    await initView(new Date());
  }
  scrollToMonth(key);
  visibleMonthKey.value = key;
}

const SCROLL_RESTORE_KEY = 'hc_calendar_month';
const LAST_DATE_KEY      = 'hc_calendar_last_date';

const lastInteractedDate = ref('');

function navigateTo(dateStr, path) {
  lastInteractedDate.value = dateStr;
  router.push(path);
}

// Leaving to the profile/settings/calendars area isn't calendar browsing — on
// return the calendar should reopen on today (like the Today button), not the
// previously scrolled month. Drill-downs (day/event/task/… via navigateTo) still restore.
let resetScrollOnReturn = false;
onBeforeRouteLeave((to) => {
  resetScrollOnReturn = /^\/(profile|settings|people|household|calendars)(\/|$)/.test(to.path);
});

onUnmounted(() => {
  if (monthObserver) monthObserver.disconnect();
  if (resetScrollOnReturn) {
    sessionStorage.removeItem(SCROLL_RESTORE_KEY);
    sessionStorage.removeItem(LAST_DATE_KEY);
    return;
  }
  if (visibleMonthKey.value)    sessionStorage.setItem(SCROLL_RESTORE_KEY, visibleMonthKey.value);
  if (lastInteractedDate.value) sessionStorage.setItem(LAST_DATE_KEY, lastInteractedDate.value);
});

onMounted(async () => {
  loadVisibility();
  const savedMonth = sessionStorage.getItem(SCROLL_RESTORE_KEY);
  const savedDate  = sessionStorage.getItem(LAST_DATE_KEY);
  sessionStorage.removeItem(SCROLL_RESTORE_KEY);
  sessionStorage.removeItem(LAST_DATE_KEY);
  if (savedDate) lastInteractedDate.value = savedDate;
  const base = savedMonth ? new Date(`${savedMonth}-01`) : new Date();
  await Promise.all([initView(base), filters.loadFilterData()]);
  await nextTick();
  requestAnimationFrame(() => {
    if (lastInteractedDate.value) {
      scrollToDate(lastInteractedDate.value, 'auto');
    } else {
      scrollToMonth(format(base, 'yyyy-MM'), 'auto');
    }
  });
});

</script>

<style scoped>
/* ── Calendar grid ─────────────────────────────────────────────────────────── */
.calendar-grid {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
}
.day-header {
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-weight: 600;
  font-size: 0.75rem;
  color: rgba(var(--v-theme-on-surface),.6);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface),.12);
}
.day-cell {
  height: 90px;
  overflow: hidden;
  padding: 6px;
  border-right: 1px solid rgba(var(--v-theme-on-surface),.08);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface),.08);
  cursor: pointer;
  display: flex;
  flex-direction: column;
}
.day-cell:hover { background: rgba(var(--v-theme-on-surface),.02); }
.day-cell:nth-child(7n) { border-right: none; }
.day-top-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 2px;
  min-height: 20px;
}
.day-weather-inline {
  display: flex;
  align-items: center;
  gap: 2px;
}
.weather-temp {
  font-size: 0.65rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface), 0.75);
}
.weather-rain {
  font-size: 0.6rem;
  font-weight: 500;
  color: #1565c0;
}
.day-number {
  font-size: 0.8rem;
  font-weight: 500;
  color: rgba(var(--v-theme-on-surface),.7);
  flex-shrink: 0;
}
.day-chore-icons {
  display: flex;
  flex-wrap: wrap;
  gap: 1px;
}
.chore-icon-wrapper {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  padding: 1px;
  cursor: pointer;
  opacity: 0.8;
}
.chore-icon-wrapper:hover { opacity: 1; background: rgba(245, 124, 0, 0.12); }
.recipe-icon-wrapper:hover { background: rgba(0, 137, 123, 0.12) !important; }
.grocery-icon-wrapper:hover { background: rgba(249, 168, 37, 0.12) !important; }
.other-month { background: rgba(var(--v-theme-on-surface),.02); }
.other-month .day-number { color: rgba(var(--v-theme-on-surface),.3); }
.today .day-number {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  border-radius: 50%;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.last-viewed .day-number {
  border: 2px solid rgb(var(--v-theme-primary));
  border-radius: 50%;
  width: 22px;
  height: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
}
.day-events { display: flex; flex-direction: column; flex: 1; }
.trip-bar {
  display: flex;
  align-items: center;
  height: 15px;
  margin-bottom: 2px;
  padding: 0 4px;
  font-size: 0.6rem;
  font-weight: 600;
  color: #fff;
  background: var(--trip-color, #5E35B1);
  cursor: pointer;
  overflow: hidden;
}
.trip-bar--first { border-top-left-radius: 4px; border-bottom-left-radius: 4px; }
.trip-bar--last { border-top-right-radius: 4px; border-bottom-right-radius: 4px; }
.trip-bar--considering {
  background: repeating-linear-gradient(45deg, var(--trip-color, #5E35B1), var(--trip-color, #5E35B1) 4px, rgba(255,255,255,0.35) 4px, rgba(255,255,255,0.35) 8px);
}
.trip-bar:hover { opacity: 0.88; }
.task-chip {
  font-size: 0.65rem !important;
  height: 18px !important;
  max-width: 100%;
  overflow: hidden;
}
.task-chip :deep(.v-chip__content) {
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.chip-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  min-width: 0;
  flex: 1 1 0;
}
.editable-chip { cursor: pointer; }
.overflow-count {
  font-size: 0.6rem;
  font-weight: 600;
  color: rgba(var(--v-theme-on-surface),.45);
  padding-left: 2px;
  line-height: 1.4;
}
.event-time { opacity: 0.75; font-size: 0.6rem; }
.event-continuation { opacity: 0.6; font-size: 0.65rem; }
.multi-day-mid { opacity: 0.85; }
.cal-dot {
  display: inline-block;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  flex-shrink: 0;
  margin-right: 3px;
  vertical-align: middle;
}
.cal-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex-shrink: 0;
}

/* ── Month blocks ───────────────────────────────────────────────────────────── */
.month-block { margin-bottom: 0; }
.month-label {
  font-size: 1rem;
  font-weight: 700;
  color: rgba(var(--v-theme-on-surface),.75);
  background: rgba(var(--v-theme-on-surface),.03);
  border-top: 1px solid rgba(var(--v-theme-on-surface),.08);
  border-bottom: 1px solid rgba(var(--v-theme-on-surface),.08);
}

/* ── Top-right FABs: chat + add ─────────────────────────────────────────────── */
.top-right-fabs {
  position: fixed;
  top: 16px;
  right: 24px;
  display: flex;
  flex-direction: row;
  gap: 8px;
  align-items: center;
  z-index: 200;
  background: rgba(var(--v-theme-primary), 0.18);
  backdrop-filter: blur(6px);
  padding: 8px;
  border-radius: 999px;
}

/* ── Bottom-center FABs: filter + calendar config ───────────────────────────── */
.bottom-center-fabs {
  position: fixed;
  bottom: 24px;
  left: calc(50vw + var(--v-layout-left, 0px) / 2);
  transform: translateX(-50%);
  display: flex;
  flex-direction: row;
  gap: 12px;
  align-items: center;
  z-index: 100;
  background: rgba(var(--v-theme-primary), 0.18);
  backdrop-filter: blur(6px);
  padding: 8px;
  border-radius: 999px;
}

/* ── Bottom-left FAB: today ─────────────────────────────────────────────────── */
.bottom-left-fab {
  position: fixed;
  bottom: 24px;
  left: calc(var(--v-layout-left, 0px) + 24px);
  z-index: 100;
  background: rgba(var(--v-theme-primary), 0.18);
  backdrop-filter: blur(6px);
  padding: 8px;
  border-radius: 999px;
}
.today-fab {
  height: calc(var(--v-btn-height) + 12px) !important;
  font-size: 0.85rem !important;
  font-weight: 700 !important;
  min-width: 0 !important;
  padding-inline: 14px !important;
  text-transform: none !important;
}
.top-right-fabs :deep(.v-icon),
.bottom-center-fabs :deep(.v-icon) {
  font-size: 1.4rem !important;
}

</style>
