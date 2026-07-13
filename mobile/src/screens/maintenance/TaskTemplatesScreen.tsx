import React, { useLayoutEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { tasksApi, itemsApi, propertiesApi, TaskTemplate, LinkedRef } from '../../api';
import { Input, SegmentedControl, Badge, SectionHeader, CenteredLoader } from '../../components/ui';
import { recurrenceLabelShort } from '../../lib/recurrence';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { MaintenanceStackParamList } from '../../navigation/MaintenanceNavigator';
import { colors, radius, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<MaintenanceStackParamList, 'TaskTemplates'>;
type Rt = RouteProp<MaintenanceStackParamList, 'TaskTemplates'>;
type Filter = 'available' | 'all';

export default function TaskTemplatesScreen() {
  const navigation = useNavigation<Nav>();
  const { mode, categoryName, itemId } = useRoute<Rt>().params || {};
  const isMulti = mode === 'multi';
  const accent = useCalendarColors().colors.maintenance;
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Filter>('available');
  // Multi-select flow: ids checked off before continuing to the review step.
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // Collapsed category names (tap a header to fold/unfold its templates).
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const toggleCollapsed = (cat: string) =>
    setCollapsed((prev) => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });

  useLayoutEffect(() => {
    if (isMulti) navigation.setOptions({ title: 'Select Tasks' });
  }, [navigation, isMulti]);

  const templatesQ = useQuery({
    queryKey: ['task-templates'],
    queryFn: async () => (await tasksApi.templates()).data,
  });
  const tasksQ = useQuery({ queryKey: ['tasks', 'list'], queryFn: async () => (await tasksApi.list()).data });
  const itemsQ = useQuery({ queryKey: ['items', 'list'], queryFn: async () => (await itemsApi.list()).data });
  const propertiesQ = useQuery({ queryKey: ['properties'], queryFn: async () => (await propertiesApi.list()).data });

  const refId = (ref?: LinkedRef | string | null): string | null =>
    ref ? (typeof ref === 'object' ? ref._id : ref) : null;

  // Item id → its property id, so we can tell which property a task belongs to.
  const itemProperty = useMemo(() => {
    const m = new Map<string, string | null>();
    for (const it of itemsQ.data ?? []) m.set(it._id, refId(it.propertyId));
    return m;
  }, [itemsQ.data]);

  // Which property this list is browsed for: the linked item's property when
  // opened from an item, else the household's primary property.
  const contextPropertyId = itemId
    ? itemProperty.get(itemId) ?? null
    : propertiesQ.data?.[0]?._id ?? null;

  // A template is "in use" only for the property it's already applied to, so the
  // same template stays available for other properties. Tasks with no property
  // (unlinked, or an item without one) block in every context.
  const usedIds = useMemo(() => {
    const s = new Set<string>();
    for (const t of tasksQ.data ?? []) {
      if (!t.templateId) continue;
      const pid = refId(t.itemId) ? itemProperty.get(refId(t.itemId)!) ?? null : null;
      if (!pid || pid === contextPropertyId) s.add(t.templateId);
    }
    return s;
  }, [tasksQ.data, itemProperty, contextPropertyId]);

  // Single-tap flow: create one task and jump to it. When opened from an item,
  // link the new task to it (so the block scopes to that item's property).
  const create = useMutation({
    mutationFn: (templateId: string) =>
      tasksApi.fromTemplate(itemId ? { selections: [{ templateId, itemId }] } : { templateIds: [templateId] }),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      const created = res.data?.[0];
      if (created?._id) navigation.replace('TaskDetail', { id: created._id });
      else navigation.goBack();
    },
  });

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const grouped = useMemo(() => {
    let list = templatesQ.data ?? [];
    // Scope to one category when browsing templates for a known item.
    if (categoryName) list = list.filter((t) => t.defaultCategoryName === categoryName);
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
  }, [templatesQ.data, usedIds, filter, search, categoryName]);

  if (templatesQ.isLoading) {
    return <CenteredLoader />;
  }

  return (
    <View style={styles.screen}>
      <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" style={styles.screen} contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={templatesQ.isRefetching} onRefresh={templatesQ.refetch} />}
      >
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

        {Object.entries(grouped).map(([cat, items]) => {
          const isCollapsed = collapsed.has(cat);
          return (
            <View key={cat} style={styles.group}>
              <TouchableOpacity style={styles.groupHeader} activeOpacity={0.7} onPress={() => toggleCollapsed(cat)}>
                <Ionicons
                  name={isCollapsed ? 'chevron-forward' : 'chevron-down'}
                  size={16}
                  color={colors.textMuted}
                  style={styles.groupChevron}
                />
                <SectionHeader style={styles.groupTitle}>
                  {cat} <Text style={styles.groupCount}>{items.length}</Text>
                </SectionHeader>
              </TouchableOpacity>
              {isCollapsed
                ? null
                : items.map((tpl) => {
                    const used = usedIds.has(tpl.id);
                    const busy = create.isPending && create.variables === tpl.id;
                    const checked = selected.has(tpl.id);
                    return (
                      <TouchableOpacity
                        key={tpl.id}
                        style={[styles.card, checked && { borderColor: accent }, !isMulti && used && styles.cardUsed]}
                        disabled={isMulti ? false : used || create.isPending}
                        onPress={() => (isMulti ? toggle(tpl.id) : create.mutate(tpl.id))}
                        activeOpacity={0.7}
                      >
                        <View style={{ flex: 1 }}>
                          <Text style={styles.cardTitle}>{tpl.title}</Text>
                          <Text style={styles.cardSub}>{recurrenceLabelShort(tpl.recurrence)}</Text>
                          {used ? (
                            <View style={styles.chipRow}>
                              <Badge label="In Use" color={colors.success} />
                            </View>
                          ) : null}
                        </View>
                        {isMulti ? (
                          <Ionicons
                            name={checked ? 'checkmark-circle' : 'ellipse-outline'}
                            size={24}
                            color={checked ? accent : colors.border}
                          />
                        ) : busy ? (
                          <ActivityIndicator color={colors.primary} />
                        ) : !used ? (
                          <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
                        ) : null}
                      </TouchableOpacity>
                    );
                  })}
            </View>
          );
        })}
      </KeyboardAwareScrollView>

      {isMulti ? (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.footerBtn, { backgroundColor: accent }, selected.size === 0 && styles.footerBtnDisabled]}
            disabled={selected.size === 0}
            activeOpacity={0.8}
            onPress={() => navigation.navigate('TaskTemplateReview', { templateIds: [...selected] })}
          >
            <Text style={styles.footerBtnText}>
              {selected.size ? `Link ${selected.size} task${selected.size === 1 ? '' : 's'} →` : 'Select tasks to continue'}
            </Text>
          </TouchableOpacity>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  toolbar: { marginBottom: spacing.md },
  group: { marginBottom: spacing.lg },
  groupHeader: { flexDirection: 'row', alignItems: 'center' },
  groupChevron: { marginRight: 6, marginBottom: spacing.sm },
  groupTitle: { flex: 1 },
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
  footer: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  footerBtn: { borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
  footerBtnDisabled: { opacity: 0.4 },
  footerBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
