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
import { itemsApi, tasksApi, householdApi } from '../services/api';
import { getHDK, openRecord, sealNew } from '../services/e2ee';

const route  = useRoute();
const itemId = route.params.id;

// Encrypted maintenance-task content (mirrors TaskFormView).
const TASK_ENC = (p) => ({
  title: p.title, description: p.description, instructions: p.instructions,
  estimatedCost: p.estimatedCost, estimatedDurationMins: p.estimatedDurationMins,
});

const itemName     = ref('');
const loadError    = ref('');
const createdTasks = ref([]);
// Ephemeral-consent (§9.1 P4a): post-drop, send the decrypted item so the server
// needn't read stored plaintext for the system prompt. Dormant pre-drop.
const ephemeral    = ref(null);

const chat = useChat({
  endpoint: '/api/maintenance/chat',
  contextEndpoint: `/api/maintenance/chat/context?itemId=${itemId}`,
  storageKey: `household-calendar-maint-chat-${itemId}`,
  buildBody: (messages) => ({ itemId, messages, ...(ephemeral.value || {}) }),
  onResult: async (data) => {
    // Post-drop the server hands back proposed tasks for the client to create
    // *encrypted* (§9.1 P4d); pre-drop the server already created them.
    if (data.clientCreateTasks?.length) {
      const created = [];
      for (const p of data.clientCreateTasks) {
        try {
          const payload = {
            itemId, title: p.title, description: p.description,
            recurrence: p.recurrence, nextDueDate: p.nextDueDate,
            priority: p.priority, categoryId: p.categoryId, subcategoryId: p.subcategoryId,
          };
          const { data: t } = await tasksApi.create(await sealNew('MaintenanceTask', payload, TASK_ENC(payload)));
          created.push({ id: t._id, title: p.title });
        } catch { /* skip a failed task, keep the rest */ }
      }
      createdTasks.value = createdTasks.value.concat(created);
    } else if (data.tasksCreated?.length) {
      createdTasks.value = createdTasks.value.concat(data.tasksCreated);
    }
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
    const item = await openRecord('Item', data);
    itemName.value = item.name;
    let e2eeActive = false;
    try { e2eeActive = !!(await householdApi.get()).data.e2eeActive; } catch { /* solo/offline */ }
    if (e2eeActive && getHDK()) {
      const tasks = await tasksApi.list({ item: itemId })
        .then(({ data }) => Promise.all(data.map((t) => openRecord('MaintenanceTask', t))))
        .catch(() => []);
      ephemeral.value = { item, tasks };
    }
  } catch {
    loadError.value = 'Item not found.';
    return;
  }
  chat.loadContext();
});
</script>
