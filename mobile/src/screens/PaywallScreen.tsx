import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { PurchasesPackage } from 'react-native-purchases';
import { billingApi } from '../api';
import { useAuth } from '../store/auth';
import { Button, Card } from '../components/ui';
import {
  isPurchasesConfigured,
  configurePurchases,
  getCurrentOffering,
  purchasePackage,
  restorePurchases,
} from '../lib/purchases';
import { colors, spacing } from '../theme';

export default function PaywallScreen() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [packages, setPackages] = useState<PurchasesPackage[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const billing = useQuery({
    queryKey: ['billing', 'status'],
    queryFn: async () => (await billingApi.status()).data,
  });

  // Configure RevenueCat with the household as app_user_id, then load offerings.
  useEffect(() => {
    if (!isPurchasesConfigured()) return;
    const appUserId = user?.householdId || user?._id;
    if (!appUserId) return;
    configurePurchases(appUserId);
    getCurrentOffering()
      .then((offering) => setPackages(offering?.availablePackages ?? []))
      .catch(() => setPackages([]));
  }, [user?.householdId, user?._id]);

  async function buy(pkg: PurchasesPackage) {
    setBusyId(pkg.identifier);
    try {
      await purchasePackage(pkg);
      // The plan flips server-side via the RevenueCat webhook; refresh status.
      await qc.invalidateQueries({ queryKey: ['billing'] });
      Alert.alert('Thank you!', 'Your purchase is being applied to your household.');
    } catch (e: any) {
      if (!e?.userCancelled) Alert.alert('Purchase failed', e?.message || 'Please try again.');
    } finally {
      setBusyId(null);
    }
  }

  async function restore() {
    try {
      await restorePurchases();
      await qc.invalidateQueries({ queryKey: ['billing'] });
      Alert.alert('Restored', 'Any previous purchases have been restored.');
    } catch {
      Alert.alert('Restore failed', 'Could not restore purchases.');
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Upgrade your plan</Text>
      <Text style={styles.current}>
        Current plan: {billing.data?.planLabel ?? billing.data?.plan ?? '…'}
      </Text>

      {!isPurchasesConfigured() ? (
        <Card style={styles.card}>
          <Text style={styles.note}>
            In-app purchases aren't configured in this build. Set the RevenueCat keys
            (expo.extra.revenueCatIosKey / revenueCatAndroidKey) and run a dev/production
            build — purchases don't work in Expo Go. The server-side webhook is ready.
          </Text>
          {/* Show the server's tier catalog so the screen is still meaningful. */}
          {(billing.data?.catalog ?? []).map((t) => (
            <View key={t.key} style={styles.tierRow}>
              <Text style={styles.tierLabel}>{t.label}</Text>
              <Text style={styles.tierPrice}>{t.price ? `$${t.price}/mo` : 'Free'}</Text>
            </View>
          ))}
        </Card>
      ) : packages.length === 0 ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.lg }} />
      ) : (
        packages.map((pkg) => (
          <Card key={pkg.identifier} style={styles.card}>
            <Text style={styles.tierLabel}>{pkg.product.title}</Text>
            <Text style={styles.tierDesc}>{pkg.product.description}</Text>
            <Text style={styles.tierPrice}>{pkg.product.priceString}</Text>
            <Button
              title="Subscribe"
              loading={busyId === pkg.identifier}
              onPress={() => buy(pkg)}
            />
          </Card>
        ))
      )}

      <View style={{ marginTop: spacing.md }}>
        <Button title="Restore purchases" variant="ghost" onPress={restore} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  current: { color: colors.textMuted, marginTop: 4, marginBottom: spacing.md },
  card: { marginBottom: spacing.md },
  note: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginBottom: spacing.md },
  tierRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  tierLabel: { fontSize: 16, fontWeight: '600', color: colors.text },
  tierDesc: { color: colors.textMuted, fontSize: 13, marginVertical: 4 },
  tierPrice: { fontSize: 16, fontWeight: '700', color: colors.primary, marginBottom: spacing.sm },
});
