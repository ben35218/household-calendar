import React from 'react';
import { Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { billingApi } from '../api';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing } from '../theme';

// Warn once the household/user has burned this share of its weekly AI token
// budget. Deliberately below 100 so people get a heads-up while they still have
// room, rather than only finding out when a prompt is refused.
const WARN_AT = 80;

// A tappable heads-up rendered inside the AI assistants once weekly token usage
// crosses WARN_AT. Tapping it opens the Plan screen (Paywall). Renders nothing
// on unlimited plans or below the threshold, so it's a no-op for most sessions.
//
// Important: this only *informs*. Usage never hard-blocks a prompt below 100%,
// and even the prompt that crosses 100% still runs to completion server-side —
// the block only applies to the NEXT prompt after the budget is spent. So a user
// sitting at 92% can still send their next message; this banner just makes the
// remaining budget (and the upgrade path) visible before they hit the wall.
export default function AiUsageBanner() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { data } = useQuery({
    queryKey: ['billing', 'status'],
    queryFn: async () => (await billingApi.status()).data,
    staleTime: 60_000,
  });

  const limit = data?.weeklyTokenLimit ?? null;
  const pct = data?.tokenPct ?? 0;
  if (limit == null || pct < WARN_AT) return null; // unlimited plan or plenty left

  // pct is server-capped at 100 even when raw usage runs over, so the message
  // reads "100%" once the budget is fully spent.
  const over = pct >= 100;
  const message = over
    ? 'You’ve used all your AI tokens for the week. Tap to see your plan.'
    : `You’ve used ${pct}% of your AI tokens for the week. Tap to see your plan.`;

  return (
    <TouchableOpacity
      style={[styles.wrap, over ? styles.over : styles.warn]}
      onPress={() => nav.navigate('Paywall')}
      activeOpacity={0.7}
      accessibilityRole="button"
      accessibilityLabel={message}
    >
      <Ionicons
        name={over ? 'alert-circle' : 'warning-outline'}
        size={18}
        color={over ? colors.error : colors.warning}
      />
      <Text style={[styles.text, over ? styles.textOver : styles.textWarn]}>{message}</Text>
      <Ionicons name="chevron-forward" size={16} color={over ? colors.error : colors.warning} />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  warn: { backgroundColor: colors.warning + '1A', borderColor: colors.warning + '55' },
  over: { backgroundColor: colors.error + '1A', borderColor: colors.error + '55' },
  text: { flex: 1, fontSize: 13, fontWeight: '600', lineHeight: 17 },
  textWarn: { color: colors.text },
  textOver: { color: colors.error },
});
