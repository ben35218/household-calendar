<template>
  <v-card rounded="lg" elevation="1">
    <v-card-title class="d-flex align-center pa-4">
      <v-icon class="mr-2" color="blue-darken-1">mdi-weather-partly-cloudy</v-icon>
      Local Weather
      <v-spacer />
      <v-chip v-if="advisory && !loading && !error" :color="advisoryColor" size="small" label class="mr-2">
        {{ advisory }}
      </v-chip>
      <v-btn icon="mdi-refresh" variant="text" size="small" :loading="loading" @click="load" />
    </v-card-title>

    <v-divider />

    <!-- Error state -->
    <v-card-text v-if="error" class="text-body-2 text-medium-emphasis">
      <v-icon size="16" class="mr-1">mdi-alert-circle-outline</v-icon>
      {{ error }}
      <template v-if="error.includes('address')">
        — <router-link to="/profile/account">Add your address in your profile</router-link>
      </template>
    </v-card-text>

    <!-- Loading state -->
    <v-card-text v-else-if="loading" class="text-center py-6">
      <v-progress-circular indeterminate size="28" color="primary" />
    </v-card-text>

    <template v-else-if="weather">
      <!-- Current conditions -->
      <v-card-text class="pb-2">
        <div class="d-flex align-center ga-4">
          <v-icon :icon="wmoIcon(weather.current.weatherCode)" size="44" color="blue-darken-1" />
          <div>
            <div class="text-h4 font-weight-bold">
              {{ Math.round(weather.current.temperature) }}{{ weather.units.temperature }}
            </div>
            <div class="text-body-2 text-medium-emphasis">{{ weather.current.description }}</div>
          </div>
          <div class="text-body-2 text-medium-emphasis ml-2">
            <div>Humidity: {{ weather.current.humidity }}%</div>
            <div>Wind: {{ Math.round(weather.current.windSpeed) }} {{ weather.units.wind }}</div>
            <div v-if="weather.current.precipitation > 0">
              Rain now: {{ weather.current.precipitation }} {{ weather.units.precipitation }}
            </div>
          </div>
        </div>
      </v-card-text>

      <!-- 7-day forecast strip — click a day to see its hourly breakdown -->
      <v-card-text class="pt-0 pb-2">
        <div class="d-flex ga-2 overflow-x-auto pb-1">
          <div
            v-for="(day, i) in weather.forecast"
            :key="day.date"
            class="forecast-day pa-2 rounded text-center flex-shrink-0"
            :class="[
              day.goodWeather ? 'forecast-day--good' : 'forecast-day--neutral',
              selectedDayIndex === i ? 'forecast-day--selected' : '',
            ]"
            @click="selectedDayIndex = i"
          >
            <div class="text-caption font-weight-medium" :class="i === 0 ? 'text-primary' : 'text-medium-emphasis'">
              {{ dayLabel(day.date, i) }}
            </div>
            <v-icon :icon="wmoIcon(day.weatherCode)" size="22" class="my-1"
              :color="day.goodWeather ? 'success' : 'blue-grey-lighten-1'" />
            <div class="text-caption font-weight-medium">{{ Math.round(day.tempMax) }}°</div>
            <div class="text-caption text-medium-emphasis">{{ Math.round(day.tempMin) }}°</div>
            <div v-if="day.precipProbability > 10" class="text-caption text-blue-darken-1">
              {{ day.precipProbability }}%
            </div>
            <div v-if="day.precipSum > 0" class="text-caption text-blue-darken-2">
              {{ day.precipSum }}mm
            </div>
            <v-icon v-if="day.goodWeather" icon="mdi-grass" size="14" color="success" class="mt-1" />
          </div>
        </div>
      </v-card-text>

      <!-- Hourly breakdown for selected day -->
      <v-card-text v-if="selectedDay && selectedDayHours.length" class="pt-0 pb-2">
        <div class="text-caption text-medium-emphasis font-weight-medium text-uppercase mb-2">
          Hourly — {{ dayLabel(selectedDay.date, selectedDayIndex) }}
        </div>
        <div class="d-flex ga-2 overflow-x-auto pb-1">
          <div
            v-for="h in selectedDayHours"
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
      </v-card-text>

      <!-- Mowing advisory -->
      <v-divider />
      <v-card-text class="pt-3 pb-3">
        <div class="d-flex align-center mb-1">
          <v-icon icon="mdi-grass" size="16" color="success" class="mr-1" />
          <span class="text-body-2 font-weight-medium">Mowing Forecast</span>
        </div>
        <div v-if="goodMowingDays.length" class="text-body-2">
          <span class="text-success font-weight-medium">Good days: </span>
          {{ goodMowingDays.map(d => d.label).join(', ') }}
        </div>
        <div v-else class="text-body-2 text-medium-emphasis">
          No ideal mowing days in the next 7 days — too much rain expected
        </div>
      </v-card-text>
    </template>
  </v-card>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { format } from 'date-fns';
import { weatherApi } from '../services/api';

const weather = ref(null);
const loading = ref(false);
const error = ref('');
const selectedDayIndex = ref(0);

const WMO_ICONS = {
  0: 'mdi-weather-sunny',
  1: 'mdi-weather-sunny',
  2: 'mdi-weather-partly-cloudy',
  3: 'mdi-weather-cloudy',
  45: 'mdi-weather-fog',
  48: 'mdi-weather-fog',
  51: 'mdi-weather-rainy',
  53: 'mdi-weather-rainy',
  55: 'mdi-weather-pouring',
  61: 'mdi-weather-rainy',
  63: 'mdi-weather-rainy',
  65: 'mdi-weather-pouring',
  71: 'mdi-weather-snowy',
  73: 'mdi-weather-snowy',
  75: 'mdi-weather-snowy-heavy',
  77: 'mdi-weather-snowy',
  80: 'mdi-weather-rainy',
  81: 'mdi-weather-rainy',
  82: 'mdi-weather-pouring',
  85: 'mdi-weather-snowy',
  86: 'mdi-weather-snowy-heavy',
  95: 'mdi-weather-lightning-rainy',
  96: 'mdi-weather-lightning-rainy',
  99: 'mdi-weather-lightning-rainy',
};

function wmoIcon(code) {
  return WMO_ICONS[code] ?? 'mdi-weather-cloudy';
}

function dayLabel(dateStr, i) {
  if (i === 0) return 'Today';
  if (i === 1) return 'Tomorrow';
  return format(new Date(dateStr + 'T12:00:00'), 'EEE');
}

function hourLabel(h) {
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

const selectedDay = computed(() => weather.value?.forecast[selectedDayIndex.value] ?? null);

// Filter to daytime hours (6am–9pm) so the strip stays manageable
const selectedDayHours = computed(() =>
  (selectedDay.value?.hours ?? []).filter(h => h.hour >= 6 && h.hour <= 21)
);

const nowHour = new Date().getHours();
function isNow(h) {
  return selectedDayIndex.value === 0 && h.hour === nowHour;
}

const goodMowingDays = computed(() =>
  (weather.value?.forecast ?? [])
    .map((d, i) => ({ ...d, label: dayLabel(d.date, i) }))
    .filter(d => d.goodWeather)
);

const advisory = computed(() => {
  if (!weather.value) return null;
  const today = weather.value.forecast[0];
  if (today?.goodWeather) return 'Great day to mow!';
  const next = weather.value.forecast.find((d, i) => i > 0 && d.goodWeather);
  if (next) {
    const i = weather.value.forecast.indexOf(next);
    return `Mow on ${dayLabel(next.date, i)}`;
  }
  return 'Wet week ahead';
});

const advisoryColor = computed(() => {
  if (!weather.value) return 'grey';
  if (weather.value.forecast[0]?.goodWeather) return 'success';
  if (weather.value.forecast[1]?.goodWeather) return 'info';
  if (goodMowingDays.value.length) return 'warning';
  return 'error';
});

async function load() {
  loading.value = true;
  error.value = '';
  try {
    const { data } = await weatherApi.get();
    weather.value = data;
    selectedDayIndex.value = 0;
  } catch (e) {
    error.value = e.response?.data?.error ?? 'Weather unavailable';
  } finally {
    loading.value = false;
  }
}

onMounted(load);
</script>

<style scoped>
.forecast-day {
  min-width: 58px;
  cursor: pointer;
  transition: opacity 0.15s;
}
.forecast-day:hover { opacity: 0.8; }
.forecast-day--good {
  background: rgb(var(--v-theme-success), 0.08);
  border: 1px solid rgb(var(--v-theme-success), 0.25);
}
.forecast-day--neutral {
  background: rgba(0, 0, 0, 0.03);
  border: 1px solid rgba(0, 0, 0, 0.06);
}
.forecast-day--selected {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: -1px;
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
