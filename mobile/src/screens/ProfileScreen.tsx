import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../store/auth';
import { householdApi } from '../api';
import { Button, Card, ListRow } from '../components/ui';
import { colors, spacing } from '../theme';
import type { ProfileStackParamList } from '../navigation/ProfileNavigator';

type Section = {
  route: keyof ProfileStackParamList;
  label: string;
  subtitle: string;
  icon: React.ComponentProps<typeof ListRow>['icon'];
};

// Mirrors client/src/views/ProfileMenu.vue — an iOS-style drill-in hub.
const SECTIONS: Section[] = [
  { route: 'Account', label: 'Account', subtitle: 'Name, birthday, timezone, sign-in & push', icon: 'card-outline' },
  { route: 'Household', label: 'Household', subtitle: 'Shared household and invite code', icon: 'home-outline' },
  { route: 'People', label: 'Contacts', subtitle: 'Family, friends & service providers', icon: 'people-outline' },
  { route: 'Privacy', label: 'Privacy', subtitle: 'AI features, personal data & storage', icon: 'lock-closed-outline' },
  { route: 'E2eeMigration', label: 'Encryption', subtitle: 'Encryption status, recovery code & setup', icon: 'shield-checkmark-outline' },
  { route: 'Paywall', label: 'Plan & billing', subtitle: 'Your plan, usage & upgrades', icon: 'star-outline' },
];

export default function ProfileScreen() {
  const nav = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const { user, logout } = useAuth();

  const { data: household } = useQuery({
    queryKey: ['household'],
    queryFn: async () => (await householdApi.get()).data,
  });

  const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ') || '—';
  const initial = user?.firstName?.charAt(0).toUpperCase() || '?';

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

      <Card style={styles.menu}>
        {SECTIONS.map((s, i) => (
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

      <Button title="Sign out" variant="danger" onPress={() => logout()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
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
});
