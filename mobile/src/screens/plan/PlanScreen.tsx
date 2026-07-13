import React from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Linking,
  TouchableOpacity,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../store/auth';
import { Badge, Button, Card } from '../../components/ui';
import { TERMS_URL, PRIVACY_URL } from '../../config';
import type { RootStackParamList } from '../../navigation/types';
import { colors, spacing, radius } from '../../theme';
import {
  usePurchase,
  activePriceLine,
  describeReset,
  shortDate,
  MANAGE_SUBSCRIPTIONS_URL,
  STORE_NAME,
} from './shared';

// The "Plan & billing" hub: status-first, no sales copy for subscribers.
// Upgrading/comparing lives on ComparePlans; usage detail on AiUsage.
export default function PlanScreen() {
  const nav = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const { user } = useAuth();
  const { billing, packages } = usePurchase();
  const data = billing.data;

  if (!data) {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  // Narrowed alias — TS doesn't carry the !data guard into nested closures.
  const status = data;
  const sub = status.subscription;
  const isPaid = status.plan !== 'free';
  // Only the member who bought the subscription can manage it — the store link
  // opens the signed-in store account, which is theirs alone. Unknown purchaser
  // (pre-lifecycle subscriptions) keeps the link for everyone.
  const managedByOther = Boolean(sub?.managedBy && sub.managedBy.userId !== user?._id);
  const renewDate = shortDate(sub?.expiresAt);
  const price = activePriceLine(sub?.productId, packages);

  function renderStatusCard() {
    if (!isPaid) {
      return (
        <Card style={styles.card}>
          <View style={styles.statusHeader}>
            <Text style={styles.statusTitle}>You're on the Free plan</Text>
            <Badge label={status.planLabel ?? 'Free'} color={colors.textMuted} />
          </View>
          <Text style={styles.statusNote}>
            Every household member gets their own weekly AI allowance on our fast model.
          </Text>
          <Button title="See plans" onPress={() => nav.navigate('ComparePlans')} />
        </Card>
      );
    }
    if (sub?.billingIssue) {
      return (
        <Card style={[styles.card, styles.issueCard]}>
          <View style={styles.statusHeader}>
            <Ionicons name="alert-circle" size={20} color={colors.error} />
            <Text style={[styles.statusTitle, { color: colors.error }]}>Payment problem</Text>
          </View>
          <Text style={styles.statusNote}>
            There's a problem with your payment method. Update it to keep {status.planLabel}.
          </Text>
          {managedByOther ? (
            <Text style={styles.statusNote}>
              The subscription is managed by {sub.managedBy!.name} — they can fix it from their{' '}
              {STORE_NAME} account.
            </Text>
          ) : (
            <Button
              title="Update payment method"
              onPress={() => MANAGE_SUBSCRIPTIONS_URL && Linking.openURL(MANAGE_SUBSCRIPTIONS_URL)}
            />
          )}
        </Card>
      );
    }
    return (
      <Card style={styles.card}>
        <View style={styles.statusHeader}>
          <Text style={styles.statusTitle}>{status.planLabel}</Text>
          <Badge label="Current plan" color={colors.success} />
        </View>
        {sub?.autoRenew === false && renewDate ? (
          <Text style={styles.statusNote}>
            Cancelled — you keep {status.planLabel} until {renewDate}. Resume anytime in the{' '}
            {STORE_NAME}.
          </Text>
        ) : sub?.autoRenew && renewDate ? (
          <Text style={styles.statusNote}>
            Renews {renewDate}
            {price ? ` · ${price}` : ''}
          </Text>
        ) : null}
        {managedByOther ? (
          <Text style={styles.statusNote}>Subscription managed by {sub!.managedBy!.name}.</Text>
        ) : null}
      </Card>
    );
  }

  const reset = describeReset(data.resetsAt);
  const unlimited = data.weeklyTokenLimit == null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Usage summary — the detail (per member, per feature) lives on AiUsage. */}
      <TouchableOpacity
        activeOpacity={0.7}
        onPress={() => nav.navigate('AiUsage')}
        accessibilityRole="button"
        accessibilityLabel="AI usage details"
      >
        <Card style={styles.card}>
          {reset ? <Text style={styles.usageReset}>{reset}</Text> : null}
          {unlimited ? (
            <View style={styles.gaugeHeader}>
              <Text style={styles.gaugePct}>Unlimited</Text>
              <Text style={styles.gaugeCaption}>AI usage</Text>
            </View>
          ) : (
            <View style={styles.gaugeRow}>
              <View style={styles.usageTrack}>
                <View
                  style={[
                    styles.usageFill,
                    {
                      width: `${data.tokenPct}%`,
                      backgroundColor: data.tokenPct >= 100 ? colors.error : colors.primary,
                    },
                  ]}
                />
              </View>
              <Text style={styles.gaugePctInline}>{data.tokenPct}% used</Text>
            </View>
          )}
          <View style={styles.usageHeaderRow}>
            <Text style={styles.usageHeading}>
              {data.usageScope === 'household' ? "Household's AI usage this week" : 'Your AI usage this week'}
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
          </View>
        </Card>
      </TouchableOpacity>

      {renderStatusCard()}

      {isPaid && !managedByOther && !sub?.billingIssue ? (
        <TouchableOpacity
          style={styles.manageLink}
          onPress={() => MANAGE_SUBSCRIPTIONS_URL && Linking.openURL(MANAGE_SUBSCRIPTIONS_URL)}
          accessibilityRole="link"
        >
          <Text style={styles.manageLinkText}>Manage subscription</Text>
          <Ionicons name="open-outline" size={14} color={colors.primary} />
        </TouchableOpacity>
      ) : null}

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
  loading: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  card: { marginBottom: spacing.md },

  statusHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 6 },
  statusTitle: { fontSize: 17, fontWeight: '700', color: colors.text, flexShrink: 1 },
  statusNote: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginBottom: spacing.sm },
  issueCard: { borderColor: colors.error + '66', backgroundColor: colors.error + '0D' },

  usageHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  usageHeading: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  gaugeHeader: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm, marginBottom: 6 },
  gaugePct: { fontSize: 28, fontWeight: '700', color: colors.text },
  gaugeCaption: { fontSize: 13, color: colors.textMuted },
  gaugeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  gaugePctInline: { fontSize: 13, fontWeight: '600', color: colors.text },
  usageTrack: { flex: 1, height: 6, borderRadius: radius.sm, backgroundColor: colors.border, overflow: 'hidden' },
  usageFill: { height: 6, borderRadius: radius.sm },
  usageReset: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm },

  manageLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginTop: spacing.md,
  },
  manageLinkText: { color: colors.primary, fontSize: 14, fontWeight: '600' },
  legalRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.lg,
  },
  legalLink: { color: colors.primary, fontSize: 12, textDecorationLine: 'underline' },
  legalDot: { color: colors.textMuted, fontSize: 12 },
});
