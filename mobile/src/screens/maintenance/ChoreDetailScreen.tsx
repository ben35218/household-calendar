import React, { useLayoutEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TouchableOpacity } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { choresApi } from '../../api';
import { Button, Card, Screen, Divider, Badge, ListRow } from '../../components/ui';
import { recurrenceLabel, formatCalendarDate, alertSummary, mdiName } from '../../lib/recurrence';
import { MaintenanceStackParamList } from '../../navigation/MaintenanceNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<MaintenanceStackParamList, 'ChoreDetail'>;
type Rt = RouteProp<MaintenanceStackParamList, 'ChoreDetail'>;

const CHORE_ORANGE = '#F57C00';

export default function ChoreDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { id } = useRoute<Rt>().params;
  const qc = useQueryClient();

  const choreQ = useQuery({
    queryKey: ['chores', id],
    queryFn: async () => (await choresApi.get(id)).data,
  });
  const chore = choreQ.data;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['chores'] });

  const togglePause = useMutation({
    mutationFn: () => (chore?.active === false ? choresApi.resume(id) : choresApi.pause(id)),
    onSuccess: invalidate,
  });
  const del = useMutation({
    mutationFn: () => choresApi.delete(id),
    onSuccess: () => {
      invalidate();
      navigation.goBack();
    },
  });

  const confirmDelete = () =>
    Alert.alert('Delete Chore', `Delete "${chore?.title}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => del.mutate() },
    ]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => navigation.navigate('ChoreForm', { id })} style={styles.headerBtn}>
            <Ionicons name="create-outline" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={confirmDelete} style={styles.headerBtn}>
            <Ionicons name="trash-outline" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, id, chore?.title]);

  if (choreQ.isLoading || !chore) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const paused = chore.active === false;
  const assignee =
    typeof chore.assignedTo === 'object' && chore.assignedTo ? chore.assignedTo.name : null;
  const instructions = chore.instructions || chore.description || '';

  return (
    <Screen>
      <View style={styles.titleRow}>
        <View style={styles.avatar}>
          <MaterialCommunityIcons name={mdiName(chore.icon) as any} size={24} color="#fff" />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{chore.title}</Text>
          {paused ? <Badge label="Paused" /> : null}
        </View>
      </View>

      <View style={styles.actions}>
        <Button
          title={paused ? 'Resume' : 'Pause'}
          variant="ghost"
          loading={togglePause.isPending}
          onPress={() => togglePause.mutate()}
        />
      </View>

      <Card style={styles.infoCard}>
        <ListRow icon="person-outline" title="Assigned to" subtitle={assignee || 'Unassigned'} />
        <ListRow icon="calendar-outline" title="Next due" subtitle={formatCalendarDate(chore.nextDueDate)} />
        {chore.recurrence ? (
          <ListRow icon="repeat-outline" title="Recurrence" subtitle={recurrenceLabel(chore.recurrence)} />
        ) : null}
        <ListRow icon="notifications-outline" title="Alerts" subtitle={alertSummary(chore)} />
      </Card>

      {instructions ? (
        <Card style={styles.textCard}>
          <Text style={styles.overline}>Instructions</Text>
          <Text style={styles.body}>{instructions}</Text>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  headerActions: { flexDirection: 'row' },
  headerBtn: { paddingHorizontal: 6 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: CHORE_ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 22, fontWeight: '700', color: colors.text },
  actions: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  infoCard: { padding: 0, paddingVertical: spacing.xs, marginBottom: spacing.md },
  textCard: { marginBottom: spacing.md },
  overline: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginBottom: 4 },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
});
