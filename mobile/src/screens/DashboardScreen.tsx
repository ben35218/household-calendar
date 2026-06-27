import React from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { billingApi, tasksApi } from '../api';
import { useAuth } from '../store/auth';
import { Card } from '../components/ui';
import { colors, spacing } from '../theme';

export default function DashboardScreen() {
  const { user } = useAuth();

  const billing = useQuery({
    queryKey: ['billing', 'status'],
    queryFn: async () => (await billingApi.status()).data,
  });

  const tasks = useQuery({
    queryKey: ['tasks', 'list'],
    queryFn: async () => (await tasksApi.list()).data,
  });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.greeting}>Hi, {user?.firstName} 👋</Text>

      <Card style={styles.card}>
        <Text style={styles.cardLabel}>Your plan</Text>
        {billing.isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : billing.isError ? (
          <Text style={styles.error}>Couldn't load plan</Text>
        ) : (
          <Text style={styles.cardValue}>{billing.data?.planLabel ?? billing.data?.plan}</Text>
        )}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.cardLabel}>Maintenance tasks</Text>
        {tasks.isLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : tasks.isError ? (
          <Text style={styles.error}>Couldn't load tasks</Text>
        ) : (
          <Text style={styles.cardValue}>{tasks.data?.length ?? 0} tracked</Text>
        )}
      </Card>

      <Text style={styles.note}>
        This is the mobile foundation. Feature screens (calendar grid, inventory, recipes,
        trips) are being ported wave by wave against the same API.
      </Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  greeting: { fontSize: 22, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  card: { marginBottom: spacing.md },
  cardLabel: { fontSize: 13, color: colors.textMuted, marginBottom: 6 },
  cardValue: { fontSize: 20, fontWeight: '700', color: colors.text },
  error: { color: colors.error },
  note: { marginTop: spacing.md, color: colors.textMuted, fontSize: 13, lineHeight: 19 },
});
