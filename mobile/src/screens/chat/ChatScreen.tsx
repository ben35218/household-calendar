import React, { useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  ScrollView,
  TouchableOpacity,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
  StyleSheet,
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../../theme';
import { flattenMarkdown } from '../../lib/markdown';
import type { ChatController } from '../../hooks/useChat';

// Reusable assistant chat UI. Ports client/src/components/ChatPanel.vue. Each
// assistant (calendar / maintenance / vacation) supplies a `chat` controller
// from useChat plus its empty-state copy; the nav header owns the title and the
// Clear action.
export default function ChatScreen({
  chat,
  emptyIcon = 'message-text-outline',
  emptyText,
  emptyHint,
  placeholder = 'Type a message…',
  disabled = false,
  banner,
}: {
  chat: ChatController;
  emptyIcon?: keyof typeof MaterialCommunityIcons.glyphMap;
  emptyText: string;
  emptyHint?: string;
  placeholder?: string;
  disabled?: boolean;
  banner?: React.ReactNode;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const scrollToEnd = () => scrollRef.current?.scrollToEnd({ animated: true });

  const empty = chat.messages.length === 0 && !chat.streamingText;

  return (
    <KeyboardAvoidingView
      style={styles.flex}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={Platform.OS === 'ios' ? 92 : 0}
    >
      <ScrollView
        ref={scrollRef}
        style={styles.flex}
        contentContainerStyle={styles.scrollContent}
        onContentSizeChange={scrollToEnd}
        keyboardShouldPersistTaps="handled"
      >
        {banner}

        {/* "What I can see & do" disclosure */}
        {chat.context ? (
          <View style={styles.contextCard}>
            <TouchableOpacity style={styles.contextHeader} onPress={() => setContextOpen((o) => !o)}>
              <Ionicons name="information-circle-outline" size={18} color={colors.primary} />
              <Text style={styles.contextTitle}>What I can see &amp; do</Text>
              <Ionicons
                name={contextOpen ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.textMuted}
              />
            </TouchableOpacity>
            {contextOpen ? (
              <View style={styles.contextBody}>
                {chat.context.sees?.length ? (
                  <>
                    <Text style={styles.contextLabel}>I can see</Text>
                    {chat.context.sees.map((s, i) => (
                      <Text key={`s${i}`} style={styles.contextLine}>
                        • {s}
                      </Text>
                    ))}
                  </>
                ) : null}
                {chat.context.can?.length ? (
                  <>
                    <Text style={styles.contextLabel}>I can do</Text>
                    {chat.context.can.map((c, i) => (
                      <Text key={`c${i}`} style={styles.contextLine}>
                        • {c}
                      </Text>
                    ))}
                  </>
                ) : null}
                {chat.context.note ? <Text style={styles.contextNote}>{chat.context.note}</Text> : null}
              </View>
            ) : null}
          </View>
        ) : null}

        {/* Empty state + suggested prompts */}
        {empty ? (
          <View style={styles.emptyWrap}>
            <MaterialCommunityIcons name={emptyIcon} size={52} color={colors.primary} />
            <Text style={styles.emptyText}>{emptyText}</Text>
            {chat.suggestedPrompts.length ? (
              <View style={styles.suggestions}>
                <Text style={styles.suggestLabel}>Try asking…</Text>
                {chat.suggestedPrompts.map((p, i) => (
                  <TouchableOpacity
                    key={i}
                    style={styles.suggestChip}
                    onPress={() => chat.send(p)}
                    disabled={disabled}
                  >
                    <Text style={styles.suggestChipText}>{p}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            ) : emptyHint ? (
              <Text style={styles.emptyHint}>{emptyHint}</Text>
            ) : null}
          </View>
        ) : null}

        {/* Conversation */}
        {chat.messages.map((msg, i) => (
          <View
            key={i}
            style={[styles.row, msg.role === 'user' ? styles.rowRight : styles.rowLeft]}
          >
            <View style={[styles.bubble, msg.role === 'user' ? styles.bubbleUser : styles.bubbleAssistant]}>
              <Text style={msg.role === 'user' ? styles.bubbleUserText : styles.bubbleAssistantText}>
                {msg.role === 'user' ? msg.content : flattenMarkdown(msg.content)}
              </Text>
            </View>
          </View>
        ))}

        {/* Streaming reply */}
        {chat.streamingText ? (
          <View style={[styles.row, styles.rowLeft]}>
            <View style={[styles.bubble, styles.bubbleAssistant]}>
              <Text style={styles.bubbleAssistantText}>{flattenMarkdown(chat.streamingText)}</Text>
            </View>
          </View>
        ) : null}

        {/* Thinking / tool activity */}
        {chat.loading && !chat.streamingText ? (
          <View style={[styles.row, styles.rowLeft]}>
            <View style={[styles.bubble, styles.bubbleAssistant, styles.thinking]}>
              <ActivityIndicator size="small" color={colors.primary} />
              {chat.toolActivity ? <Text style={styles.thinkingText}>{chat.toolActivity}</Text> : null}
            </View>
          </View>
        ) : null}

        {/* Follow-up suggestions */}
        {chat.followups.length && !chat.loading ? (
          <View style={styles.followups}>
            {chat.followups.map((f, i) => (
              <TouchableOpacity key={i} style={styles.followupChip} onPress={() => chat.send(f)} disabled={disabled}>
                <Text style={styles.followupChipText}>{f}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {/* Error + retry */}
        {chat.error ? (
          <View style={styles.errorBox}>
            <Text style={styles.errorText}>{chat.error}</Text>
            <TouchableOpacity onPress={() => chat.retry()}>
              <Text style={styles.retryText}>Retry</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>

      {/* Input */}
      <View style={styles.inputBar}>
        <TextInput
          style={styles.textInput}
          value={chat.input}
          onChangeText={chat.setInput}
          placeholder={placeholder}
          placeholderTextColor={colors.textMuted}
          multiline
          editable={!disabled}
        />
        <TouchableOpacity
          style={[styles.sendBtn, (!chat.input.trim() || disabled || chat.loading) && styles.sendBtnDisabled]}
          onPress={() => chat.send()}
          disabled={!chat.input.trim() || disabled || chat.loading}
        >
          {chat.loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Ionicons name="send" size={18} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1, backgroundColor: colors.background },
  scrollContent: { padding: spacing.md, paddingBottom: spacing.lg },
  contextCard: {
    backgroundColor: colors.primary + '0D',
    borderRadius: radius.md,
    marginBottom: spacing.md,
  },
  contextHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.md },
  contextTitle: { flex: 1, fontSize: 14, color: colors.text, fontWeight: '600' },
  contextBody: { paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  contextLabel: { fontSize: 12, fontWeight: '700', color: colors.textMuted, marginTop: spacing.sm, marginBottom: 4 },
  contextLine: { fontSize: 13, color: colors.text, marginBottom: 3 },
  contextNote: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm },
  emptyWrap: { alignItems: 'center', paddingTop: spacing.xl, paddingHorizontal: spacing.md },
  emptyText: { fontSize: 14, color: colors.textMuted, textAlign: 'center', marginTop: spacing.md },
  emptyHint: { fontSize: 12, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
  suggestions: { alignItems: 'center', marginTop: spacing.lg, gap: spacing.sm, alignSelf: 'stretch' },
  suggestLabel: { fontSize: 12, color: colors.textMuted, marginBottom: 2 },
  suggestChip: {
    backgroundColor: colors.primary + '1A',
    borderRadius: radius.md,
    paddingVertical: 8,
    paddingHorizontal: 14,
  },
  suggestChipText: { color: colors.primary, fontSize: 13, fontWeight: '600', textAlign: 'center' },
  row: { flexDirection: 'row', marginBottom: spacing.sm },
  rowLeft: { justifyContent: 'flex-start' },
  rowRight: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '85%', paddingVertical: 8, paddingHorizontal: 12, borderRadius: 12 },
  bubbleUser: { backgroundColor: colors.primary, borderBottomRightRadius: 4 },
  bubbleAssistant: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, borderBottomLeftRadius: 4 },
  bubbleUserText: { color: '#fff', fontSize: 14, lineHeight: 21 },
  bubbleAssistantText: { color: colors.text, fontSize: 14, lineHeight: 21 },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  thinkingText: { fontSize: 13, color: colors.textMuted },
  followups: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  followupChip: {
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 999,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  followupChipText: { color: colors.primary, fontSize: 13, fontWeight: '500' },
  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.error + '1A',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  errorText: { flex: 1, color: colors.error, fontSize: 13 },
  retryText: { color: colors.error, fontWeight: '700', fontSize: 13, paddingLeft: spacing.sm },
  inputBar: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: spacing.sm,
    padding: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  textInput: {
    flex: 1,
    maxHeight: 120,
    backgroundColor: colors.background,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 15,
    color: colors.text,
  },
  sendBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: { opacity: 0.5 },
});
