<template>
  <v-container class="py-6" max-width="800">
    <div class="d-flex align-center mb-4">
      <BackButton />
      <div class="ml-2">
        <h1 class="text-h4 font-weight-bold">{{ event?.title }}</h1>
        <div class="d-flex align-center ga-2 mt-1">
          <v-chip v-if="event" :color="calendarColor" :prepend-icon="calendarIcon" size="small" label>
            {{ calendarLabel }}
          </v-chip>
          <v-chip v-if="event?.recurrence?.freq" size="small" label variant="outlined" prepend-icon="mdi-repeat">
            Repeating
          </v-chip>
        </div>
      </div>
      <v-spacer />
      <v-btn variant="outlined" color="#388E3C" prepend-icon="mdi-pencil" :to="`/calendar/event/${$route.params.eventId}/edit`">Edit</v-btn>
    </div>

    <v-progress-linear v-if="loading" indeterminate color="primary" class="mb-4" />

    <v-row v-if="event">
      <v-col cols="12" md="7">
        <v-card rounded="lg" elevation="1" class="mb-4">
          <v-card-title>Details</v-card-title>
          <v-divider />
          <v-card-text>
            <v-list density="compact">
              <v-list-item prepend-icon="mdi-calendar" title="Date" :subtitle="dateLabel" />
              <v-list-item v-if="!event.allDay" prepend-icon="mdi-clock-outline" title="Time" :subtitle="timeLabel" />
              <v-list-item v-if="event.location" prepend-icon="mdi-map-marker" title="Location" :subtitle="event.location" />
              <v-list-item v-if="event.phone" prepend-icon="mdi-phone" title="Phone">
                <template #subtitle>
                  <a :href="`tel:${event.phone}`" class="text-primary text-decoration-none">{{ event.phone }}</a>
                </template>
              </v-list-item>
              <v-list-item v-if="event.url" prepend-icon="mdi-link" title="Website">
                <template #subtitle>
                  <a :href="event.url" target="_blank" rel="noopener" class="text-primary text-decoration-none">{{ event.url }}</a>
                </template>
              </v-list-item>
              <v-list-item v-if="event.travelMinutes" prepend-icon="mdi-car" title="Travel Time" :subtitle="formatDuration(event.travelMinutes)" />
              <v-list-item v-if="event.recurrence?.freq" prepend-icon="mdi-repeat" title="Repeats" :subtitle="recurrenceLabel" />
            </v-list>

            <template v-if="event.description">
              <v-divider class="my-2" />
              <div class="text-subtitle-2 mb-1">Description</div>
              <p class="text-body-2">{{ event.description }}</p>
            </template>
          </v-card-text>
        </v-card>
      </v-col>

      <v-col cols="12" md="5">
        <v-card v-if="event.reminderMinutes || event.alert2Minutes" rounded="lg" elevation="1">
          <v-card-title class="d-flex align-center">
            <v-icon class="mr-2" color="primary" size="20">mdi-bell</v-icon>
            Reminders
          </v-card-title>
          <v-divider />
          <v-list density="compact">
            <v-list-item v-if="event.reminderMinutes" prepend-icon="mdi-bell-outline" title="Primary" :subtitle="formatReminder(event.reminderMinutes)" />
            <v-list-item v-if="event.alert2Minutes" prepend-icon="mdi-bell-plus-outline" title="Second" :subtitle="formatReminder(event.alert2Minutes)" />
          </v-list>
        </v-card>
      </v-col>
    </v-row>
  </v-container>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import { format, parseISO } from 'date-fns';
import { calendarApi } from '../services/api';

const route = useRoute();

const event = ref(null);
const loading = ref(false);

const CALENDAR_META = {
  activities:   { label: 'Activities',   color: '#388E3C', icon: 'mdi-run' },
  appointments: { label: 'Appointments', color: '#7B1FA2', icon: 'mdi-stethoscope' },
};

const calendarColor = computed(() => CALENDAR_META[event.value?.calendarType]?.color ?? '#9E9E9E');
const calendarIcon  = computed(() => CALENDAR_META[event.value?.calendarType]?.icon  ?? 'mdi-calendar');
const calendarLabel = computed(() => CALENDAR_META[event.value?.calendarType]?.label ?? event.value?.calendarType);

const dateLabel = computed(() => {
  if (!event.value) return '';
  const start = format(parseISO(event.value.startDate), 'EEEE, MMMM d, yyyy');
  if (!event.value.endDate) return start;
  const end = format(parseISO(event.value.endDate), 'EEEE, MMMM d, yyyy');
  if (start === end) return start;
  return `${start} – ${end}`;
});

const timeLabel = computed(() => {
  if (!event.value || event.value.allDay) return '';
  const start = format(parseISO(event.value.startDate), 'h:mm a');
  if (!event.value.endDate) return start;
  return `${start} – ${format(parseISO(event.value.endDate), 'h:mm a')}`;
});

const FREQ_LABELS = {
  daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', yearly: 'Yearly',
};

const recurrenceLabel = computed(() => {
  const r = event.value?.recurrence;
  if (!r?.freq) return '';
  let label = FREQ_LABELS[r.freq] ?? r.freq;
  if (r.interval && r.interval > 1) label = `Every ${r.interval} ${r.freq.replace('ly', 's')}`;
  if (r.until) label += ` until ${format(parseISO(r.until), 'MMM d, yyyy')}`;
  return label;
});

function formatDuration(minutes) {
  if (!minutes) return '';
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m ? `${h}h ${m}min` : `${h}h`;
}

function formatReminder(minutes) {
  if (!minutes) return '';
  if (minutes < 60) return `${minutes} minutes before`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (minutes === 60) return '1 hour before';
  if (minutes === 1440) return '1 day before';
  if (minutes % 1440 === 0) return `${minutes / 1440} days before`;
  return m ? `${h}h ${m}min before` : `${h} hours before`;
}

onMounted(async () => {
  loading.value = true;
  try {
    const { data } = await calendarApi.getEvent(route.params.eventId);
    event.value = data;
  } finally {
    loading.value = false;
  }
});
</script>
