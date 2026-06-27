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
import { tripsApi } from '../services/api';

const route  = useRoute();
const router = useRouter();
const tripId = route.params.id;

const tripName = ref('');

const chat = useChat({
  endpoint: '/api/vacation/chat',
  contextEndpoint: `/api/vacation/chat/context?tripId=${tripId}`,
  storageKey: `household-calendar-vacation-chat-${tripId}`,
  buildBody: (messages) => ({ tripId, messages }),
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
    tripName.value = data.name;
  } catch { /* non-fatal */ }
  chat.loadContext();
});
</script>
