import React, { useLayoutEffect } from 'react';
import {
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { choresApi, Chore } from '../../api';
import { openRecord } from '../../lib/e2ee';
import * as replica from '../../lib/replica';
import { useAuth } from '../../store/auth';
import { RoundIconButton, SkeletonList, EmptyState, IconAvatar, CardRow } from '../../components/ui';
import { recurrenceLabel, mdiName } from '../../lib/recurrence';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { MaintenanceStackParamList } from '../../navigation/MaintenanceNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<MaintenanceStackParamList, 'ChoresHome'>;

// Mirrors client/src/views/ChoresDashboardView.vue — a dedicated chores list,
// separate from the maintenance (items) flow.
export default function ChoresScreen() {
  const navigation = useNavigation<Nav>();
  const { user } = useAuth();
  const accent = useCalendarColors().colors.chores;

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <RoundIconButton icon="add" onPress={() => navigation.navigate('ChoreForm', {})} bg={accent} />
      ),
    });
  }, [navigation, accent]);

  const choresQ = useQuery({
    queryKey: ['chores', 'list'],
    // Offline-first (Phase 4b): sync the replica, fall back to cache offline,
    // then decrypt content over the plaintext rows.
    queryFn: async () => {
      const rows = await replica.syncedList<Chore>('Chore', async () => (await choresApi.list()).data);
      return Promise.all(rows.map((c) => openRecord('Chore', c)));
    },
  });

  const assigneeName = (chore: Chore): string => {
    const a = chore.assignedTo;
    if (!a || typeof a === 'string') return a ? 'Unassigned' : 'Unassigned';
    if (user && a.accountId && String(a.accountId) === String(user._id)) return 'You';
    return a.name || 'Unassigned';
  };

  if (choresQ.isLoading) {
    return <SkeletonList />;
  }

  const chores = choresQ.data ?? [];

  if (!chores.length) {
    return (
      <EmptyState
        mdiIcon="broom"
        title="No chores yet"
        message="Add a chore to start tracking it on your calendar."
        actionLabel="Add Chore"
        onAction={() => navigation.navigate('ChoreForm', {})}
        accent={accent}
      >
        <TouchableOpacity style={styles.templatesLink} onPress={() => navigation.navigate('ChoreTemplates')}>
          <Ionicons name="grid-outline" size={18} color={accent} />
          <Text style={[styles.templatesLinkText, { color: accent }]}>Browse chore templates</Text>
        </TouchableOpacity>
      </EmptyState>
    );
  }

  return (
    <FlatList
      style={styles.screen}
      data={chores}
      keyExtractor={(c) => c._id}
      contentContainerStyle={styles.list}
      refreshControl={<RefreshControl refreshing={choresQ.isRefetching} onRefresh={choresQ.refetch} />}
      ListHeaderComponent={
        <TouchableOpacity style={styles.templatesLink} onPress={() => navigation.navigate('ChoreTemplates')}>
          <Ionicons name="grid-outline" size={18} color={accent} />
          <Text style={[styles.templatesLinkText, { color: accent }]}>Browse chore templates</Text>
        </TouchableOpacity>
      }
      renderItem={({ item: chore }) => (
        <CardRow
          onPress={() => navigation.navigate('ChoreDetail', { id: chore._id })}
          leading={<IconAvatar mdiIcon={mdiName(chore.icon)} size={40} bg={accent} />}
          title={chore.title}
          subtitle={
            <>
              <Ionicons name="person-outline" size={13} color={colors.textMuted} />
              <Text style={styles.sub}>{assigneeName(chore)}</Text>
              {chore.recurrence ? (
                <>
                  <Ionicons name="repeat" size={13} color={colors.textMuted} style={{ marginLeft: 8 }} />
                  <Text style={styles.sub}>{recurrenceLabel(chore.recurrence)}</Text>
                </>
              ) : null}
            </>
          }
        />
      )}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  list: { padding: spacing.md },
  templatesLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 0, paddingBottom: spacing.md },
  templatesLinkText: { fontSize: 15, fontWeight: '600' },
  sub: { fontSize: 13, color: colors.textMuted },
});
