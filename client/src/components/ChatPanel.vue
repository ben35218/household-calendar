<template>
  <v-container class="py-6 px-4 d-flex flex-column chat-page">

    <!-- Header -->
    <div class="d-flex align-center mb-4">
      <BackButton variant="tonal" color="primary" />
      <div class="ml-3">
        <h1 class="text-h5 font-weight-bold">{{ title }}</h1>
        <div v-if="subtitle" class="text-caption text-medium-emphasis">{{ subtitle }}</div>
      </div>
      <v-spacer />
      <v-btn
        v-if="chat.messages.value.length > 0"
        variant="text"
        size="small"
        color="medium-emphasis"
        prepend-icon="mdi-delete-sweep-outline"
        :disabled="chat.loading.value"
        @click="chat.clear()"
      >Clear</v-btn>
    </div>

    <!-- Caller-supplied banner (e.g. tasks created) -->
    <slot name="banner" />

    <!-- Free-tier upsell: a smarter assistant is available on paid plans -->
    <v-alert
      v-if="showUpsell"
      type="info"
      variant="tonal"
      density="compact"
      class="mb-3"
      closable
      @click:close="dismissUpsell"
    >
      <div class="d-flex align-center">
        <span class="flex-grow-1 text-body-2">Using the fast assistant. Upgrade for our smartest model and more messages.</span>
        <v-btn size="small" variant="text" color="primary" to="/profile/billing">See plans</v-btn>
      </div>
    </v-alert>

    <!-- "What I can see" context disclosure -->
    <v-expansion-panels v-if="chat.context.value" v-model="contextOpen" class="mb-4 context-panel" flat>
      <v-expansion-panel elevation="0">
        <v-expansion-panel-title class="text-body-2">
          <v-icon size="18" color="primary" class="mr-2">mdi-information-outline</v-icon>
          What I can see &amp; do
        </v-expansion-panel-title>
        <v-expansion-panel-text>
          <div v-if="chat.context.value.sees?.length" class="mb-2">
            <div class="text-caption font-weight-medium text-medium-emphasis mb-1">I can see</div>
            <div v-for="(s, i) in chat.context.value.sees" :key="'s' + i" class="d-flex align-start text-body-2 mb-1">
              <v-icon size="16" color="success" class="mr-2 mt-1">mdi-eye-outline</v-icon>
              <span>{{ s }}</span>
            </div>
          </div>
          <div v-if="chat.context.value.can?.length" class="mb-2">
            <div class="text-caption font-weight-medium text-medium-emphasis mb-1">I can do</div>
            <div v-for="(c, i) in chat.context.value.can" :key="'c' + i" class="d-flex align-start text-body-2 mb-1">
              <v-icon size="16" color="primary" class="mr-2 mt-1">mdi-check-circle-outline</v-icon>
              <span>{{ c }}</span>
            </div>
          </div>
          <div v-if="chat.context.value.note" class="text-caption text-medium-emphasis mt-2">
            {{ chat.context.value.note }}
          </div>
        </v-expansion-panel-text>
      </v-expansion-panel>
    </v-expansion-panels>

    <!-- Messages -->
    <div ref="messagesEl" class="flex-grow-1 overflow-y-auto messages-area">
      <!-- Empty state -->
      <div v-if="chat.messages.value.length === 0 && !chat.streamingText.value" class="text-center text-medium-emphasis mt-8 px-4">
        <v-icon size="52" color="primary" class="mb-3">{{ emptyIcon }}</v-icon>
        <div class="text-body-2">{{ emptyText }}</div>

        <div v-if="chat.suggestedPrompts.value.length" class="d-flex flex-column ga-2 align-center mt-5">
          <div class="text-caption text-medium-emphasis mb-1">Try asking…</div>
          <v-chip
            v-for="(p, i) in chat.suggestedPrompts.value"
            :key="i"
            variant="tonal"
            color="primary"
            class="suggestion-chip"
            @click="chat.send(p)"
          >{{ p }}</v-chip>
        </div>
        <div v-else-if="emptyHint" class="text-caption mt-2">{{ emptyHint }}</div>
      </div>

      <!-- Conversation -->
      <div v-for="(msg, i) in chat.messages.value" :key="i" class="mb-3">
        <div :class="['d-flex', msg.role === 'user' ? 'justify-end' : 'justify-start']">
          <div
            class="chat-bubble text-body-2"
            :class="msg.role === 'user' ? 'bubble-user' : 'bubble-assistant'"
          >
            <span v-if="msg.role === 'user'">{{ msg.content }}</span>
            <div v-else class="markdown-body" v-html="render(msg.content)" />
          </div>
        </div>
      </div>

      <!-- Streaming reply -->
      <div v-if="chat.streamingText.value" class="d-flex justify-start mb-3">
        <div class="chat-bubble bubble-assistant text-body-2">
          <div class="markdown-body" v-html="render(chat.streamingText.value)" />
        </div>
      </div>

      <!-- Thinking / tool activity -->
      <div v-if="chat.loading.value && !chat.streamingText.value" class="d-flex justify-start mb-3">
        <div class="chat-bubble bubble-assistant d-flex align-center ga-2">
          <v-progress-circular size="16" width="2" indeterminate />
          <span v-if="chat.toolActivity.value" class="text-caption text-medium-emphasis">{{ chat.toolActivity.value }}</span>
        </div>
      </div>

      <!-- Follow-up suggestions -->
      <div
        v-if="chat.followups.value.length && !chat.loading.value"
        class="d-flex flex-wrap ga-2 mt-1 mb-3 justify-start"
      >
        <v-chip
          v-for="(f, i) in chat.followups.value"
          :key="i"
          size="small"
          variant="outlined"
          color="primary"
          @click="chat.send(f)"
        >{{ f }}</v-chip>
      </div>

      <!-- Error + retry -->
      <v-alert v-if="chat.error.value" type="error" variant="tonal" density="compact" class="mb-3">
        <div class="d-flex align-center">
          <span class="flex-grow-1">{{ chat.error.value }}</span>
          <v-btn size="small" variant="text" color="error" @click="chat.retry()">Retry</v-btn>
        </div>
      </v-alert>
    </div>

    <!-- Input -->
    <div class="pt-3 chat-input-area">
      <div class="d-flex ga-2 align-end">
        <v-textarea
          v-model="chat.input.value"
          :placeholder="placeholder"
          rows="2"
          auto-grow
          max-rows="4"
          hide-details
          variant="outlined"
          density="compact"
          class="flex-grow-1"
          :disabled="chat.loading.value || disabled"
          @keydown.enter.exact.prevent="chat.send()"
        />
        <v-btn
          icon="mdi-send"
          color="primary"
          :loading="chat.loading.value"
          :disabled="!chat.input.value.trim() || disabled"
          @click="chat.send()"
        />
      </div>
      <div class="text-caption text-medium-emphasis mt-1">Enter to send</div>
    </div>

  </v-container>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted } from 'vue';
import BackButton from './BackButton.vue';
import { renderMarkdown } from '../utils/markdown';
import { billingApi } from '../services/api';

const props = defineProps({
  chat:        { type: Object, required: true },
  title:       { type: String, required: true },
  subtitle:    { type: String, default: '' },
  emptyIcon:   { type: String, default: 'mdi-message-text-outline' },
  emptyText:   { type: String, default: 'Ask me anything.' },
  emptyHint:   { type: String, default: '' },
  placeholder: { type: String, default: 'Type a message…' },
  disabled:    { type: Boolean, default: false },
});

const contextOpen = ref(null);
const messagesEl  = ref(null);

// Free-tier upsell banner. Dismissible per session.
const plan = ref(null);
const upsellDismissed = ref(sessionStorage.getItem('hc_chat_upsell_dismissed') === '1');
const showUpsell = computed(() => plan.value === 'free' && !upsellDismissed.value);
function dismissUpsell() {
  upsellDismissed.value = true;
  sessionStorage.setItem('hc_chat_upsell_dismissed', '1');
}
onMounted(async () => {
  try {
    const { data } = await billingApi.status();
    plan.value = data.plan;
  } catch { /* non-fatal */ }
});

const render = (text) => renderMarkdown(text);

function scrollToBottom() {
  nextTick(() => {
    if (messagesEl.value) messagesEl.value.scrollTop = messagesEl.value.scrollHeight;
  });
}

watch(() => props.chat.messages.value, scrollToBottom, { deep: true });
watch(() => props.chat.streamingText.value, scrollToBottom);
</script>

<style scoped>
.chat-page {
  height: calc(100vh - 64px);
}
.context-panel :deep(.v-expansion-panel) {
  background: rgba(var(--v-theme-primary), .04);
  border-radius: 12px;
}
.messages-area {
  padding-bottom: 8px;
}
.chat-input-area {
  border-top: 1px solid rgba(var(--v-theme-on-surface), .12);
}
.suggestion-chip {
  height: auto;
  white-space: normal;
  padding-top: 6px;
  padding-bottom: 6px;
}
.chat-bubble {
  max-width: 85%;
  padding: 8px 12px;
  border-radius: 12px;
  line-height: 1.5;
  word-break: break-word;
}
.bubble-user {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
  border-bottom-right-radius: 4px;
  white-space: pre-wrap;
}
.bubble-assistant {
  background: rgba(var(--v-theme-on-surface), .08);
  color: inherit;
  border-bottom-left-radius: 4px;
}
.markdown-body :deep(p) {
  margin: 0 0 6px;
}
.markdown-body :deep(p:last-child) {
  margin-bottom: 0;
}
.markdown-body :deep(ul),
.markdown-body :deep(ol) {
  margin: 4px 0;
  padding-left: 20px;
}
.markdown-body :deep(code) {
  background: rgba(var(--v-theme-on-surface), .12);
  padding: 1px 5px;
  border-radius: 4px;
  font-size: .85em;
}
.markdown-body :deep(a) {
  color: rgb(var(--v-theme-primary));
}
</style>
