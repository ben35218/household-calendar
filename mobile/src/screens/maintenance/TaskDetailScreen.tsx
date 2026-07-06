import React, { useLayoutEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { tasksApi, historyApi, odometerApi } from '../../api';
import { Button, Card, Screen, Input, Divider, ListRow, DateField } from '../../components/ui';
import {
  recurrenceLabel,
  formatCalendarDate,
  alertSummary,
} from '../../lib/recurrence';
import { MaintenanceStackParamList } from '../../navigation/MaintenanceNavigator';
import { colors, spacing, radius } from '../../theme';

type Nav = NativeStackNavigationProp<MaintenanceStackParamList, 'TaskDetail'>;
type Rt = RouteProp<MaintenanceStackParamList, 'TaskDetail'>;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

export default function TaskDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { id } = useRoute<Rt>().params;
  const qc = useQueryClient();
  const [completeOpen, setCompleteOpen] = useState(false);
  const [form, setForm] = useState({
    completedDate: todayISO(),
    cost: '',
    notes: '',
    performedBy: 'self',
    odometerReading: '',
  });

  const taskQ = useQuery({
    queryKey: ['tasks', id],
    queryFn: async () => (await tasksApi.get(id)).data,
  });
  const task = taskQ.data;

  const historyQ = useQuery({
    queryKey: ['tasks', id, 'history'],
    queryFn: async () => (await historyApi.list({ taskId: id })).data,
  });

  const itemId = task?.itemId && typeof task.itemId === 'object' ? task.itemId._id : undefined;
  const odoQ = useQuery({
    queryKey: ['odometer', itemId],
    queryFn: async () => (await odometerApi.get(itemId!)).data,
    enabled: !!itemId && !!task?.intervalKm,
  });
  const currentKm = odoQ.data?.currentKm;

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['tasks'] });
  };

  const togglePause = useMutation({
    mutationFn: () => (task?.active === false ? tasksApi.resume(id) : tasksApi.pause(id)),
    onSuccess: invalidate,
  });

  const complete = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = { ...form };
      if (!payload.cost) delete payload.cost;
      if (!payload.odometerReading) delete payload.odometerReading;
      return tasksApi.complete(id, payload);
    },
    onSuccess: () => {
      setCompleteOpen(false);
      setForm({ completedDate: todayISO(), cost: '', notes: '', performedBy: 'self', odometerReading: '' });
      invalidate();
      qc.invalidateQueries({ queryKey: ['tasks', id, 'history'] });
    },
  });

  const del = useMutation({
    mutationFn: () => tasksApi.delete(id),
    onSuccess: () => {
      invalidate();
      navigation.goBack();
    },
  });

  const confirmDelete = () =>
    Alert.alert('Delete Task', `Delete "${task?.title}"? This also removes all completion history.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => del.mutate() },
    ]);

  const isPaused = task?.active === false;
  useLayoutEffect(() => {
    if (task) navigation.setOptions({ title: task.title });
  }, [navigation, task?.title]);

  if (taskQ.isLoading || !task) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const remainingKm =
    task.intervalKm && task.nextDueKm != null && currentKm != null ? task.nextDueKm - currentKm : null;
  const kmColor =
    remainingKm == null ? colors.success : remainingKm <= 0 ? colors.error : remainingKm <= 2000 ? colors.warning : colors.success;
  const alerts = alertSummary(task);

  return (
    <Screen>
      <View style={styles.actionBar}>
        <TouchableOpacity
          onPress={() => togglePause.mutate()}
          disabled={togglePause.isPending}
          style={[styles.actionBtn, styles.actionBtnGhost]}
          activeOpacity={0.8}
        >
          {togglePause.isPending ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Text style={styles.actionBtnGhostText}>{isPaused ? 'Resume' : 'Pause'}</Text>
          )}
        </TouchableOpacity>
        {!isPaused ? (
          <TouchableOpacity
            onPress={() => setCompleteOpen((o) => !o)}
            style={[styles.actionBtn, styles.actionBtnPrimary]}
            activeOpacity={0.8}
          >
            <Text style={styles.actionBtnPrimaryText}>Mark Done</Text>
          </TouchableOpacity>
        ) : null}
      </View>

      {completeOpen ? (
        <Card style={styles.completeCard}>
          <Text style={styles.cardTitle}>Mark Task Complete</Text>
          <DateField
            label="Completion Date"
            value={form.completedDate}
            onChange={(v) => setForm({ ...form, completedDate: v })}
          />
          {task.intervalKm ? (
            <Input
              label="Odometer reading (km)"
              value={form.odometerReading}
              onChangeText={(v) => setForm({ ...form, odometerReading: v })}
              keyboardType="numeric"
            />
          ) : null}
          <Input
            label="Cost ($)"
            value={form.cost}
            onChangeText={(v) => setForm({ ...form, cost: v })}
            keyboardType="numeric"
          />
          <Input
            label="Performed By"
            value={form.performedBy}
            onChangeText={(v) => setForm({ ...form, performedBy: v })}
          />
          <Input
            label="Notes"
            value={form.notes}
            onChangeText={(v) => setForm({ ...form, notes: v })}
            multiline
          />
          <View style={styles.actions}>
            <Button title="Cancel" variant="ghost" onPress={() => setCompleteOpen(false)} />
            <Button title="Mark Done" loading={complete.isPending} onPress={() => complete.mutate()} />
          </View>
        </Card>
      ) : null}

      {remainingKm !== null ? (
        <Card style={[styles.kmCard, { borderColor: kmColor }]}>
          <Ionicons name="speedometer-outline" size={28} color={kmColor} />
          <View style={{ flex: 1, marginLeft: spacing.md }}>
            <Text style={[styles.kmTitle, { color: kmColor }]}>
              {remainingKm <= 0
                ? `${Math.abs(remainingKm).toLocaleString()} km overdue`
                : `${remainingKm.toLocaleString()} km remaining`}
            </Text>
            <Text style={styles.kmSub}>
              Due at {task.nextDueKm?.toLocaleString()} km · now {currentKm?.toLocaleString()} km
            </Text>
          </View>
        </Card>
      ) : null}

      <Card style={styles.infoCard}>
        {task.itemId && typeof task.itemId === 'object' ? (
          <ListRow icon="link-outline" title="Linked item" subtitle={task.itemId.name} />
        ) : null}
        <ListRow icon="calendar-outline" title="Next due" subtitle={formatCalendarDate(task.nextDueDate)} />
        {task.lastCompletedAt ? (
          <ListRow icon="time-outline" title="Last completed" subtitle={formatCalendarDate(task.lastCompletedAt)} />
        ) : null}
        {task.recurrence ? (
          <ListRow icon="repeat-outline" title="Recurrence" subtitle={recurrenceLabel(task.recurrence)} />
        ) : null}
        {task.intervalKm ? (
          <ListRow icon="speedometer-outline" title="Service interval" subtitle={`Every ${task.intervalKm.toLocaleString()} km`} />
        ) : null}
        {task.estimatedDurationMins ? (
          <ListRow icon="time-outline" title="Est. duration" subtitle={`${task.estimatedDurationMins} min`} />
        ) : null}
        {task.estimatedCost ? (
          <ListRow icon="cash-outline" title="Est. cost" subtitle={`$${task.estimatedCost}`} />
        ) : null}
        <ListRow icon="notifications-outline" title="Alerts" subtitle={alerts} />
      </Card>

      {task.description ? (
        <Card style={styles.textCard}>
          <Text style={styles.overline}>Description</Text>
          <Text style={styles.body}>{task.description}</Text>
        </Card>
      ) : null}
      {task.instructions ? (
        <Card style={styles.textCard}>
          <Text style={styles.overline}>Instructions</Text>
          <Text style={styles.body}>{task.instructions}</Text>
        </Card>
      ) : null}

      <Card style={styles.infoCard}>
        <Text style={styles.cardTitle}>Completion history</Text>
        <Divider />
        {historyQ.data?.length ? (
          historyQ.data.map((h) => (
            <ListRow
              key={h._id}
              icon="checkmark-circle-outline"
              title={formatCalendarDate(h.completedDate)}
              subtitle={[h.performedBy, h.cost ? `$${h.cost}` : '', h.notes].filter(Boolean).join(' · ')}
            />
          ))
        ) : (
          <Text style={styles.muted}>No history yet</Text>
        )}
      </Card>

      <View style={styles.deleteWrap}>
        <Button title="Delete task" variant="danger" loading={del.isPending} onPress={confirmDelete} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  actionBar: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  actionBtn: { flex: 1, height: 48, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center' },
  actionBtnPrimary: { backgroundColor: colors.primary },
  actionBtnPrimaryText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  actionBtnGhost: { borderWidth: 1.5, borderColor: colors.primary, backgroundColor: 'transparent' },
  actionBtnGhostText: { color: colors.primary, fontSize: 16, fontWeight: '600' },
  actions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  completeCard: { marginBottom: spacing.md },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  kmCard: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md, borderWidth: 1.5 },
  kmTitle: { fontSize: 18, fontWeight: '700' },
  kmSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  infoCard: { padding: 0, paddingVertical: spacing.xs, marginBottom: spacing.md },
  textCard: { marginBottom: spacing.md },
  overline: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginBottom: 4 },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  muted: { color: colors.textMuted, padding: spacing.md },
  deleteWrap: { marginTop: spacing.sm, marginBottom: spacing.xl },
});
