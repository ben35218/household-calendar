<template>
  <v-container class="py-6" max-width="860">
    <div class="d-flex align-center mb-6">
      <BackButton size="small" color="#0288D1" />
      <h1 class="text-h4 font-weight-bold ml-2">Weather</h1>
    </div>

    <!-- 7-day forecast widget -->
    <WeatherWidget class="mb-6" />

    <!-- 90-day seasonal outlook -->
    <v-card rounded="lg" elevation="1">
      <v-card-title class="d-flex align-center pa-4">
        <v-icon class="mr-2" color="blue-darken-1">mdi-calendar-month-outline</v-icon>
        90-Day Seasonal Outlook
        <v-spacer />
        <span v-if="weeks.length" class="text-caption text-medium-emphasis font-weight-regular">
          Based on past {{ yearsInSample }} years
        </span>
        <v-btn icon="mdi-refresh" variant="text" size="small" :loading="outlookLoading" class="ml-1" @click="loadOutlook" />
      </v-card-title>
      <v-divider />

      <v-card-text v-if="outlookError" class="text-body-2 text-medium-emphasis">
        <v-icon size="16" class="mr-1">mdi-alert-circle-outline</v-icon>{{ outlookError }}
      </v-card-text>

      <v-card-text v-else-if="outlookLoading" class="text-center py-8">
        <v-progress-circular indeterminate size="32" color="primary" />
        <div class="text-body-2 text-medium-emphasis mt-3">Fetching historical averages…</div>
      </v-card-text>

      <template v-else-if="weeks.length">
        <!-- Month headers with weekly rows grouped underneath -->
        <div v-for="(group, gi) in monthGroups" :key="gi">
          <div class="month-heading px-4 py-2">{{ group.label }}</div>
          <v-divider />
          <div
            v-for="(week, wi) in group.weeks"
            :key="wi"
            class="week-row px-4 py-3 d-flex align-center"
            :class="week.rainyDays >= 4 ? 'week-row--wet' : week.rainyDays === 0 ? 'week-row--dry' : ''"
          >
            <!-- Date range -->
            <div class="week-dates text-body-2 text-medium-emphasis flex-shrink-0">
              {{ formatWeekRange(week.startDate, week.endDate) }}
            </div>

            <v-spacer />

            <!-- Temp range -->
            <div class="d-flex align-center ga-1 mr-6">
              <v-icon size="14" color="orange-darken-2">mdi-thermometer-high</v-icon>
              <span class="text-body-2 font-weight-medium">{{ week.avgTempMax }}°</span>
              <span class="text-body-2 text-medium-emphasis">/</span>
              <span class="text-body-2 text-medium-emphasis">{{ week.avgTempMin }}°</span>
            </div>

            <!-- Precipitation -->
            <div class="d-flex align-center ga-1 mr-4" style="min-width:80px">
              <v-icon size="14" :color="week.totalPrecip > 20 ? 'blue-darken-2' : week.totalPrecip > 5 ? 'blue' : 'blue-grey-lighten-2'">
                mdi-water
              </v-icon>
              <span class="text-body-2" :class="week.totalPrecip > 5 ? 'text-blue-darken-1' : 'text-medium-emphasis'">
                {{ week.totalPrecip }} mm
              </span>
            </div>

            <!-- Rain days chip -->
            <v-chip
              size="x-small"
              :color="week.rainyDays >= 4 ? 'blue' : week.rainyDays >= 2 ? 'blue-lighten-3' : 'grey-lighten-2'"
              :variant="week.rainyDays >= 2 ? 'tonal' : 'flat'"
              style="min-width:52px; justify-content:center"
            >
              {{ week.rainyDays }}/7 days
            </v-chip>
          </div>
          <v-divider v-if="gi < monthGroups.length - 1 && group.weeks === monthGroups[gi].weeks" />
        </div>

        <v-card-text class="pt-2 pb-3">
          <div class="text-caption text-medium-emphasis">
            Averages are computed from the same 90-day window in {{ yearsInSample === 3 ? 'each of the past 3 years' : `the past ${yearsInSample} year(s)` }}.
            A day counts as rainy when average precipitation ≥ 1 mm.
          </div>
        </v-card-text>
      </template>
    </v-card>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { format, parseISO } from 'date-fns';
import { weatherApi } from '../services/api';
import WeatherWidget from '../components/WeatherWidget.vue';

const weeks          = ref([]);
const outlookLoading = ref(false);
const outlookError   = ref('');
const yearsInSample  = computed(() => weeks.value[0]?.yearsInSample ?? 3);

async function loadOutlook() {
  outlookLoading.value = true;
  outlookError.value   = '';
  try {
    const { data } = await weatherApi.outlook();
    weeks.value = data.weeks ?? [];
  } catch (e) {
    outlookError.value = e.response?.data?.error ?? 'Could not load seasonal outlook';
  } finally {
    outlookLoading.value = false;
  }
}

function formatWeekRange(start, end) {
  const s = parseISO(start);
  const e = parseISO(end);
  if (s.getMonth() === e.getMonth()) {
    return `${format(s, 'MMM d')}–${format(e, 'd')}`;
  }
  return `${format(s, 'MMM d')}–${format(e, 'MMM d')}`;
}

// Group weeks by the month of their start date
const monthGroups = computed(() => {
  const groups = [];
  weeks.value.forEach(week => {
    const label = format(parseISO(week.startDate), 'MMMM yyyy');
    let group = groups.find(g => g.label === label);
    if (!group) { group = { label, weeks: [] }; groups.push(group); }
    group.weeks.push(week);
  });
  return groups;
});

onMounted(loadOutlook);
</script>

<style scoped>
.month-heading {
  font-size: 0.8rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: rgba(var(--v-theme-on-surface), 0.55);
  background: rgba(var(--v-theme-on-surface), 0.03);
}
.week-row {
  border-bottom: 1px solid rgba(var(--v-theme-on-surface), 0.06);
}
.week-row:last-child { border-bottom: none; }
.week-row--wet  { background: rgba(13, 71, 161, 0.04); }
.week-row--dry  { background: rgba(56, 142, 60, 0.04); }
.week-dates { min-width: 110px; }
</style>
