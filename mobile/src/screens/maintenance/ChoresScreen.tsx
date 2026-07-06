import React, { useLayoutEffect } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Switch,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { choresApi, Chore } from '../../api';
import { openRecord } from '../../lib/e2ee';
import * as replica from '../../lib/replica';
import { useAuth } from '../../store/auth';
import { Card, RoundIconButton } from '../../components/ui';
import { recurrenceLabel, mdiName } from '../../lib/recurrence';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { MaintenanceStackParamList } from '../../navigation/MaintenanceNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<MaintenanceStackParamList, 'ChoresHome'>;

// Mirrors client/src/views/ChoresDashboardView.vue — a dedicated chores list,
// separate from the maintenance (items) flow.
export default function ChoresScreen() {
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
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

  const toggle = useMutation({
    mutationFn: ({ id, active }: { id: string; active: boolean }) =>
      active ? choresApi.pause(id) : choresApi.resume(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['chores'] }),
  });

  const assigneeName = (chore: Chore): string => {
    const a = chore.assignedTo;
    if (!a || typeof a === 'string') return a ? 'Unassigned' : 'Unassigned';
    if (user && a.accountId && String(a.accountId) === String(user._id)) return 'You';
    return a.name || 'Unassigned';
  };

  if (choresQ.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={accent} />
      </View>
    );
  }

  const chores = choresQ.data ?? [];

  if (!chores.length) {
    return (
      <View style={styles.center}>
        <MaterialCommunityIcons name="broom" size={56} color={accent} />
        <Text style={styles.emptyTitle}>No chores yet</Text>
        <Text style={styles.emptyText}>Add a chore to start tracking it on your calendar.</Text>
        <TouchableOpacity style={[styles.addBtn, { backgroundColor: accent }]} onPress={() => navigation.navigate('ChoreForm', {})}>
          <Ionicons name="add" size={18} color="#fff" />
          <Text style={styles.addBtnText}>Add Chore</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.templatesLink} onPress={() => navigation.navigate('ChoreTemplates')}>
          <Ionicons name="grid-outline" size={18} color={accent} />
          <Text style={[styles.templatesLinkText, { color: accent }]}>Browse chore templates</Text>
        </TouchableOpacity>
      </View>
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
      renderItem={({ item: chore }) => {
        const paused = chore.active === false;
        return (
          <TouchableOpacity activeOpacity={0.7} onPress={() => navigation.navigate('ChoreDetail', { id: chore._id })}>
            <Card style={[styles.row, paused && styles.paused]}>
              <View style={[styles.avatar, { backgroundColor: paused ? colors.border : accent }]}>
                <MaterialCommunityIcons name={mdiName(chore.icon) as any} size={20} color="#fff" />
              </View>
              <View style={styles.rowText}>
                <View style={styles.titleLine}>
                  <Text style={styles.name}>{chore.title}</Text>
                  {paused ? (
                    <View style={styles.pausedChip}>
                      <Text style={styles.pausedChipText}>Paused</Text>
                    </View>
                  ) : null}
                </View>
                <View style={styles.subLine}>
                  <Ionicons name="person-outline" size={13} color={colors.textMuted} />
                  <Text style={styles.sub}>{assigneeName(chore)}</Text>
                  {chore.recurrence ? (
                    <>
                      <Ionicons name="repeat" size={13} color={colors.textMuted} style={{ marginLeft: 8 }} />
                      <Text style={styles.sub}>{recurrenceLabel(chore.recurrence)}</Text>
                    </>
                  ) : null}
                </View>
              </View>
              <Switch
                value={!paused}
                onValueChange={() => toggle.mutate({ id: chore._id, active: !paused })}
                trackColor={{ true: accent }}
                disabled={toggle.isPending && toggle.variables?.id === chore._id}
              />
            </Card>
          </TouchableOpacity>
        );
      }}
    />
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background, gap: spacing.sm, padding: spacing.lg },
  list: { padding: spacing.md },
  headerActions: { flexDirection: 'row' },
  headerBtn: { paddingHorizontal: 6 },
  templatesLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingTop: 0, paddingBottom: spacing.md },
  templatesLinkText: { fontSize: 15, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  paused: { opacity: 0.6 },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  rowText: { flex: 1, marginRight: spacing.sm },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  subLine: { flexDirection: 'row', alignItems: 'center', gap: 3, marginTop: 4, flexWrap: 'wrap' },
  sub: { fontSize: 13, color: colors.textMuted },
  pausedChip: { backgroundColor: colors.border, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 1 },
  pausedChipText: { fontSize: 11, fontWeight: '600', color: colors.textMuted },
  emptyTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginTop: spacing.sm },
  emptyText: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  addBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm,
    paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: 12,
  },
  addBtnText: { color: '#fff', fontWeight: '600' },
});
