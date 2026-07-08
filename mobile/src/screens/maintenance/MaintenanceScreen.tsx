import React, { useLayoutEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Pressable,
} from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { tasksApi, itemsApi, Task, Item, LinkedRef } from '../../api';
import { Card, RoundIconButton } from '../../components/ui';
import { formatCalendarDate } from '../../lib/recurrence';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { useAiEnabled } from '../../lib/privacyPrefs';
import { MaintenanceStackParamList } from '../../navigation/MaintenanceNavigator';
import { colors, spacing, radius } from '../../theme';

type Nav = NativeStackNavigationProp<MaintenanceStackParamList, 'MaintenanceHome'>;

// Item type → icon/color (mirrors DashboardView.vue TYPE_ICONS / TYPE_COLORS,
// with mdi names mapped to MaterialCommunityIcons glyphs).
const TYPE_ICONS: Record<string, string> = {
  vehicle: 'car',
  equipment: 'tools',
  appliance: 'washing-machine',
  system: 'cog',
  structure: 'home',
  other: 'package-variant',
};
const TYPE_COLORS: Record<string, string> = {
  vehicle: '#607D8B',
  equipment: '#795548',
  appliance: '#9C27B0',
  system: '#FF9800',
  structure: '#4CAF50',
  other: '#9E9E9E',
};

type StatusKey = 'overdue' | 'due-soon' | 'upcoming' | 'paused';
type StatusTask = Task & { _status: StatusKey };

const STATUS_LABELS: Record<StatusKey, string> = {
  overdue: 'Overdue',
  'due-soon': 'Due soon',
  upcoming: 'Upcoming',
  paused: 'Paused',
};
const STATUS_COLORS: Record<StatusKey, string> = {
  overdue: colors.error,
  'due-soon': colors.warning,
  upcoming: colors.success,
  paused: colors.textMuted,
};
const STATUS_ORDER: Record<StatusKey, number> = { overdue: 0, 'due-soon': 1, upcoming: 2, paused: 3 };
const DEFAULT_LOCATION = 'Home';

function refName(ref?: LinkedRef | string | null): string | null {
  if (!ref) return null;
  return typeof ref === 'object' ? ref.name : null;
}
function refId(ref?: LinkedRef | string | null): string {
  if (!ref) return 'none';
  return typeof ref === 'object' ? ref._id : String(ref);
}

export default function MaintenanceScreen() {
  const navigation = useNavigation<Nav>();
  const aiEnabled = useAiEnabled();
  const accent = useCalendarColors().colors.maintenance;
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [statusFilter, setStatusFilter] = useState<StatusKey | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <RoundIconButton icon="add" onPress={() => navigation.navigate('ItemForm', {})} bg={accent} />
      ),
    });
  }, [navigation, accent]);

  // All tasks tagged with their status bucket (mirrors DashboardView onMounted).
  const tasksQ = useQuery({
    queryKey: ['maintenance', 'tasks-by-status'],
    queryFn: async (): Promise<StatusTask[]> => {
      const buckets: StatusKey[] = ['overdue', 'due-soon', 'upcoming', 'paused'];
      const results = await Promise.all(buckets.map((s) => tasksApi.list({ status: s })));
      return results.flatMap((res, i) => res.data.map((t) => ({ ...t, _status: buckets[i] })));
    },
  });
  const itemsQ = useQuery({
    queryKey: ['items', 'list'],
    queryFn: async () => (await itemsApi.list()).data,
  });

  const allTasks = tasksQ.data ?? [];
  const items = itemsQ.data ?? [];

  const counts = useMemo(() => {
    const c = { overdue: 0, 'due-soon': 0, upcoming: 0, paused: 0 } as Record<StatusKey, number>;
    for (const t of allTasks) c[t._status]++;
    return c;
  }, [allTasks]);

  const itemLocation = (item: Item) => (item.location || '').trim() || DEFAULT_LOCATION;

  const groupedItems = useMemo(() => {
    const groups = new Map<string, { location: string; items: Item[] }>();
    for (const item of items) {
      const loc = itemLocation(item);
      if (!groups.has(loc)) groups.set(loc, { location: loc, items: [] });
      groups.get(loc)!.items.push(item);
    }
    return [...groups.values()].sort((a, b) => {
      if (a.location === DEFAULT_LOCATION) return -1;
      if (b.location === DEFAULT_LOCATION) return 1;
      return a.location.localeCompare(b.location);
    });
  }, [items]);
  const showLocations = groupedItems.length > 1;

  const itemCounts = (itemId: string) =>
    allTasks
      .filter((t) => refId(t.itemId) === itemId)
      .reduce(
        (acc, t) => {
          acc[t._status]++;
          return acc;
        },
        { overdue: 0, 'due-soon': 0, upcoming: 0, paused: 0 } as Record<StatusKey, number>
      );

  // Group an item's tasks by category (mirrors getItemTasksGrouped, flattened to
  // one category level — subcategory headers are folded into the task rows).
  const itemTasksByCategory = (itemId: string) => {
    const tasks = allTasks.filter((t) => refId(t.itemId) === itemId);
    const cats = new Map<string, { name: string; color: string | null; tasks: StatusTask[] }>();
    for (const t of tasks) {
      const cid = refId(t.categoryId);
      if (!cats.has(cid)) {
        cats.set(cid, {
          name: refName(t.categoryId) || 'Uncategorized',
          color: typeof t.categoryId === 'object' ? (t.categoryId as any)?.color ?? null : null,
          tasks: [],
        });
      }
      cats.get(cid)!.tasks.push(t);
    }
    return [...cats.values()].map((c) => ({
      ...c,
      tasks: c.tasks.sort((a, b) => STATUS_ORDER[a._status] - STATUS_ORDER[b._status]),
    }));
  };

  const toggle = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const statusTasks = statusFilter
    ? allTasks
        .filter((t) => t._status === statusFilter)
        .sort((a, b) => new Date(a.nextDueDate || 0).getTime() - new Date(b.nextDueDate || 0).getTime())
    : [];

  if (tasksQ.isLoading || itemsQ.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        {/* Status summary */}
        <Card style={styles.summary}>
          {(['overdue', 'due-soon', 'upcoming', 'paused'] as StatusKey[]).map((s, i) => (
            <React.Fragment key={s}>
              {i > 0 ? <View style={styles.summaryDivider} /> : null}
              <TouchableOpacity style={styles.summarySeg} onPress={() => setStatusFilter(s)} activeOpacity={0.7}>
                <View style={styles.summaryTop}>
                  <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[s] }]} />
                  <Text style={styles.summaryCount}>{counts[s]}</Text>
                </View>
                <Text style={styles.summaryLabel}>{STATUS_LABELS[s].toLowerCase()}</Text>
              </TouchableOpacity>
            </React.Fragment>
          ))}
        </Card>

        {!items.length ? (
          <View style={styles.empty}>
            <MaterialCommunityIcons name="tools" size={48} color={colors.textMuted} />
            <Text style={styles.emptyTitle}>Nothing to maintain yet</Text>
            <Text style={styles.emptyText}>Add items to start tracking maintenance tasks.</Text>
            <TouchableOpacity style={styles.addItemBtn} onPress={() => navigation.navigate('ItemForm', {})}>
              <Ionicons name="add" size={18} color="#fff" />
              <Text style={styles.addItemBtnText}>Add Item</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {groupedItems.map((group) => (
          <View key={group.location} style={styles.group}>
            {showLocations ? <Text style={styles.groupLabel}>{group.location.toUpperCase()}</Text> : null}
            {group.items.map((item) => {
              const ic = itemCounts(item._id);
              const isOpen = expanded.has(item._id);
              return (
                <Card key={item._id} style={styles.itemCard}>
                  <TouchableOpacity
                    style={styles.itemRow}
                    activeOpacity={0.7}
                    onPress={() => navigation.navigate('ItemDetail', { id: item._id })}
                  >
                    <View style={[styles.itemAvatar, { backgroundColor: TYPE_COLORS[item.type || 'other'] || '#9E9E9E' }]}>
                      <MaterialCommunityIcons
                        name={(TYPE_ICONS[item.type || 'other'] || 'package-variant') as any}
                        size={22}
                        color="#fff"
                      />
                    </View>
                    <View style={styles.itemText}>
                      <Text style={styles.itemName}>{item.name}</Text>
                      <View style={styles.itemCountRow}>
                        {ic.overdue ? <Text style={[styles.countPill, { color: colors.error }]}>{ic.overdue} overdue</Text> : null}
                        {ic['due-soon'] ? <Text style={[styles.countPill, { color: colors.warning }]}>{ic['due-soon']} due soon</Text> : null}
                        {ic.upcoming ? <Text style={[styles.countPill, { color: colors.success }]}>{ic.upcoming} upcoming</Text> : null}
                        {ic.paused ? <Text style={[styles.countPill, { color: colors.textMuted }]}>{ic.paused} paused</Text> : null}
                        {!ic.overdue && !ic['due-soon'] && !ic.upcoming && !ic.paused ? (
                          <Text style={[styles.countPill, { color: colors.textMuted }]}>No tasks</Text>
                        ) : null}
                      </View>
                    </View>
                    {aiEnabled && (
                      <TouchableOpacity
                        style={styles.iconBtn}
                        onPress={() => navigation.navigate('MaintenanceChat', { itemId: item._id, itemName: item.name })}
                      >
                        <Ionicons name="chatbubble-outline" size={20} color={colors.primary} />
                      </TouchableOpacity>
                    )}
                    <TouchableOpacity style={styles.iconBtn} onPress={() => toggle(item._id)}>
                      <Ionicons name={isOpen ? 'chevron-up' : 'chevron-down'} size={20} color={colors.textMuted} />
                    </TouchableOpacity>
                  </TouchableOpacity>

                  {isOpen ? (
                    <View style={styles.itemExpand}>
                      {itemTasksByCategory(item._id).length ? (
                        itemTasksByCategory(item._id).map((cat) => (
                          <View key={cat.name}>
                            <View style={styles.catHeader}>
                              <View style={[styles.statusDot, { backgroundColor: cat.color || colors.textMuted }]} />
                              <Text style={styles.catName}>{cat.name.toUpperCase()}</Text>
                            </View>
                            {cat.tasks.map((task) => (
                              <TouchableOpacity
                                key={task._id}
                                style={styles.taskRow}
                                activeOpacity={0.7}
                                onPress={() => navigation.navigate('TaskDetail', { id: task._id })}
                              >
                                <View style={[styles.statusDotSm, { backgroundColor: STATUS_COLORS[task._status] }]} />
                                <Text style={styles.taskTitle} numberOfLines={1}>{task.title}</Text>
                                <View style={[styles.taskChip, { backgroundColor: STATUS_COLORS[task._status] + '22' }]}>
                                  <Text style={[styles.taskChipText, { color: STATUS_COLORS[task._status] }]}>
                                    {task._status === 'paused' ? 'Paused' : formatCalendarDate(task.nextDueDate)}
                                  </Text>
                                </View>
                              </TouchableOpacity>
                            ))}
                          </View>
                        ))
                      ) : (
                        <Text style={styles.noTasks}>No active tasks</Text>
                      )}
                      <TouchableOpacity style={styles.addTaskBtn} onPress={() => navigation.navigate('TaskForm', {})}>
                        <Ionicons name="add" size={18} color={colors.primary} />
                        <Text style={styles.addTaskText}>Add task</Text>
                      </TouchableOpacity>
                    </View>
                  ) : null}
                </Card>
              );
            })}
          </View>
        ))}
      </ScrollView>

      {/* Status task list (mirrors the web's status dialog) */}
      <Modal visible={!!statusFilter} transparent animationType="fade" onRequestClose={() => setStatusFilter(null)}>
        <Pressable style={styles.backdrop} onPress={() => setStatusFilter(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHeader}>
              {statusFilter ? <View style={[styles.statusDot, { backgroundColor: STATUS_COLORS[statusFilter] }]} /> : null}
              <Text style={styles.sheetTitle}>
                {statusFilter ? STATUS_LABELS[statusFilter] : ''} ({statusTasks.length})
              </Text>
              <View style={{ flex: 1 }} />
              <TouchableOpacity onPress={() => setStatusFilter(null)}>
                <Ionicons name="close" size={22} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
            <ScrollView style={styles.sheetList}>
              {statusTasks.length ? (
                statusTasks.map((task) => (
                  <TouchableOpacity
                    key={task._id}
                    style={styles.sheetRow}
                    onPress={() => {
                      setStatusFilter(null);
                      navigation.navigate('TaskDetail', { id: task._id });
                    }}
                  >
                    <View style={styles.sheetRowText}>
                      <Text style={styles.taskTitle} numberOfLines={1}>{task.title}</Text>
                      <Text style={styles.sheetRowSub}>{refName(task.itemId) || '—'}</Text>
                    </View>
                    <Text style={[styles.taskChipText, { color: statusFilter ? STATUS_COLORS[statusFilter] : colors.textMuted }]}>
                      {statusFilter === 'paused' ? 'Paused' : formatCalendarDate(task.nextDueDate)}
                    </Text>
                  </TouchableOpacity>
                ))
              ) : (
                <Text style={styles.noTasks}>No {statusFilter ? STATUS_LABELS[statusFilter].toLowerCase() : ''} tasks.</Text>
              )}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  headerActions: { flexDirection: 'row' },
  headerBtn: { paddingHorizontal: 6 },

  summary: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around', marginBottom: spacing.lg },
  summaryDivider: { width: 1, height: 36, backgroundColor: colors.border },
  summarySeg: { alignItems: 'center', paddingHorizontal: 8, paddingVertical: 4 },
  summaryTop: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  summaryCount: { fontSize: 22, fontWeight: '700', color: colors.text },
  summaryLabel: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  statusDotSm: { width: 9, height: 9, borderRadius: 4.5 },

  group: { marginBottom: spacing.md },
  groupLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: spacing.sm, paddingLeft: 4 },
  itemCard: { marginBottom: spacing.sm, padding: 0 },
  itemRow: { flexDirection: 'row', alignItems: 'center', padding: spacing.md },
  itemAvatar: { width: 44, height: 44, borderRadius: radius.md, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  itemText: { flex: 1 },
  itemName: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 4 },
  itemCountRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  countPill: { fontSize: 12, fontWeight: '600' },
  iconBtn: { padding: 6 },

  itemExpand: { borderTopWidth: 1, borderTopColor: colors.border, paddingVertical: spacing.sm },
  catHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: 4 },
  catName: { fontSize: 12, fontWeight: '700', color: colors.text, letterSpacing: 0.5 },
  taskRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 8, paddingHorizontal: spacing.md, paddingLeft: spacing.lg },
  taskTitle: { flex: 1, fontSize: 14, color: colors.text },
  taskChip: { borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2 },
  taskChipText: { fontSize: 12, fontWeight: '600' },
  noTasks: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, fontSize: 13, color: colors.textMuted },
  addTaskBtn: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4,
    marginHorizontal: spacing.md, marginTop: spacing.sm, paddingVertical: 10,
    borderWidth: 1, borderColor: colors.primary, borderRadius: radius.md,
  },
  addTaskText: { color: colors.primary, fontWeight: '600' },

  empty: { alignItems: 'center', marginTop: spacing.xl, gap: spacing.sm, paddingBottom: spacing.lg },
  emptyTitle: { fontSize: 17, fontWeight: '700', color: colors.text },
  emptyText: { fontSize: 14, color: colors.textMuted, textAlign: 'center' },
  addItemBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: spacing.sm,
    backgroundColor: colors.primary, paddingHorizontal: spacing.md, paddingVertical: 10, borderRadius: radius.md,
  },
  addItemBtnText: { color: '#fff', fontWeight: '600' },

  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  sheet: { backgroundColor: colors.surface, borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg, padding: spacing.md, maxHeight: '70%' },
  sheetHeader: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: spacing.sm },
  sheetTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  sheetList: {},
  sheetRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: colors.border, gap: spacing.sm },
  sheetRowText: { flex: 1 },
  sheetRowSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
});
