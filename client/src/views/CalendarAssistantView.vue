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
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import ChatPanel from '../components/ChatPanel.vue';
import { useChat } from '../composables/useChat';

const router = useRouter();

const chat = useChat({
  endpoint: '/api/calendar/chat',
  contextEndpoint: '/api/calendar/chat/context',
  storageKey: 'household-calendar-chat-history',
  buildBody: (messages) => ({ messages }),
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

onMounted(() => chat.loadContext());
</script>
