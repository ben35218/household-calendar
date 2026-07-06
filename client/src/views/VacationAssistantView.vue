<template>
  <ChatPanel
    :chat="chat"
    title="Vacation Assistant"
    :subtitle="tripName"
    empty-icon="mdi-bag-suitcase"
    empty-text="Ask me about this trip — your itinerary, costs, or what's left to plan."
    empty-hint="e.g. &quot;What's my itinerary?&quot;"
    placeholder="Ask about this trip…"
  />
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import ChatPanel from '../components/ChatPanel.vue';
import { useChat } from '../composables/useChat';
import { tripsApi, householdApi } from '../services/api';
import { getHDK, openRecord } from '../services/e2ee';

const route  = useRoute();
const router = useRouter();
const tripId = route.params.id;

const tripName = ref('');
// Ephemeral-consent (§9.1 P4a): post-drop the server can't read trip content, so
// send the decrypted trip + itinerary per request. Dormant pre-drop (e2eeActive
// false / locked) — the server falls back to its own DB read.
const ephemeral = ref(null);

const chat = useChat({
  endpoint: '/api/vacation/chat',
  contextEndpoint: `/api/vacation/chat/context?tripId=${tripId}`,
  storageKey: `household-calendar-vacation-chat-${tripId}`,
  buildBody: (messages) => ({ tripId, messages, ...(ephemeral.value || {}) }),
  onResult: (data) => {
    if (data.navigateTo) setTimeout(() => router.push(data.navigateTo), 1200);
  },
  toolLabels: {
    open_trip: 'Opening the trip…',
    open_add_booking: 'Opening the booking form…',
  },
});

onMounted(async () => {
  try {
    const { data } = await tripsApi.get(tripId);
    const trip = await openRecord('Trip', data.trip ?? data);
    tripName.value = trip.name;
    let e2eeActive = false;
    try { e2eeActive = !!(await householdApi.get()).data.e2eeActive; } catch { /* solo/offline */ }
    if (e2eeActive && getHDK()) {
      const items = await Promise.all((data.items ?? []).map((i) => openRecord('TripItem', i)));
      ephemeral.value = { trip, items };
    }
  } catch { /* non-fatal */ }
  chat.loadContext();
});
</script>
