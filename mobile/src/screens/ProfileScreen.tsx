import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  Linking,
  TouchableOpacity,
  Alert,
} from 'react-native';
import { useNavigation, useIsFocused } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../store/auth';
import { householdApi } from '../api';
import { TERMS_URL, PRIVACY_URL } from '../config';
import {
  usePurchase,
  activePriceLine,
  describeReset,
  shortDate,
  humanCallSeconds,
  MANAGE_SUBSCRIPTIONS_URL,
  STORE_NAME,
} from './plan/shared';
import { Badge, Button, Card, ListRow } from '../components/ui';
import { useE2eeLocked } from '../hooks/useE2eeLocked';
import { colors, spacing } from '../theme';
import type { ProfileStackParamList } from '../navigation/ProfileNavigator';

type Section = {
  route: keyof ProfileStackParamList;
  label: string;
  subtitle: string;
  icon: React.ComponentProps<typeof ListRow>['icon'];
};

// Mirrors client/src/views/ProfileMenu.vue — an iOS-style drill-in hub. Plan &
// billing is no longer a drill-in row: its status/usage cards live inline below
// the identity card (see the plan cards in the render).
const SECTIONS: Section[] = [
  { route: 'Account', label: 'Account', subtitle: 'Identity, sign-in & reminders', icon: 'card-outline' },
  { route: 'PrivacyData', label: 'Privacy & data', subtitle: 'Encryption, recovery & data controls', icon: 'lock-closed-outline' },
  { route: 'Household', label: 'Household', subtitle: 'Shared household and invite code', icon: 'home-outline' },
  { route: 'People', label: 'Contacts', subtitle: 'Family, friends & service providers', icon: 'people-outline' },
];

export default function ProfileScreen() {
  const nav = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const { user } = useAuth();

  const { data: household } = useQuery({
    queryKey: ['household'],
    queryFn: async () => (await householdApi.get()).data,
  });
  const { billing, packages } = usePurchase();
  const data = billing.data;

  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || '—';
  const initial = user?.firstName?.charAt(0).toUpperCase() || '?';

  // Landing on Profile while encrypted data is locked on this device (e.g. after
  // an email-code sign-in with no passkey): prompt the user to resolve it, and
  // deep-link straight to Privacy & data where the unlock UI lives. Prompt once
  // per visit — re-armed each time the screen is left.
  const dataLocked = useE2eeLocked();
  const isFocused = useIsFocused();
  const promptedRef = useRef(false);
  useEffect(() => {
    if (!isFocused) {
      promptedRef.current = false;
      return;
    }
    if (dataLocked && !promptedRef.current) {
      promptedRef.current = true;
      Alert.alert(
        'Your data is locked on this device',
        "You're signed in, but your encrypted data can't be read here until you unlock it — with your recovery code, or Face ID / your password if you've set them up.",
        [
          { text: 'Later', style: 'cancel' },
          { text: 'Unlock now', onPress: () => nav.navigate('PrivacyData', { focus: 'unlock' }) },
        ],
      );
    }
  }, [isFocused, dataLocked, nav]);

  // Plan card state — mirrors PlanScreen. Only the purchasing member can manage
  // the store subscription; unknown purchaser keeps the link for everyone.
  const sub = data?.subscription;
  const isPaid = data ? data.plan !== 'free' : false;
  const managedByOther = Boolean(sub?.managedBy && sub.managedBy.userId !== user?._id);
  const renewDate = shortDate(sub?.expiresAt);
  const price = activePriceLine(sub?.productId, packages);
  const reset = describeReset(data?.resetsAt);
  // Compact at-a-glance for the AI-usage drill-in card: the two weekly budgets.
  const tokenUnlimited = data ? data.weeklyTokenLimit == null : false;
  const tokenOver = data ? data.weeklyTokenLimit != null && data.tokensUsed >= data.weeklyTokenLimit : false;
  const callUnlimited = data ? data.weeklyCallSecondsLimit == null : false;
  const callOver = data ? data.weeklyCallSecondsLimit != null && data.callSecondsUsed >= data.weeklyCallSecondsLimit : false;

  function renderStatusCard() {
    if (!data) return null;
    // Free plan no longer shows a status card here — the "See plans" CTA now
    // lives on the AI usage page the summary card links to.
    if (!isPaid) return null;
    if (sub?.billingIssue) {
      return (
        <Card style={[styles.card, styles.issueCard]}>
          <View style={styles.statusHeader}>
            <Ionicons name="alert-circle" size={20} color={colors.error} />
            <Text style={[styles.statusTitle, { color: colors.error }]}>Payment problem</Text>
          </View>
          <Text style={styles.statusNote}>
            There's a problem with your payment method. Update it to keep {data.planLabel}.
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
          <Text style={styles.statusTitle}>{data.planLabel}</Text>
          <Badge label="Current plan" color={colors.success} />
        </View>
        {sub?.autoRenew === false && renewDate ? (
          <Text style={styles.statusNote}>
            Cancelled — you keep {data.planLabel} until {renewDate}. Resume anytime in the{' '}
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={styles.identity}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>{initial}</Text>
        </View>
        <View style={styles.identityText}>
          <Text style={styles.name}>{name}</Text>
          <Text style={styles.email}>{user?.email}</Text>
          {household?.name ? <Text style={styles.householdChip}>{household.name}</Text> : null}
        </View>
        {user?.role === 'admin' ? <Text style={styles.badge}>Admin</Text> : null}
      </Card>

      {/* Plan & billing, inlined from PlanScreen. Usage summary first (drill-in
          to AiUsage), then the plan status card and manage link. */}
      {data ? (
        <>
          <TouchableOpacity
            activeOpacity={0.7}
            onPress={() => nav.navigate('AiUsage')}
            accessibilityRole="button"
            accessibilityLabel="AI usage details"
          >
            <Card style={styles.card}>
              {reset ? <Text style={styles.usageReset}>{reset}</Text> : null}
              <View style={styles.usageHeaderRow}>
                <Text style={styles.usageHeading}>Manage AI usage and plans</Text>
                <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
              </View>
              {/* Two weekly budgets at a glance: AI (tokens) and assistant call time. */}
              <View style={styles.miniSummary}>
                <View style={styles.miniRow}>
                  <Text style={styles.miniLabel}>AI usage</Text>
                  <View style={styles.miniTrack}>
                    <View
                      style={[
                        styles.miniFill,
                        {
                          width: `${tokenUnlimited ? 0 : data.tokenPct}%`,
                          backgroundColor: tokenOver ? colors.error : colors.primary,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.miniVal}>{tokenUnlimited ? 'Unlimited' : `${data.tokenPct}%`}</Text>
                </View>
                <View style={styles.miniRow}>
                  <Text style={styles.miniLabel}>Call time</Text>
                  <View style={styles.miniTrack}>
                    <View
                      style={[
                        styles.miniFill,
                        {
                          width: `${callUnlimited ? 0 : data.callSecondsPct}%`,
                          backgroundColor: callOver ? colors.error : colors.primary,
                        },
                      ]}
                    />
                  </View>
                  <Text style={styles.miniVal}>
                    {callUnlimited
                      ? 'Unlimited'
                      : `${humanCallSeconds(data.callSecondsUsed) ?? '0 sec'} / ${humanCallSeconds(data.weeklyCallSecondsLimit)}`}
                  </Text>
                </View>
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
        </>
      ) : null}

      <Card style={styles.menu}>
        {SECTIONS.map((s) => (
          <ListRow
            key={s.route}
            icon={s.icon}
            iconColor={colors.primary}
            title={s.label}
            subtitle={s.subtitle}
            onPress={() => nav.navigate(s.route as any)}
          />
        ))}
      </Card>

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
  identity: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  avatar: {
    width: 48, height: 48, borderRadius: 24, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
  },
  avatarText: { color: '#fff', fontSize: 20, fontWeight: '700' },
  identityText: { flex: 1, minWidth: 0 },
  name: { fontSize: 18, fontWeight: '700', color: colors.text },
  email: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  householdChip: {
    alignSelf: 'flex-start', marginTop: 6, fontSize: 12, fontWeight: '600',
    color: colors.primary, backgroundColor: colors.primary + '18',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden',
  },
  badge: {
    backgroundColor: colors.primary, color: '#fff', fontSize: 11, fontWeight: '600',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden',
  },
  menu: { padding: 0, marginBottom: spacing.md },

  // Plan & billing cards (inlined from PlanScreen).
  card: { marginBottom: spacing.md },
  statusHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 6 },
  statusTitle: { fontSize: 17, fontWeight: '700', color: colors.text, flexShrink: 1 },
  statusNote: { color: colors.textMuted, fontSize: 13, lineHeight: 19, marginBottom: spacing.sm },
  issueCard: { borderColor: colors.error + '66', backgroundColor: colors.error + '0D' },

  usageHeaderRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  usageHeading: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  usageReset: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm },

  miniSummary: { marginTop: spacing.sm, gap: 8 },
  miniRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  miniLabel: { fontSize: 12, color: colors.textMuted, width: 64 },
  miniTrack: { flex: 1, height: 5, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  miniFill: { height: 5, borderRadius: 3 },
  miniVal: { fontSize: 12, color: colors.text, fontWeight: '600', minWidth: 72, textAlign: 'right' },

  manageLink: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
    marginBottom: spacing.md,
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
