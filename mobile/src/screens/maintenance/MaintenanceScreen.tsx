import React, { useLayoutEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { tasksApi, choresApi, Task, Chore } from '../../api';
import { Button, Card, SegmentedControl, Badge } from '../../components/ui';
import {
  recurrenceLabel,
  formatCalendarDate,
  dueStatus,
  DueStatus,
  mdiName,
} from '../../lib/recurrence';
import { MaintenanceStackParamList } from '../../navigation/MaintenanceNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<MaintenanceStackParamList, 'MaintenanceHome'>;
type Tab = 'tasks' | 'chores';

const STATUS_COLOR: Record<DueStatus, string> = {
  overdue: colors.error,
  soon: colors.warning,
  upcoming: colors.success,
  none: colors.textMuted,
};

const CHORE_ORANGE = '#F57C00';

export default function MaintenanceScreen() {
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('tasks');

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => navigation.navigate('ItemsList')} style={styles.headerBtn}>
            <Ionicons name="cube-outline" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() => navigation.navigate(tab === 'tasks' ? 'TaskTemplates' : 'ChoreTemplates')}
            style={styles.headerBtn}
          >
            <Ionicons name="grid-outline" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, tab]);

  const tasks = useQuery({
    queryKey: ['tasks', 'list'],
    queryFn: async () => (await tasksApi.list()).data,
  });
  const chores = useQuery({
    queryKey: ['chores', 'list'],
    queryFn: async () => (await choresApi.list()).data,
  });

  const complete = useMutation({
    mutationFn: (id: string) => tasksApi.complete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['tasks'] }),
  });

  const active = tab === 'tasks' ? tasks : chores;

  const header = (
    <View style={styles.toolbar}>
      <SegmentedControl<Tab>
        value={tab}
        onChange={setTab}
        options={[
          { label: 'Tasks', value: 'tasks' },
          { label: 'Chores', value: 'chores' },
        ]}
      />
    </View>
  );

  if (active.isLoading) {
    return (
      <View style={styles.screen}>
        {header}
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: spacing.xl }} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      {tab === 'tasks' ? (
        <FlatList
          data={tasks.data}
          keyExtractor={(t) => t._id}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={tasks.isRefetching} onRefresh={tasks.refetch} />}
          ListEmptyComponent={<EmptyState icon="wrench" label="No maintenance tasks yet." />}
          renderItem={({ item }) => (
            <TaskRow
              task={item}
              onPress={() => navigation.navigate('TaskDetail', { id: item._id })}
              onComplete={() => complete.mutate(item._id)}
              completing={complete.isPending && complete.variables === item._id}
            />
          )}
        />
      ) : (
        <FlatList
          data={chores.data}
          keyExtractor={(c) => c._id}
          ListHeaderComponent={header}
          contentContainerStyle={styles.list}
          refreshControl={<RefreshControl refreshing={chores.isRefetching} onRefresh={chores.refetch} />}
          ListEmptyComponent={<EmptyState icon="broom" label="No chores yet." />}
          renderItem={({ item }) => (
            <ChoreRow chore={item} onPress={() => navigation.navigate('ChoreDetail', { id: item._id })} />
          )}
        />
      )}

      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.85}
        onPress={() => navigation.navigate(tab === 'tasks' ? 'TaskForm' : 'ChoreForm', {})}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

function TaskRow({
  task,
  onPress,
  onComplete,
  completing,
}: {
  task: Task;
  onPress: () => void;
  onComplete: () => void;
  completing: boolean;
}) {
  const paused = task.active === false;
  const status = dueStatus(task.nextDueDate);
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
      <Card style={[styles.row, paused && styles.paused]}>
        <View style={styles.rowText}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.name}>{task.title}</Text>
            {paused ? <Badge label="Paused" /> : <Badge label={status.label} color={STATUS_COLOR[status.status]} />}
          </View>
          <Text style={styles.sub}>
            {task.nextDueDate ? `Due ${formatCalendarDate(task.nextDueDate)}` : 'No due date'}
            {task.recurrence ? ` · ${recurrenceLabel(task.recurrence)}` : ''}
          </Text>
        </View>
        {!paused ? (
          <Button title="Done" variant="ghost" loading={completing} onPress={onComplete} />
        ) : null}
      </Card>
    </TouchableOpacity>
  );
}

function ChoreRow({ chore, onPress }: { chore: Chore; onPress: () => void }) {
  const paused = chore.active === false;
  const assignee =
    typeof chore.assignedTo === 'object' && chore.assignedTo ? chore.assignedTo.name : null;
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
      <Card style={[styles.row, paused && styles.paused]}>
        <View style={styles.choreAvatar}>
          <MaterialCommunityIcons name={mdiName(chore.icon) as any} size={20} color="#fff" />
        </View>
        <View style={styles.rowText}>
          <View style={styles.rowTitleLine}>
            <Text style={styles.name}>{chore.title}</Text>
            {paused ? <Badge label="Paused" /> : null}
          </View>
          <Text style={styles.sub}>
            {assignee || 'Unassigned'}
            {chore.recurrence ? ` · ${recurrenceLabel(chore.recurrence)}` : ''}
          </Text>
        </View>
      </Card>
    </TouchableOpacity>
  );
}

function EmptyState({ icon, label }: { icon: string; label: string }) {
  return (
    <View style={styles.empty}>
      <MaterialCommunityIcons name={icon as any} size={48} color={colors.textMuted} />
      <Text style={styles.emptyText}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  toolbar: { padding: spacing.md, paddingBottom: spacing.sm },
  list: { paddingHorizontal: spacing.md, paddingBottom: 96 },
  headerActions: { flexDirection: 'row' },
  headerBtn: { paddingHorizontal: 6 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  paused: { opacity: 0.6 },
  rowText: { flex: 1, marginRight: spacing.sm },
  rowTitleLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  sub: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  choreAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CHORE_ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  empty: { alignItems: 'center', marginTop: spacing.xl, gap: spacing.sm },
  emptyText: { color: colors.textMuted, fontSize: 15 },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
});
