import React, { useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { Button, Card } from '../../components/ui';
import { isPurchasesConfigured } from '../../lib/purchases';
import type { RootStackParamList } from '../../navigation/types';
import { colors, spacing } from '../../theme';
import { usePurchase, tierBenefits, recommendedTierKey, priceLine } from './shared';

// Focused conversion sheet the AI-surface nudges open: one recommended tier,
// one CTA. The full catalog stays on ComparePlans ("See all plans").
export default function UpsellSheet() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const route = useRoute<RouteProp<RootStackParamList, 'Upsell'>>();
  const reason = route.params?.reason ?? 'warning';

  const { billing, activation, packagesByTier, busyId, buy } = usePurchase();
  const catalog = billing.data?.catalog ?? [];
  const plan = billing.data?.plan ?? null;
  const recommendedKey = recommendedTierKey(plan);
  const tier = catalog.find((t) => t.key === recommendedKey) ?? null;
  const pkg = recommendedKey ? packagesByTier[recommendedKey]?.[0] ?? null : null;

  // Nothing focused to sell (purchases unconfigured, no matching package, or
  // already on the top tier) → the full catalog is the better destination.
  const loaded = Boolean(billing.data);
  const sellable = Boolean(tier && pkg && isPurchasesConfigured());
  useEffect(() => {
    if (loaded && !sellable) nav.replace('ComparePlans');
  }, [loaded, sellable, nav]);

  if (!loaded || !sellable) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const title =
    reason === 'quota'
      ? "You're out of AI tokens this week"
      : "You're running low on AI tokens";

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>{title}</Text>
      <Text style={styles.subtitle}>
        {reason === 'quota'
          ? `${tier!.label} lifts the wall right away — a fresh pool starts the moment you upgrade.`
          : `${tier!.label} gives you more room before you hit the wall.`}
      </Text>

      {activation.state === 'active' ? (
        <Card style={[styles.card, styles.successCard]}>
          <Ionicons name="checkmark-circle" size={22} color={colors.success} />
          <Text style={styles.successText}>
            You're on {billing.data?.planLabel ?? activation.plan}! Back to what you were doing.
          </Text>
        </Card>
      ) : (
        <Card style={styles.card}>
          <View style={styles.tierHeader}>
            <Text style={styles.tierLabel}>{tier!.label}</Text>
            <Text style={styles.tierPrice}>{priceLine(pkg!)}</Text>
          </View>
          <View style={styles.benefits}>
            {tierBenefits(tier!).map((b) => (
              <View key={b} style={styles.benefitRow}>
                <Ionicons name="checkmark-circle" size={16} color={colors.success} />
                <Text style={styles.benefitText}>{b}</Text>
              </View>
            ))}
          </View>
          <Button
            title={
              activation.state === 'activating'
                ? 'Activating…'
                : `Upgrade to ${tier!.label}`
            }
            loading={busyId === pkg!.identifier || activation.state === 'activating'}
            onPress={() => buy(pkg!)}
          />
        </Card>
      )}
      {activation.state === 'timeout' ? (
        <Text style={styles.timeoutNote}>Payment received — your plan will update shortly.</Text>
      ) : null}

      {activation.state === 'active' ? (
        <Button title="Done" onPress={() => nav.goBack()} />
      ) : (
        <Button title="See all plans" variant="ghost" onPress={() => nav.replace('ComparePlans')} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  title: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  subtitle: { fontSize: 14, color: colors.textMuted, lineHeight: 20, marginBottom: spacing.md },
  card: { marginBottom: spacing.md },

  tierHeader: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  tierLabel: { fontSize: 17, fontWeight: '700', color: colors.text },
  tierPrice: { fontSize: 15, fontWeight: '700', color: colors.primary },
  benefits: { marginTop: spacing.sm, marginBottom: spacing.md, gap: 6 },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  benefitText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },

  successCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderColor: colors.success + '66',
    backgroundColor: colors.success + '14',
  },
  successText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 19 },
  timeoutNote: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginBottom: spacing.md },
});
