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
import { colors, spacing, radius } from '../theme';

// Tracked usage actions, mirroring the web Plan & usage page.
const USAGE_ACTIONS: { key: string; label: string }[] = [
  { key: 'chat', label: 'AI chat messages' },
  { key: 'scan', label: 'Photo / receipt scans' },
  { key: 'generation', label: 'Recipe & meal generation' },
  { key: 'manualParse', label: 'Manual lookups' },
];

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// The server resets usage every Wednesday at 5PM Eastern and returns that next
// reset instant. Render it in the device's own timezone: how many whole days
// remain, plus the local weekday + clock time it happens.
function describeReset(resetsAt?: string): string | null {
  if (!resetsAt) return null;
  const reset = new Date(resetsAt);
  if (Number.isNaN(reset.getTime())) return null;

  // Whole calendar days between today and the reset day, in device-local time,
  // so a reset 6 days + a few hours away reads as "6 days", not "7".
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((startOfDay(reset) - startOfDay(new Date())) / 86_400_000);

  let hour = reset.getHours(); // device-local
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12 || 12;
  const min = reset.getMinutes();
  const time = min ? `${hour}:${String(min).padStart(2, '0')} ${ampm}` : `${hour} ${ampm}`;

  if (days <= 0) return `Resets today at ${time}`;
  return `${days} ${days === 1 ? 'day' : 'days'} left · resets ${WEEKDAYS[reset.getDay()]} at ${time}`;
}

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

      {billing.data ? (
        <Card style={styles.card}>
          <Text style={styles.usageHeading}>This week's usage</Text>
          {describeReset(billing.data.resetsAt) ? (
            <Text style={styles.usageReset}>{describeReset(billing.data.resetsAt)}</Text>
          ) : null}
          {USAGE_ACTIONS.map((a) => {
            const used = billing.data!.usage?.[a.key] ?? 0;
            const quota = billing.data!.quotas?.[a.key];
            const hasLimit = quota != null;
            const pct = hasLimit && quota! > 0 ? Math.min(100, Math.round((used / quota!) * 100)) : 0;
            const over = hasLimit && used >= quota!;
            return (
              <View key={a.key} style={styles.usageRow}>
                <View style={styles.usageLabelRow}>
                  <Text style={styles.usageLabel}>{a.label}</Text>
                  <Text style={styles.usageValue}>{used} / {hasLimit ? quota : '∞'}</Text>
                </View>
                <View style={styles.usageTrack}>
                  <View
                    style={[
                      styles.usageFill,
                      { width: `${pct}%`, backgroundColor: over ? colors.error : colors.primary },
                    ]}
                  />
                </View>
              </View>
            );
          })}
        </Card>
      ) : null}

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
  usageHeading: { fontSize: 13, fontWeight: '600', color: colors.textMuted, marginBottom: 2 },
  usageReset: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm },
  usageRow: { marginBottom: spacing.sm },
  usageLabelRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 4 },
  usageLabel: { color: colors.text, fontSize: 14 },
  usageValue: { color: colors.textMuted, fontSize: 14 },
  usageTrack: { height: 6, borderRadius: radius.sm, backgroundColor: colors.border, overflow: 'hidden' },
  usageFill: { height: 6, borderRadius: radius.sm },
  tierRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 6 },
  tierLabel: { fontSize: 16, fontWeight: '600', color: colors.text },
  tierDesc: { color: colors.textMuted, fontSize: 13, marginVertical: 4 },
  tierPrice: { fontSize: 16, fontWeight: '700', color: colors.primary, marginBottom: spacing.sm },
});
