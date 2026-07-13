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
import { Button, Card, Screen, Input, ListRow, DateField, CenteredLoader, BottomSheet, HeaderIconButton } from '../../components/ui';
import {
  recurrenceLabel,
  formatCalendarDate,
  parseCalendarDate,
} from '../../lib/recurrence';
import { itemTypeConfig } from '../../lib/itemTypes';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { MaintenanceStackParamList } from '../../navigation/MaintenanceNavigator';
import { colors, spacing, radius } from '../../theme';

type Nav = NativeStackNavigationProp<MaintenanceStackParamList, 'TaskDetail'>;
type Rt = RouteProp<MaintenanceStackParamList, 'TaskDetail'>;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

// Countdown label to the due date (no TZ rollover via parseCalendarDate).
// Within a week: "Due today" / "Due in N days" / "N days overdue". Beyond a
// week it breaks into weeks + days: "N weeks, N days until due" / "… overdue".
function dueInLabel(dueDate?: string | null): string {
  if (!dueDate) return 'No due date';
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((parseCalendarDate(dueDate).getTime() - today.getTime()) / 86400000);
  const plur = (n: number, u: string) => `${n} ${u}${n === 1 ? '' : 's'}`;
  if (days === 0) return 'Due today';

  const abs = Math.abs(days);
  if (abs <= 7) {
    return days < 0 ? `${plur(abs, 'day')} overdue` : `Due in ${plur(abs, 'day')}`;
  }
  const weeks = Math.floor(abs / 7);
  const rem = abs - weeks * 7;
  const span = rem ? `${plur(weeks, 'week')}, ${plur(rem, 'day')}` : plur(weeks, 'week');
  return days < 0 ? `${span} overdue` : `${span} until due`;
}

export default function TaskDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { id } = useRoute<Rt>().params;
  const qc = useQueryClient();
  const accent = useCalendarColors().colors.maintenance;
  const [completeOpen, setCompleteOpen] = useState(false);
  const [form, setForm] = useState({
    completedDate: todayISO(),
    notes: '',
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
      if (!payload.odometerReading) delete payload.odometerReading;
      return tasksApi.complete(id, payload);
    },
    onSuccess: () => {
      setCompleteOpen(false);
      setForm({ completedDate: todayISO(), notes: '', odometerReading: '' });
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
    // Header shows the view name, not the task name (which is in the body).
    navigation.setOptions({
      title: 'Task',
      headerRight: () => (
        <HeaderIconButton icon="pencil" accessibilityLabel="Edit task" onPress={() => navigation.navigate('TaskForm', { id })} />
      ),
    });
  }, [navigation, id]);

  if (taskQ.isLoading || !task) {
    return <CenteredLoader color={accent} />;
  }

  const remainingKm =
    task.intervalKm && task.nextDueKm != null && currentKm != null ? task.nextDueKm - currentKm : null;
  const kmColor =
    remainingKm == null ? colors.success : remainingKm <= 0 ? colors.error : remainingKm <= 2000 ? colors.warning : colors.success;

  return (
    <Screen>
      <Card style={[styles.actionCard, { borderColor: accent }]}>
        <View style={styles.actionRow}>
          <TouchableOpacity
            onPress={() => togglePause.mutate()}
            disabled={togglePause.isPending}
            style={[styles.actionHalf, styles.actionHalfPause, { borderRightColor: accent }]}
            activeOpacity={0.8}
            accessibilityLabel={isPaused ? 'Resume task' : 'Pause task'}
          >
            {togglePause.isPending ? (
              <ActivityIndicator color={accent} />
            ) : (
              <>
                <Ionicons name={isPaused ? 'play' : 'pause'} size={22} color={accent} />
                <Text style={[styles.actionLabel, { color: accent }]}>{isPaused ? 'Resume' : 'Pause'}</Text>
              </>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => setCompleteOpen((o) => !o)}
            style={[styles.actionHalf, { backgroundColor: accent }]}
            activeOpacity={0.8}
            accessibilityLabel="Mark task done"
          >
            <Ionicons name="checkmark" size={24} color="#000" />
            <Text style={[styles.actionLabel, styles.actionLabelDone]}>Done</Text>
          </TouchableOpacity>
        </View>
      </Card>

      <Card style={styles.headerCard}>
        <Text style={styles.screenTitle}>{task.title}</Text>
        {task.description ? <Text style={styles.body}>{task.description}</Text> : null}
      </Card>

      <BottomSheet visible={completeOpen} onClose={() => setCompleteOpen(false)} title="Mark Task Done" avoidKeyboard>
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
          label="Notes"
          value={form.notes}
          onChangeText={(v) => setForm({ ...form, notes: v })}
          multiline
        />
        <Button title="Done" loading={complete.isPending} onPress={() => complete.mutate()} />
      </BottomSheet>

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
          <ListRow mdiIcon={itemTypeConfig(task.itemId.type).icon} title={task.itemId.name} />
        ) : null}
        <ListRow icon="calendar-outline" title={dueInLabel(task.nextDueDate)} />
        {task.lastCompletedAt ? (
          <ListRow icon="time-outline" title="Last completed" subtitle={formatCalendarDate(task.lastCompletedAt)} />
        ) : null}
        {task.recurrence ? (
          <ListRow icon="repeat-outline" title="Recurrence" subtitle={recurrenceLabel(task.recurrence)} />
        ) : null}
        {task.intervalKm ? (
          <ListRow icon="speedometer-outline" title="Service interval" subtitle={`Every ${task.intervalKm.toLocaleString()} km`} />
        ) : null}
      </Card>

      <Card style={styles.infoCard}>
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
  headerCard: { marginBottom: spacing.md, gap: spacing.sm },
  screenTitle: { fontSize: 24, fontWeight: '700', color: colors.text },
  actionCard: { marginBottom: spacing.md, padding: 0, overflow: 'hidden' },
  actionRow: { flexDirection: 'row' },
  actionHalf: { flex: 1, height: 64, alignItems: 'center', justifyContent: 'center', gap: 4 },
  actionHalfPause: { borderRightWidth: 1 },
  actionLabel: { fontSize: 13, fontWeight: '600' },
  actionLabelDone: { color: '#000' },
  kmCard: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md, borderWidth: 1.5 },
  kmTitle: { fontSize: 18, fontWeight: '700' },
  kmSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  infoCard: { padding: 0, paddingVertical: spacing.xs, marginBottom: spacing.md },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  muted: { color: colors.textMuted, padding: spacing.md },
  deleteWrap: { marginTop: spacing.sm, marginBottom: spacing.xl },
});
