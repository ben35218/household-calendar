<template>
  <v-container class="py-6 px-0 px-sm-4">
    <v-progress-linear v-if="loading || filters.filterLoading" indeterminate color="primary" class="mb-4" />

    <div class="px-4 px-sm-0">
      <template v-if="groupedItems.length">
        <div v-for="group in groupedItems" :key="group.date" :data-date="group.date">
          <div v-if="group.todayMarker" class="today-divider my-3">
            <div class="today-divider-line" />
            <span class="today-divider-label text-caption font-weight-bold">TODAY</span>
            <div class="today-divider-line" />
          </div>
          <div class="date-label text-caption font-weight-bold text-medium-emphasis text-uppercase mb-2 mt-4">
            {{ group.label }}
          </div>
          <v-card
            v-for="item in group.items"
            :key="item._id"
            rounded="lg"
            elevation="1"
            class="mb-2 event-card"
            :to="item.calendarType === 'maintenance' ? `/tasks/${item._id}` : item.calendarType === 'chores' ? `/chores/${item._id}` : item.calendarType === 'canadian-holidays' ? undefined : `/calendar/event/${item._id}`"
          >
            <v-card-item>
              <template #prepend>
                <v-badge
                  v-if="isOverdue(item)"
                  color="transparent"
                  floating
                  offset-x="14"
                  offset-y="8"
                  class="overdue-badge-wrapper"
                >
                  <template #badge>
                    <v-icon color="error" size="16">mdi-exclamation-thick</v-icon>
                  </template>
                  <v-icon :color="calendarColor(item.calendarType)" size="26">{{ item.isCompletion ? 'mdi-check-circle' : calendarIcon(item.calendarType) }}</v-icon>
                </v-badge>
                <v-icon v-else :color="item.isCompletion ? '#388E3C' : calendarColor(item.calendarType)" size="26">{{ item.isCompletion ? 'mdi-check-circle' : calendarIcon(item.calendarType) }}</v-icon>
              </template>
              <template #title>
                <span class="text-body-1 font-weight-medium">{{ item.title }}</span>
              </template>
              <v-card-subtitle v-if="item.subtitle">{{ item.subtitle }}</v-card-subtitle>
              <template #append>
                <div class="d-flex align-center ga-2">
                  <v-icon v-if="item.recurrence?.freq" size="14" color="grey">mdi-repeat</v-icon>
                  <span class="text-caption text-medium-emphasis">{{ formatItemTime(item) }}</span>
                </div>
              </template>
            </v-card-item>
            <v-card-text v-if="item.description" class="pt-0 pb-1 text-body-2 text-medium-emphasis">
              {{ item.description }}
            </v-card-text>

          </v-card>
        </div>
      </template>

      <v-empty-state
        v-else-if="!loading && !filters.filterLoading"
        icon="mdi-calendar-blank"
        title="No events"
        text="Add events to your calendar."
        action-text="Add Event"
        @click:action="$router.push('/calendar/event/new')"
      />
    </div>
  </v-container>

  <!-- Top-right FABs: calendar · chat · add -->
  <div class="top-right-fabs">
    <v-btn icon="mdi-calendar" variant="text" color="#388E3C" to="/calendar" />
    <v-btn icon="mdi-chat" variant="text" color="#388E3C" to="/calendar/assistant" />
    <v-btn icon="mdi-plus" variant="text" color="#388E3C" to="/calendar/event/new" />
  </div>

  <!-- Bottom-center FABs: filter · calendar config -->
  <div class="bottom-center-fabs">
    <CalendarFilterMenu :filters="filters" />
    <v-menu v-model="calendarMenuOpen" :close-on-content-click="false" location="top" :offset="8">
      <template #activator="{ props }">
        <v-btn v-bind="props" icon="mdi-calendar-multiple" variant="text" color="#388E3C" />
      </template>
      <v-card min-width="210" rounded="lg">
        <v-card-text class="pb-2">
          <div class="text-caption text-medium-emphasis font-weight-medium mb-1 text-uppercase">My Calendars</div>
          <div v-for="cal in calendars" :key="cal.id" class="d-flex align-center" style="margin-left:-8px">
            <v-checkbox v-model="cal.visible" hide-details density="compact" class="flex-grow-1">
              <template #label>
                <div class="d-flex align-center ga-2">
                  <span class="cal-swatch" :style="{ background: cal.color }"></span>
                  <span class="text-body-2">{{ cal.name }}</span>
                </div>
              </template>
            </v-checkbox>
            <v-btn
              v-if="cal.id === 'maintenance'"
              icon="mdi-view-dashboard"
              size="x-small"
              variant="text"
              color="medium-emphasis"
              density="compact"
              to="/maintenance"
              @click="calendarMenuOpen = false"
            />
            <v-btn
              v-if="cal.id === 'chores'"
              icon="mdi-view-dashboard"
              size="x-small"
              variant="text"
              color="medium-emphasis"
              density="compact"
              to="/chores"
              @click="calendarMenuOpen = false"
            />
          </div>
        </v-card-text>
      </v-card>
    </v-menu>
  </div>

  <!-- Bottom-left FAB: today -->
  <div class="bottom-left-fab">
    <v-btn variant="text" color="#388E3C" class="today-fab" @click="goToday">
      Today
    </v-btn>
  </div>
</template>

<script setup>
import { ref, computed, reactive, watch, onMounted, nextTick } from 'vue';
import { format, isToday, isTomorrow, isYesterday, subYears, addYears } from 'date-fns';
import { loadCalendarData } from '../services/calendarData';
import { useCalendarFilters } from '../composables/useCalendarFilters';
import CalendarFilterMenu from '../components/CalendarFilterMenu.vue';
import { getCanadianHolidays } from '../utils/canadianHolidays';

const STORAGE_KEY = 'hc_calendar_visibility';

const rawEvents   = ref([]);
const rawTasks    = ref([]);
const rawChores   = ref([]);
const rawHolidays = ref([]);
const loading     = ref(false);

const calendars = ref([
  { id: 'maintenance',       name: 'Maintenance',       color: '#1976D2', visible: true },
  { id: 'activities',        name: 'Activities',        color: '#388E3C', visible: true },
  { id: 'appointments',      name: 'Appointments',      color: '#7B1FA2', visible: true },
  { id: 'chores',            name: 'Chores',            color: '#F57C00', visible: true },
  { id: 'canadian-holidays', name: 'Canadian Holidays', color: '#D32F2F', visible: true },
]);

const filters = reactive(useCalendarFilters());

const calendarMenuOpen = ref(false);

function loadVisibility() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}');
    // If saved data doesn't include canadian-holidays it predates that calendar;
    // reset all to visible so stale false values don't hide newly added calendars.
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

function calendarColor(type) {
  return calendars.value.find(c => c.id === type)?.color ?? '#9E9E9E';
}

const CALENDAR_ICONS = {
  maintenance:          'mdi-wrench',
  activities:           'mdi-run',
  appointments:         'mdi-stethoscope',
  chores:               'mdi-broom',
  'canadian-holidays':  'mdi-flag',
};

function calendarIcon(type) { return CALENDAR_ICONS[type] ?? 'mdi-calendar'; }

function isOverdue(item) {
  if (item.calendarType !== 'maintenance' || item.isCompletion) return false;
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const itemStr  = format(new Date(item.startDate), 'yyyy-MM-dd');
  return itemStr < todayStr;
}

function formatItemTime(item) {
  if (item.allDay) return 'All day';
  const start = format(new Date(item.startDate), 'h:mm a');
  if (!item.endDate) return start;
  return `${start} – ${format(new Date(item.endDate), 'h:mm a')}`;
}

function dayLabel(dateStr) {
  const d = new Date(dateStr + 'T00:00:00');
  if (isToday(d))     return `Today · ${format(d, 'MMMM d')}`;
  if (isTomorrow(d))  return `Tomorrow · ${format(d, 'MMMM d')}`;
  if (isYesterday(d)) return `Yesterday · ${format(d, 'MMMM d')}`;
  return format(d, 'EEEE, MMMM d, yyyy');
}

const allItems = computed(() => {
  const tasks = [...rawTasks.value, ...filters.pausedTasks]
    .filter(t => t.nextDueDate)
    .map(t => ({
      _id:          t._id,
      calendarType: 'maintenance',
      title:        t.title,
      startDate:    t.nextDueDate,
      allDay:       true,
      active:       t.active !== false,
      categoryId:   t.categoryId?._id ?? null,
      itemId:       t.itemId?._id ?? null,
      subtitle:     null,
      description:  null,
      recurrence:   null,
      isCompletion: false,
    }));

  const completions = filters.rawCompletions.map(c => ({
    _id:          c._id,
    calendarType: 'maintenance',
    title:        c.taskId?.title ?? 'Completed Task',
    startDate:    c.completedDate,
    allDay:       true,
    active:       true,
    categoryId:   null,
    itemId:       c.taskId?.itemId ?? null,
    subtitle:     c.notes || null,
    description:  null,
    recurrence:   null,
    isCompletion: true,
  }));

  const chores = rawChores.value
    .filter(c => c.nextDueDate)
    .map(c => ({
      _id:          c._id,
      calendarType: 'chores',
      title:        c.title,
      startDate:    c.nextDueDate,
      allDay:       true,
      active:       c.active !== false,
      categoryId:   null,
      itemId:       null,
      subtitle:     null,
      description:  c.description ?? null,
      recurrence:   null,
      isCompletion: false,
    }));

  const events = rawEvents.value.map(e => ({
    _id:          e._id,
    calendarType: e.calendarType,
    title:        e.title,
    startDate:    e.startDate,
    endDate:      e.endDate,
    allDay:       e.allDay,
    active:       true,
    categoryId:   null,
    subtitle:     e.location ?? null,
    description:  e.description ?? null,
    recurrence:   e.recurrence ?? null,
    isCompletion: false,
  }));

  const holidays = rawHolidays.value.map(h => ({
    _id:          `holiday-${h.date}-${h.name}`,
    calendarType: 'canadian-holidays',
    title:        h.name,
    startDate:    h.date + 'T12:00:00Z',
    allDay:       true,
    active:       true,
    categoryId:   null,
    itemId:       null,
    subtitle:     null,
    description:  null,
    recurrence:   null,
    isCompletion: false,
  }));

  return [...tasks, ...completions, ...chores, ...events, ...holidays].sort((a, b) => new Date(a.startDate) - new Date(b.startDate));
});

const filteredItems = computed(() => {
  const visibleTypes = new Set(calendars.value.filter(c => c.visible).map(c => c.id));
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  return allItems.value.filter(i => {
    if (!visibleTypes.has(i.calendarType)) return false;
    if (i.calendarType === 'maintenance') {
      const exclusiveMode = filters.showPaused || filters.showCompleted;
      if (i.isCompletion) {
        if (!filters.showCompleted) return false;
        if (filters.itemFilter.length && !filters.itemFilter.includes(i.itemId)) return false;
      } else if (!i.active) {
        if (!filters.showPaused) return false;
        if (filters.categoryFilter.length && !filters.categoryFilter.includes(i.categoryId)) return false;
        if (filters.itemFilter.length && !filters.itemFilter.includes(i.itemId)) return false;
      } else {
        if (exclusiveMode) return false;
        if (filters.categoryFilter.length && !filters.categoryFilter.includes(i.categoryId)) return false;
        if (filters.itemFilter.length && !filters.itemFilter.includes(i.itemId)) return false;
      }
    }
    if (filters.timeFilter && i.startDate) {
      const d = format(new Date(i.startDate), 'yyyy-MM-dd');
      if (filters.timeFilter === 'upcoming' && d < todayStr)  return false;
      if (filters.timeFilter === 'past'     && d >= todayStr) return false;
    }
    return true;
  });
});

const groupedItems = computed(() => {
  const map = new Map();
  for (const item of filteredItems.value) {
    if (!item.startDate) continue;
    // All-day items are stored at UTC midnight; use the UTC date portion directly
    // to avoid shifting to the previous day in negative-offset timezones.
    const dateStr = item.allDay
      ? new Date(item.startDate).toISOString().slice(0, 10)
      : format(new Date(item.startDate), 'yyyy-MM-dd');
    if (!map.has(dateStr)) map.set(dateStr, []);
    map.get(dateStr).push(item);
  }
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const groups = Array.from(map.entries()).map(([date, items]) => ({
    date,
    label: dayLabel(date),
    items,
    todayMarker: false,
  }));
  const firstAtOrAfterToday = groups.findIndex(g => g.date >= todayStr);
  if (firstAtOrAfterToday !== -1) groups[firstAtOrAfterToday].todayMarker = true;
  return groups;
});

function goToday() {
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const target = groupedItems.value.find(g => g.date >= todayStr)?.date
    ?? groupedItems.value.at(-1)?.date;
  if (target) {
    document.querySelector(`[data-date="${target}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
}

async function loadEvents() {
  loading.value = true;
  try {
    const now  = new Date();
    const from = subYears(now, 5);
    const to   = addYears(now, 5);
    const data = await loadCalendarData({ from: from.toISOString(), to: to.toISOString() });
    rawTasks.value    = data.tasks   ?? [];
    rawChores.value   = data.chores  ?? [];
    rawEvents.value   = data.events  ?? [];
    rawHolidays.value = getCanadianHolidays(from, to);
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  loadVisibility();
  await Promise.all([loadEvents(), filters.loadFilterData()]);
  await nextTick();
  const todayStr = format(new Date(), 'yyyy-MM-dd');
  const target = groupedItems.value.find(g => g.date >= todayStr)?.date
    ?? groupedItems.value.at(-1)?.date;
  if (target) {
    document.querySelector(`[data-date="${target}"]`)?.scrollIntoView({ behavior: 'instant', block: 'start' });
  }
});
</script>

<style scoped>
.event-card { transition: box-shadow 0.15s; }
.event-card:hover { box-shadow: 0 4px 12px rgba(var(--v-theme-on-surface),0.1) !important; }

.overdue-badge-wrapper :deep(.v-badge__badge) {
  overflow: visible;
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
  background: rgba(var(--v-theme-primary), 0.18);
  backdrop-filter: blur(6px);
  padding: 8px;
  border-radius: 999px;
}

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

.cal-swatch {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 3px;
  flex-shrink: 0;
}

.today-divider {
  display: flex;
  align-items: center;
  gap: 8px;
}

.today-divider-line {
  flex: 1;
  height: 2px;
  background: rgb(var(--v-theme-primary));
  border-radius: 1px;
}

.today-divider-label {
  color: rgb(var(--v-theme-primary));
  letter-spacing: 0.08em;
  white-space: nowrap;
}
</style>
