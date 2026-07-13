import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { tasksApi, TaskTemplate } from '../../api';
import { Input, SegmentedControl, Badge } from '../../components/ui';
import { recurrenceLabelShort } from '../../lib/recurrence';
import { MaintenanceStackParamList } from '../../navigation/MaintenanceNavigator';
import { colors, radius, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<MaintenanceStackParamList, 'TaskTemplates'>;
type Filter = 'available' | 'all';

const PRIORITY_COLOR: Record<string, string> = {
  high: colors.error,
  medium: colors.warning,
  low: colors.success,
};

export default function TaskTemplatesScreen() {
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('available');

  const templatesQ = useQuery({
    queryKey: ['task-templates'],
    queryFn: async () => (await tasksApi.templates()).data,
  });
  const tasksQ = useQuery({ queryKey: ['tasks', 'list'], queryFn: async () => (await tasksApi.list()).data });

  const usedIds = useMemo(
    () => new Set((tasksQ.data ?? []).map((t) => t.templateId).filter(Boolean) as string[]),
    [tasksQ.data]
  );

  const create = useMutation({
    mutationFn: (templateId: string) => tasksApi.fromTemplate({ templateIds: [templateId] }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      const created = res.data?.[0];
      if (created?._id) navigation.replace('TaskDetail', { id: created._id });
      else navigation.goBack();
    },
  });

  const grouped = useMemo(() => {
    let list = templatesQ.data ?? [];
    if (filter === 'available') list = list.filter((t) => !usedIds.has(t.id));
    if (search) {
      const q = search.toLowerCase();
      list = list.filter(
        (t) => t.title.toLowerCase().includes(q) || t.defaultCategoryName?.toLowerCase().includes(q)
      );
    }
    const g: Record<string, TaskTemplate[]> = {};
    for (const t of list) {
      const cat = t.defaultCategoryName || 'General';
      (g[cat] ||= []).push(t);
    }
    return g;
  }, [templatesQ.data, usedIds, filter, search]);

  if (templatesQ.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" style={styles.screen} contentContainerStyle={styles.content}>
      <View style={styles.toolbar}>
        <SegmentedControl<Filter>
          value={filter}
          onChange={setFilter}
          options={[
            { label: 'Available', value: 'available' },
            { label: 'All', value: 'all' },
          ]}
        />
      </View>
      <Input placeholder="Search templates…" value={search} onChangeText={setSearch} />

      {Object.entries(grouped).map(([cat, items]) => (
        <View key={cat} style={styles.group}>
          <Text style={styles.groupTitle}>
            {cat} <Text style={styles.groupCount}>{items.length}</Text>
          </Text>
          {items.map((tpl) => {
            const used = usedIds.has(tpl.id);
            const busy = create.isPending && create.variables === tpl.id;
            return (
              <TouchableOpacity
                key={tpl.id}
                style={[styles.card, used && styles.cardUsed]}
                disabled={used || create.isPending}
                onPress={() => create.mutate(tpl.id)}
                activeOpacity={0.7}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{tpl.title}</Text>
                  <Text style={styles.cardSub}>{recurrenceLabelShort(tpl.recurrence)}</Text>
                  <View style={styles.chipRow}>
                    {tpl.priority ? <Badge label={tpl.priority} color={PRIORITY_COLOR[tpl.priority]} /> : null}
                    {tpl.estimatedDurationMins ? <Badge label={`${tpl.estimatedDurationMins} min`} /> : null}
                    {tpl.estimatedCost ? <Badge label={`~$${tpl.estimatedCost}`} /> : null}
                    {tpl.intervalKm ? <Badge label={`${tpl.intervalKm.toLocaleString()} km`} /> : null}
                    {used ? <Badge label="In Use" color={colors.success} /> : null}
                  </View>
                </View>
                {busy ? (
                  <ActivityIndicator color={colors.primary} />
                ) : !used ? (
                  <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
                ) : null}
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  toolbar: { marginBottom: spacing.md },
  group: { marginBottom: spacing.lg },
  groupTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  groupCount: { color: colors.textMuted, fontWeight: '600' },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  cardUsed: { opacity: 0.6 },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  cardSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
});
