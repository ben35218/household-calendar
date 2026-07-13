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
  Alert,
  StyleSheet,
} from 'react-native';
import { moderationApi } from '../../api';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, radius, spacing } from '../../theme';
import { flattenMarkdown } from '../../lib/markdown';
import { formatCompact } from '../../lib/format';
import { usePrivacyPrefs } from '../../lib/privacyPrefs';
import QuotaBlockedNotice from '../../components/QuotaBlockedNotice';
import AssistantIcon from '../../components/AssistantIcon';
import type { ChatController } from '../../hooks/useChat';

// Reusable assistant chat UI. Ports client/src/components/ChatPanel.vue. Each
// assistant (calendar / maintenance / vacation) supplies a `chat` controller
// from useChat plus its empty-state copy; the nav header owns the title and the
// Clear action.
export default function ChatScreen({
  chat,
  accessory,
  emptyText,
  emptyHint,
  placeholder = 'Type a message…',
  disabled = false,
  banner,
  onFollowupPress,
  surface = 'assistant',
}: {
  chat: ChatController;
  // Domain badge on Calvin in the empty state (wrench, calendar, suitcase, …).
  accessory?: keyof typeof MaterialCommunityIcons.glyphMap;
  emptyText: string;
  emptyHint?: string;
  placeholder?: string;
  disabled?: boolean;
  banner?: React.ReactNode;
  // Which assistant this is, tagged on any content report (Apple 1.2).
  surface?: string;
  // Intercept a follow-up chip tap. Return true if handled (e.g. a client-side
  // action like saving an event); otherwise the chip text is sent to the chat.
  onFollowupPress?: (text: string) => boolean;
}) {
  const scrollRef = useRef<ScrollView>(null);
  const [contextOpen, setContextOpen] = useState(false);
  const insets = useSafeAreaInsets();
  const aiEnabled = usePrivacyPrefs().prefs.aiEnabled;
  const scrollToEnd = () => scrollRef.current?.scrollToEnd({ animated: true });

  const empty = chat.messages.length === 0 && !chat.streamingText;

  // Report objectionable AI output (Apple 1.2). Long-press any assistant reply.
  function reportMessage(content: string) {
    Alert.alert(
      'Report this message?',
      'This sends the message to our team to review. Thanks for helping keep the assistant safe.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Report',
          style: 'destructive',
          onPress: () => {
            moderationApi
              .report({ content, surface })
              .then(() => Alert.alert('Reported', 'Thanks — we’ll review this message.'))
              .catch(() => Alert.alert('Couldn’t send report', 'Please try again.'));
          },
        },
      ],
    );
  }

  // Master switch (Phase 5): with AI off in Privacy settings the assistant is
  // unusable and nothing is ever sent to the provider — same guarantee FormAssist
  // gives. Mirrors the "panel doesn't render" behavior for a full-screen surface.
  if (!aiEnabled) {
    return (
      <View style={styles.disabledWrap}>
        <MaterialCommunityIcons name="robot-off-outline" size={48} color={colors.textMuted} />
        <Text style={styles.disabledTitle}>AI features are turned off</Text>
        <Text style={styles.disabledText}>
          Turn on “AI features” in Profile → Privacy to use the assistant.
        </Text>
      </View>
    );
  }

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
            <AssistantIcon size={52} color={colors.primary} accessory={accessory} />
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
          <View key={i}>
            <View style={[styles.row, msg.role === 'user' ? styles.rowRight : styles.rowLeft]}>
              {msg.role === 'user' ? (
                <View style={[styles.bubble, styles.bubbleUser]}>
                  <Text style={styles.bubbleUserText}>{msg.content}</Text>
                </View>
              ) : (
                <TouchableOpacity
                  style={[styles.bubble, styles.bubbleAssistant]}
                  activeOpacity={0.8}
                  onLongPress={() => reportMessage(msg.content)}
                  delayLongPress={400}
                  accessibilityHint="Long-press to report this message"
                >
                  <Text style={styles.bubbleAssistantText}>{flattenMarkdown(msg.content)}</Text>
                </TouchableOpacity>
              )}
            </View>
            {msg.role === 'assistant' && msg.tokens ? (
              <Text style={styles.tokenMeta}>{formatCompact(msg.tokens)} tokens</Text>
            ) : null}
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
              <TouchableOpacity
                key={i}
                style={styles.followupChip}
                onPress={() => {
                  if (!onFollowupPress?.(f)) chat.send(f);
                }}
                disabled={disabled}
              >
                <Text style={styles.followupChipText}>{f}</Text>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {/* Error + retry. Over quota, retrying is futile — offer the upgrade
            path (Plan screen) instead. */}
        {chat.error ? (
          chat.quotaExceeded ? (
            <QuotaBlockedNotice message={chat.error} />
          ) : (
            <View style={styles.errorBox}>
              <Text style={styles.errorText}>{chat.error}</Text>
              <TouchableOpacity onPress={() => chat.retry()}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )
        ) : null}
      </ScrollView>

      {/* Input */}
      <View style={[styles.inputBar, { paddingBottom: spacing.sm + insets.bottom }]}>
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
  disabledWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl, gap: spacing.sm, backgroundColor: colors.background },
  disabledTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginTop: spacing.sm },
  disabledText: { fontSize: 13, color: colors.textMuted, textAlign: 'center', lineHeight: 19 },
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
  tokenMeta: { fontSize: 11, color: colors.textMuted, marginTop: -2, marginBottom: spacing.sm, marginLeft: 4 },
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
