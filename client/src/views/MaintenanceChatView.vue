<template>
  <ChatPanel
    :chat="chat"
    title="Maintenance Assistant"
    :subtitle="itemName"
    :disabled="!!loadError"
    empty-icon="mdi-wrench-cog"
    empty-text="Chat with your maintenance assistant to set up tasks for this item."
    empty-hint="e.g. &quot;What maintenance does my HVAC system need?&quot;"
    placeholder="Ask about maintenance tasks…"
  >
    <template #banner>
      <v-alert v-if="loadError" type="error" variant="tonal" class="mb-4">{{ loadError }}</v-alert>

      <v-alert
        v-if="createdTasks.length > 0"
        type="success"
        variant="tonal"
        class="mb-4"
        closable
        @click:close="createdTasks = []"
      >
        <div class="font-weight-medium mb-1">{{ createdTasks.length }} task{{ createdTasks.length > 1 ? 's' : '' }} added</div>
        <div v-for="t in createdTasks" :key="t.id" class="text-caption">• {{ t.title }}</div>
      </v-alert>
    </template>
  </ChatPanel>
</template>

<script setup>
import { ref, onMounted } from 'vue';
import { useRoute } from 'vue-router';
import ChatPanel from '../components/ChatPanel.vue';
import { useChat } from '../composables/useChat';
import { itemsApi } from '../services/api';

const route  = useRoute();
const itemId = route.params.id;

const itemName     = ref('');
const loadError    = ref('');
const createdTasks = ref([]);

const chat = useChat({
  endpoint: '/api/maintenance/chat',
  contextEndpoint: `/api/maintenance/chat/context?itemId=${itemId}`,
  storageKey: `household-copilot-maint-chat-${itemId}`,
  buildBody: (messages) => ({ itemId, messages }),
  onResult: (data) => {
    if (data.tasksCreated?.length) createdTasks.value = createdTasks.value.concat(data.tasksCreated);
  },
  toolLabels: {
    get_item_tasks: 'Reviewing existing tasks…',
    get_categories: 'Loading categories…',
    create_tasks: 'Adding tasks…',
  },
});

onMounted(async () => {
  try {
    const { data } = await itemsApi.get(itemId);
    itemName.value = data.name;
  } catch {
    loadError.value = 'Item not found.';
    return;
  }
  chat.loadContext();
});
</script>
