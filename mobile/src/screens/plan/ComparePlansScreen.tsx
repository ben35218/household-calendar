import React, { useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Linking,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { PurchasesPackage } from 'react-native-purchases';
import { Badge, Button, Card, Chip } from '../../components/ui';
import { isPurchasesConfigured } from '../../lib/purchases';
import { TERMS_URL, PRIVACY_URL } from '../../config';
import { colors, spacing } from '../../theme';
import {
  usePurchase,
  tierBenefits,
  recommendedTierKey,
  priceLine,
  PERIOD_LABEL,
  type CatalogTier,
} from './shared';

// The paywall proper: tier catalog + purchase CTAs. Apple requires the restore
// button and legal links near the purchase CTAs, so they live here (the Plan
// hub duplicates restore for convenience).
export default function ComparePlansScreen() {
  const { billing, activation, packagesByTier, orphanPackages, busyId, buy, restore } =
    usePurchase();
  // Chosen package per tier when a tier has several billing periods.
  const [pickedByTier, setPickedByTier] = useState<Record<string, string>>({});

  const catalog = billing.data?.catalog ?? [];
  const currentPlan = billing.data?.plan ?? null;
  const currentRank = catalog.findIndex((t) => t.key === currentPlan);
  const recommendedKey = recommendedTierKey(currentPlan);

  function renderTierCard(tier: CatalogTier, rank: number) {
    const isCurrent = tier.key === currentPlan;
    const isRecommended = tier.key === recommendedKey;
    const isUpgrade = currentRank >= 0 && rank > currentRank;
    const tierPackages = packagesByTier[tier.key] ?? [];
    const picked =
      tierPackages.find((p) => p.identifier === pickedByTier[tier.key]) ?? tierPackages[0] ?? null;

    return (
      <Card key={tier.key} style={styles.tierCard}>
        <View style={styles.tierHeader}>
          <Text style={styles.tierLabel}>{tier.label}</Text>
          {isCurrent ? <Badge label="Current plan" color={colors.success} /> : null}
          {!isCurrent && isRecommended ? <Badge label="Most popular" color={colors.primary} /> : null}
        </View>
        {/* Price only from the store (localized). No package = nothing to buy,
            so no fabricated USD price. */}
        {tier.key === 'free' ? (
          <Text style={styles.tierPrice}>Free</Text>
        ) : picked ? (
          <>
            <Text style={styles.tierPrice}>{priceLine(picked)}</Text>
            <Text style={styles.cancelNote}>Cancel anytime.</Text>
          </>
        ) : null}

        <View style={styles.benefits}>
          {tierBenefits(tier).map((b) => (
            <View key={b} style={styles.benefitRow}>
              <Ionicons name="checkmark-circle" size={16} color={colors.success} />
              <Text style={styles.benefitText}>{b}</Text>
            </View>
          ))}
        </View>

        {tierPackages.length > 1 ? (
          <View style={styles.periodRow}>
            {tierPackages.map((p) => (
              <Chip
                key={p.identifier}
                label={PERIOD_LABEL[p.packageType] ?? p.product.priceString}
                selected={picked?.identifier === p.identifier}
                onPress={() => setPickedByTier((prev) => ({ ...prev, [tier.key]: p.identifier }))}
              />
            ))}
          </View>
        ) : null}

        {/* CTAs only point upward; downgrades/cancellations go through the
            store's own subscription management. */}
        {isUpgrade ? (
          picked ? (
            <Button
              title="Upgrade"
              loading={busyId === picked.identifier}
              onPress={() => buy(picked)}
            />
          ) : (
            <Button title="Purchases coming soon" disabled onPress={() => {}} />
          )
        ) : null}
      </Card>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {activation.state === 'activating' ? (
        <Card style={[styles.card, styles.activationCard]}>
          <ActivityIndicator color={colors.primary} />
          <Text style={styles.activationText}>Activating your plan…</Text>
        </Card>
      ) : null}
      {activation.state === 'active' ? (
        <Card style={[styles.card, styles.successCard]}>
          <Ionicons name="checkmark-circle" size={22} color={colors.success} />
          <Text style={styles.successText}>
            You're on {billing.data?.planLabel ?? activation.plan}!{' '}
            {billing.data?.usageScope === 'household'
              ? 'Your household now shares one AI pool.'
              : 'Thanks for upgrading.'}
          </Text>
        </Card>
      ) : null}
      {activation.state === 'timeout' ? (
        <Card style={[styles.card, styles.activationCard]}>
          <Ionicons name="time-outline" size={20} color={colors.warning} />
          <Text style={styles.activationText}>
            Payment received — your plan will update shortly.
          </Text>
        </Card>
      ) : null}

      {billing.data ? (
        catalog.map((tier, rank) => renderTierCard(tier, rank))
      ) : (
        <ActivityIndicator color={colors.primary} style={{ marginVertical: spacing.lg }} />
      )}

      {/* Packages sold in RevenueCat that don't match any tier key still get a
          card, so a misnamed product is visible rather than silently unsellable. */}
      {orphanPackages.map((pkg: PurchasesPackage) => (
        <Card key={pkg.identifier} style={styles.tierCard}>
          <Text style={styles.tierLabel}>{pkg.product.title}</Text>
          <Text style={styles.tierDesc}>{pkg.product.description}</Text>
          <Text style={styles.tierPrice}>{priceLine(pkg)}</Text>
          <Button title="Subscribe" loading={busyId === pkg.identifier} onPress={() => buy(pkg)} />
        </Card>
      ))}

      {__DEV__ && !isPurchasesConfigured() ? (
        <Card style={styles.card}>
          <Text style={styles.note}>
            In-app purchases aren't configured in this build. Set the RevenueCat keys
            (expo.extra.revenueCatIosKey / revenueCatAndroidKey) and run a dev/production
            build — purchases don't work in Expo Go. The server-side webhook is ready.
          </Text>
        </Card>
      ) : null}

      {isPurchasesConfigured() ? (
        <View style={{ marginTop: spacing.sm }}>
          <Button title="Restore purchases" variant="ghost" onPress={restore} />
        </View>
      ) : null}

      <Text style={styles.disclosure}>
        Subscriptions renew automatically until cancelled. Manage or cancel anytime in your{' '}
        {Platform.OS === 'ios' ? 'App Store' : 'Google Play'} account settings.
      </Text>
      <View style={styles.legalRow}>
        <Text style={styles.legalLink} onPress={() => Linking.openURL(TERMS_URL)}>
          Terms of Use
        </Text>
        <Text style={styles.legalDot}>·</Text>
        <Text style={styles.legalLink} onPress={() => Linking.openURL(PRIVACY_URL)}>
          Privacy Policy
        </Text>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  card: { marginBottom: spacing.md },
  note: { color: colors.textMuted, fontSize: 13, lineHeight: 19 },

  activationCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  activationText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600' },
  successCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderColor: colors.success + '66',
    backgroundColor: colors.success + '14',
  },
  successText: { flex: 1, color: colors.text, fontSize: 14, fontWeight: '600', lineHeight: 19 },

  tierCard: { marginBottom: spacing.md },
  tierHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  tierLabel: { fontSize: 17, fontWeight: '700', color: colors.text, flexShrink: 1 },
  tierDesc: { color: colors.textMuted, fontSize: 13, marginVertical: 4 },
  tierPrice: { fontSize: 15, fontWeight: '700', color: colors.primary, marginTop: 4 },
  cancelNote: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  benefits: { marginTop: spacing.sm, marginBottom: spacing.sm, gap: 6 },
  benefitRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  benefitText: { flex: 1, color: colors.text, fontSize: 13, lineHeight: 18 },
  periodRow: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm, flexWrap: 'wrap' },

  disclosure: {
    color: colors.textMuted,
    fontSize: 12,
    lineHeight: 17,
    textAlign: 'center',
    marginTop: spacing.lg,
  },
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  legalLink: { color: colors.primary, fontSize: 12, textDecorationLine: 'underline' },
  legalDot: { color: colors.textMuted, fontSize: 12 },
});
