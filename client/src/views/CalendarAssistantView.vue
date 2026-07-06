<template>
  <ChatPanel
    :chat="chat"
    title="Calendar Assistant"
    empty-icon="mdi-calendar-edit"
    empty-text="Ask me to add appointments, activities, or changes to your calendar."
    empty-hint="e.g. &quot;Add a dentist appointment on June 20&quot;"
    placeholder="Add a dentist appointment on June 20…"
  />
</template>

<script setup>
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import ChatPanel from '../components/ChatPanel.vue';
import { useChat } from '../composables/useChat';
import { peopleApi, householdApi } from '../services/api';
import { getHDK, openRecord } from '../services/e2ee';
import { loadCalendarSources } from '../services/calendarData';
import { loadForecast } from '../services/weather';

const router = useRouter();

// Ephemeral-consent (§9.1 P4c): post-drop send the decrypted people (system
// prompt) + calendar sources (list_events/call_business) so the server needn't
// read stored plaintext. Dormant pre-drop (e2eeActive false / locked).
const ephemeral = ref(null);

const chat = useChat({
  endpoint: '/api/calendar/chat',
  contextEndpoint: '/api/calendar/chat/context',
  storageKey: 'household-calendar-chat-history',
  buildBody: (messages) => ({ messages, ...(ephemeral.value || {}) }),
  onResult: (data) => {
    if (data.navigateTo) setTimeout(() => router.push(data.navigateTo), 1200);
  },
  toolLabels: {
    list_events: 'Checking your calendar…',
    open_create_event_form: 'Opening the event form…',
    open_edit_event_form: 'Opening the event…',
    open_delete_event_form: 'Opening the event…',
    call_business: 'Placing the call…',
    check_call_status: 'Checking the call…',
    get_weather_forecast: 'Checking the weather…',
  },
});

onMounted(async () => {
  chat.loadContext();
  try {
    let e2eeActive = false;
    try { e2eeActive = !!(await householdApi.get()).data.e2eeActive; } catch { /* solo/offline */ }
    if (!e2eeActive || !getHDK()) return;
    // A wide window so the model can query most reasonable ranges from the
    // supplied sources (recurring items expand per-range from their raw records).
    const now = new Date();
    const from = new Date(now.getFullYear() - 1, 0, 1).toISOString();
    const to   = new Date(now.getFullYear() + 2, 0, 1).toISOString();
    const [calendarSources, peopleRows, weather] = await Promise.all([
      loadCalendarSources({ from, to }),
      peopleApi.list().then(({ data }) => Promise.all(data.map((p) => openRecord('Person', p)))),
      loadForecast().catch(() => null),
    ]);
    ephemeral.value = { people: peopleRows, calendarSources, ...(weather ? { weather } : {}) };
  } catch { /* non-fatal — server falls back to its DB read */ }
});
</script>
