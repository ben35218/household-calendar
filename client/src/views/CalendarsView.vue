<template>
  <v-container class="py-6 px-4" style="max-width: 480px">
    <div class="d-flex align-center mb-2">
      <BackButton class="mr-2" />
      <h1 class="text-h4 font-weight-bold">My Calendars</h1>
    </div>

    <div class="d-flex ga-2 mb-6 ml-10">
      <v-btn size="x-small" variant="text" color="primary" @click="showAll">Show all</v-btn>
      <v-btn size="x-small" variant="text" color="medium-emphasis" @click="hideAll">Hide all</v-btn>
    </div>

    <div v-for="group in groups" :key="group.label" class="mb-6">
      <div class="group-label text-caption font-weight-bold text-medium-emphasis text-uppercase mb-1">
        {{ group.label }}
      </div>
      <div class="cal-list">
        <div
          v-for="cal in group.items"
          :key="cal.id"
          class="cal-row"
          :class="{ 'cal-row--off': !cal.visible }"
          @click="cal.visible = !cal.visible"
        >
          <span class="cal-accent" :style="{ background: cal.color }"></span>
          <span class="cal-name text-body-1">{{ cal.name }}</span>
          <v-btn
            v-if="linkTarget(cal.id)"
            icon="mdi-cog-outline"
            size="x-small"
            variant="text"
            color="medium-emphasis"
            density="compact"
            :to="linkTarget(cal.id)"
            @click.stop
          />
          <v-switch
            :model-value="cal.visible"
            hide-details
            density="compact"
            :color="cal.color"
            class="cal-switch"
            @click.stop
            @update:model-value="val => cal.visible = val"
          />
        </div>
      </div>
    </div>
  </v-container>
</template>

<script setup>
import { ref, computed, watch } from 'vue';

const STORAGE_KEY = 'hc_calendar_visibility';

const LINK_TARGETS = {
  maintenance: '/maintenance',
  chores: '/chores',
  weather: '/weather',
  recipes: '/meal-planner',
  'canadian-holidays': '/holidays',
  vacations: '/vacations',
};

function linkTarget(id) {
  return LINK_TARGETS[id] ?? null;
}

const calendars = ref([
  { id: 'activities',        name: 'Activities',   color: '#388E3C', visible: true, group: 'basic' },
  { id: 'appointments',      name: 'Appointments', color: '#7B1FA2', visible: true, group: 'basic' },
  { id: 'birthdays',         name: 'Birthdays',    color: '#E91E63', visible: true, group: 'basic' },
  { id: 'canadian-holidays', name: 'Holidays',     color: '#D32F2F', visible: true, group: 'basic' },
  { id: 'weather',           name: 'Weather',      color: '#0288D1', visible: true, group: 'basic' },
  { id: 'chores',            name: 'Chores',       color: '#F57C00', visible: true, group: 'advanced' },
  { id: 'recipes',           name: 'Meals',        color: '#00897B', visible: true, group: 'advanced' },
  { id: 'maintenance',       name: 'Maintenance',  color: '#1976D2', visible: true, group: 'advanced' },
  { id: 'vacations',         name: 'Vacations',    color: '#5E35B1', visible: true, group: 'advanced' },
]);

const groups = computed(() => [
  { label: 'Basic',    items: calendars.value.filter(c => c.group === 'basic') },
  { label: 'Advanced', items: calendars.value.filter(c => c.group === 'advanced') },
]);

function showAll() { calendars.value.forEach(c => { c.visible = true; }); }
function hideAll() { calendars.value.forEach(c => { c.visible = false; }); }

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

loadVisibility();
</script>

<style scoped>
.group-label {
  letter-spacing: 0.08em;
  padding-left: 4px;
}

.cal-list {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.cal-row {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 10px 12px 10px 0;
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s;
}
.cal-row:hover { background: rgba(var(--v-theme-on-surface), 0.04); }

.cal-accent {
  display: block;
  width: 4px;
  min-width: 4px;
  height: 36px;
  border-radius: 2px;
  flex-shrink: 0;
  transition: opacity 0.2s;
}
.cal-row--off .cal-accent { opacity: 0.25; }

.cal-name {
  flex: 1;
  transition: opacity 0.2s;
}
.cal-row--off .cal-name { opacity: 0.4; }

.cal-switch {
  flex-shrink: 0;
}
</style>
