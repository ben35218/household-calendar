import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { choresApi, ChoreTemplate } from '../../api';
import { Input, SegmentedControl, Badge } from '../../components/ui';
import { recurrenceLabelShort, mdiName } from '../../lib/recurrence';
import { MaintenanceStackParamList } from '../../navigation/MaintenanceNavigator';
import { colors, radius, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<MaintenanceStackParamList, 'ChoreTemplates'>;
type Filter = 'available' | 'all';

const CHORE_ORANGE = '#F57C00';

export default function ChoreTemplatesScreen() {
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('available');

  const templatesQ = useQuery({
    queryKey: ['chore-templates'],
    queryFn: async () => (await choresApi.templates()).data,
  });
  const choresQ = useQuery({ queryKey: ['chores', 'list'], queryFn: async () => (await choresApi.list()).data });

  const usedIds = useMemo(
    () => new Set((choresQ.data ?? []).map((c: any) => c.templateId).filter(Boolean) as string[]),
    [choresQ.data]
  );

  const create = useMutation({
    mutationFn: (templateId: string) => choresApi.fromTemplate({ templateIds: [templateId] }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['chores'] });
      const created = res.data?.[0];
      if (created?._id) navigation.replace('ChoreDetail', { id: created._id });
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
    const g: Record<string, ChoreTemplate[]> = {};
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
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
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
                <View style={styles.avatar}>
                  <MaterialCommunityIcons name={mdiName(tpl.icon) as any} size={20} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.cardTitle}>{tpl.title}</Text>
                  <Text style={styles.cardSub}>{recurrenceLabelShort(tpl.recurrence)}</Text>
                  {used ? (
                    <View style={styles.chipRow}>
                      <Badge label="In Use" color={colors.success} />
                    </View>
                  ) : null}
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
    </ScrollView>
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
    gap: spacing.md,
  },
  cardUsed: { opacity: 0.6 },
  avatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: CHORE_ORANGE,
    alignItems: 'center',
    justifyContent: 'center',
  },
  cardTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  cardSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
});
