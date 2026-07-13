import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import type { RootStackParamList } from '../navigation/types';
import { colors, radius, spacing } from '../theme';

// Rendered in place of an error/retry row when a request came back 402
// (weekly AI budget spent). Retrying is futile until the Wednesday reset, so
// the only useful action is the upgrade path. Companion to AiUsageBanner,
// which warns *before* the wall; this is the wall itself.
export default function QuotaBlockedNotice({ message }: { message?: string }) {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  return (
    <View style={styles.wrap}>
      <Ionicons name="alert-circle" size={18} color={colors.error} />
      <Text style={styles.text}>
        {message || 'You’ve used this week’s AI budget. It resets Wednesday.'}
      </Text>
      <TouchableOpacity
        onPress={() => nav.navigate('Upsell', { reason: 'quota' })}
        accessibilityRole="button"
        accessibilityLabel="See plans — open the upgrade sheet"
      >
        <Text style={styles.cta}>See plans</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.error + '55',
    backgroundColor: colors.error + '1A',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  text: { flex: 1, fontSize: 13, lineHeight: 17, color: colors.text },
  cta: { color: colors.error, fontSize: 13, fontWeight: '700', textDecorationLine: 'underline' },
});
