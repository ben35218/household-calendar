import React from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useBilling } from '../../hooks/useBilling';
import { Card } from '../../components/ui';
import { colors, spacing, radius } from '../../theme';
import { describeReset, humanTokens } from './shared';

// Friendly labels for the per-action analytics counters the server tracks.
const ACTION_LABEL: Record<string, string> = {
  chat: 'Chat & assistants',
  scan: 'Receipt & photo scans',
  generation: 'Recipe & plan generation',
  manualParse: 'Imports & parsing',
  aiHelper: 'Form assist',
};

// Usage drill-in from the Plan hub: the full gauge plus the two breakdowns the
// hub summary doesn't show — per member (shared pool) and per feature.
export default function AiUsageScreen() {
  const { data } = useBilling();

  if (!data) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const unlimited = data.weeklyTokenLimit == null;
  const over = !unlimited && data.tokensUsed >= (data.weeklyTokenLimit ?? 0);
  const reset = describeReset(data.resetsAt);
  const members = data.members ?? [];
  const maxMemberTokens = Math.max(...members.map((m) => m.tokens), 1);
  const actions = Object.entries(data.usage ?? {}).filter(([, count]) => Number(count) > 0);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <Text style={styles.heading}>
          {data.usageScope === 'household' ? "Household's AI usage this week" : 'Your AI usage this week'}
        </Text>
        {reset ? <Text style={styles.reset}>{reset}</Text> : null}
        <View style={styles.gaugeHeader}>
          <Text style={styles.gaugePct}>{unlimited ? 'Unlimited' : `${data.tokenPct}%`}</Text>
          <Text style={styles.gaugeCaption}>
            {unlimited ? `${humanTokens(data.tokensUsed)} tokens used` : 'used'}
          </Text>
        </View>
        {!unlimited ? (
          <View style={styles.track}>
            <View
              style={[
                styles.fill,
                { width: `${data.tokenPct}%`, backgroundColor: over ? colors.error : colors.primary },
              ]}
            />
          </View>
        ) : null}
        {over ? (
          <Text style={styles.overNote}>You've reached your weekly AI limit. Upgrade for more.</Text>
        ) : null}
        <Text style={styles.scopeNoteBelow}>
          {data.usageScope === 'household'
            ? 'Shared across everyone in your household.'
            : 'On the free plan each person has their own weekly allowance.'}
        </Text>
      </Card>

      {members.length > 0 ? (
        <Card style={styles.card}>
          <Text style={styles.heading}>By member</Text>
          <Text style={styles.scopeNote}>Who's used the shared pool this week.</Text>
          {members.map((m) => (
            <View key={m.userId} style={styles.memberRow}>
              <View style={styles.memberHeader}>
                <Text style={styles.memberName} numberOfLines={1}>
                  {m.name || 'Member'}
                </Text>
                <Text style={styles.memberTokens}>{humanTokens(m.tokens) ?? '0'} tokens</Text>
              </View>
              <View style={styles.track}>
                <View
                  style={[
                    styles.fill,
                    { width: `${Math.round((m.tokens / maxMemberTokens) * 100)}%`, backgroundColor: colors.primary },
                  ]}
                />
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {actions.length > 0 ? (
        <Card style={styles.card}>
          <Text style={styles.heading}>By feature</Text>
          <Text style={styles.scopeNote}>AI actions this week, by feature area.</Text>
          {actions.map(([action, count]) => (
            <View key={action} style={styles.actionRow}>
              <Text style={styles.actionLabel}>{ACTION_LABEL[action] ?? action}</Text>
              <Text style={styles.actionCount}>{count}</Text>
            </View>
          ))}
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  card: { marginBottom: spacing.md },

  heading: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: 2 },
  scopeNote: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm },
  scopeNoteBelow: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm },
  reset: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm },
  gaugeHeader: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginBottom: 6 },
  gaugePct: { fontSize: 28, fontWeight: '700', color: colors.text },
  gaugeCaption: { fontSize: 13, color: colors.textMuted },
  track: { height: 6, borderRadius: radius.sm, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 6, borderRadius: radius.sm },
  overNote: { fontSize: 12, color: colors.error, marginTop: 6 },

  memberRow: { marginTop: spacing.sm },
  memberHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 },
  memberName: { flex: 1, fontSize: 14, fontWeight: '600', color: colors.text, marginRight: spacing.sm },
  memberTokens: { fontSize: 12, color: colors.textMuted },

  actionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  actionLabel: { fontSize: 14, color: colors.text },
  actionCount: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
});
