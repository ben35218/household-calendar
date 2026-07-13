import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { tasksApi, itemsApi, categoriesApi, propertiesApi, Item, LinkedRef } from '../../api';
import { sealNew } from '../../lib/e2ee';
import { CenteredLoader, SectionHeader, FormError } from '../../components/ui';
import { GroupCard, CardDivider } from '../../components/formStyles';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { TYPE_CATEGORY_MATCH } from '../../lib/itemTypes';
import { MaintenanceStackParamList } from '../../navigation/MaintenanceNavigator';
import { colors, radius, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<MaintenanceStackParamList, 'TaskTemplateReview'>;
type Rt = RouteProp<MaintenanceStackParamList, 'TaskTemplateReview'>;

// Bare items are created with name = content only (categoryId/type/property stay
// plaintext for the server); mirrors ITEM_ENC in ItemFormScreen for what's sealed.
const ITEM_ENC = (p: Record<string, unknown>) => ({ name: p.name });

// Category name → item type (inverse of TYPE_CATEGORY_MATCH); default 'other'.
const CATEGORY_TYPE: Record<string, string> = Object.fromEntries(
  Object.entries(TYPE_CATEGORY_MATCH).map(([type, cat]) => [cat, type])
);

const CREATE_NEW = '__new__';

function refId(ref?: LinkedRef | string | null): string | null {
  if (!ref) return null;
  return typeof ref === 'object' ? ref._id : ref;
}

export default function TaskTemplateReviewScreen() {
  const navigation = useNavigation<Nav>();
  const { templateIds } = useRoute<Rt>().params;
  const accent = useCalendarColors().colors.maintenance;
  const qc = useQueryClient();
  const [error, setError] = useState('');
  // Per category name → chosen item id, or CREATE_NEW.
  const [choice, setChoice] = useState<Record<string, string>>({});

  const templatesQ = useQuery({ queryKey: ['task-templates'], queryFn: async () => (await tasksApi.templates()).data });
  // Shares the ['items','list'] cache with Maintenance/ItemForm (raw rows —
  // item names are plaintext under dual-write, so no decrypt needed here).
  const itemsQ = useQuery({ queryKey: ['items', 'list'], queryFn: async () => (await itemsApi.list()).data });
  const categoriesQ = useQuery({ queryKey: ['categories', 'topLevel'], queryFn: async () => (await categoriesApi.list({ topLevel: 'true' })).data });
  const propertiesQ = useQuery({ queryKey: ['properties'], queryFn: async () => (await propertiesApi.list()).data });

  // The selected templates, grouped by their default category.
  const groups = useMemo(() => {
    const byCat = new Map<string, { category: string; templates: { id: string; title: string }[] }>();
    for (const id of templateIds) {
      const tpl = templatesQ.data?.find((t) => t.id === id);
      if (!tpl) continue;
      const cat = tpl.defaultCategoryName || 'General';
      if (!byCat.has(cat)) byCat.set(cat, { category: cat, templates: [] });
      byCat.get(cat)!.templates.push({ id: tpl.id, title: tpl.title });
    }
    return [...byCat.values()];
  }, [templateIds, templatesQ.data]);

  // Existing items per category name (matched via the category's _id).
  const itemsByCat = useMemo(() => {
    const catId = new Map<string, string>();
    for (const c of categoriesQ.data ?? []) catId.set(c.name, c._id);
    const map = new Map<string, Item[]>();
    for (const g of groups) {
      const cid = catId.get(g.category);
      const items = cid ? (itemsQ.data ?? []).filter((i) => refId(i.categoryId) === cid) : [];
      map.set(g.category, items);
    }
    return map;
  }, [groups, categoriesQ.data, itemsQ.data]);

  // Default each category to its first existing item, else "create new".
  const choiceFor = (cat: string) => choice[cat] ?? (itemsByCat.get(cat)?.[0]?._id ?? CREATE_NEW);

  const submit = useMutation({
    mutationFn: async () => {
      const catId = new Map<string, string>();
      for (const c of categoriesQ.data ?? []) catId.set(c.name, c._id);
      const primaryProperty = propertiesQ.data?.[0]?._id ?? null;

      // Resolve each category to an item id, creating a bare item where chosen.
      const itemForCat = new Map<string, string | undefined>();
      for (const g of groups) {
        const chosen = choiceFor(g.category);
        if (chosen !== CREATE_NEW) {
          itemForCat.set(g.category, chosen);
          continue;
        }
        const type = CATEGORY_TYPE[g.category] || 'other';
        const cid = catId.get(g.category);
        const payload: Record<string, unknown> = { name: g.category, type };
        if (cid) payload.categoryId = cid;
        // Vehicles stand alone; everything else lands on the primary property.
        if (type !== 'vehicle' && primaryProperty) {
          payload.propertyId = primaryProperty;
          payload.location = propertiesQ.data?.[0]?.name;
        }
        const { data } = await itemsApi.create(await sealNew('Item', payload, ITEM_ENC(payload)));
        itemForCat.set(g.category, (data as Item)._id);
      }

      const selections = groups.flatMap((g) =>
        g.templates.map((t) => ({
          templateId: t.id,
          itemId: itemForCat.get(g.category),
          categoryId: catId.get(g.category),
        }))
      );
      return tasksApi.fromTemplate({ selections });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['items'] });
      qc.invalidateQueries({ queryKey: ['tasks'] });
      qc.invalidateQueries({ queryKey: ['maintenance'] });
      navigation.popToTop();
    },
    onError: (e: any) => setError(e.response?.data?.error || 'Could not create tasks'),
  });

  if (templatesQ.isLoading || itemsQ.isLoading || categoriesQ.isLoading) {
    return <CenteredLoader />;
  }

  const taskCount = groups.reduce((n, g) => n + g.templates.length, 0);

  return (
    <View style={styles.screen}>
      <KeyboardAwareScrollView bottomOffset={24} style={styles.screen} contentContainerStyle={styles.content}>
        <Text style={styles.intro}>
          Choose an item for each group. Tasks in a group share one item — we’ll create a placeholder
          item where you don’t have one yet, which you can flesh out later.
        </Text>

        {groups.map((g) => {
          const items = itemsByCat.get(g.category) ?? [];
          const selected = choiceFor(g.category);
          return (
            <View key={g.category} style={styles.group}>
              <SectionHeader>
                {g.category} <Text style={styles.count}>{g.templates.length} task{g.templates.length === 1 ? '' : 's'}</Text>
              </SectionHeader>
              <GroupCard>
                {items.map((it, i) => (
                  <React.Fragment key={it._id}>
                    {i > 0 ? <CardDivider /> : null}
                    <Row
                      icon="cube-outline"
                      label={it.name}
                      selected={selected === it._id}
                      accent={accent}
                      onPress={() => setChoice((c) => ({ ...c, [g.category]: it._id }))}
                    />
                  </React.Fragment>
                ))}
                {items.length ? <CardDivider /> : null}
                <Row
                  icon="add-circle-outline"
                  label={`Create new “${g.category}” item`}
                  selected={selected === CREATE_NEW}
                  accent={accent}
                  onPress={() => setChoice((c) => ({ ...c, [g.category]: CREATE_NEW }))}
                />
              </GroupCard>
            </View>
          );
        })}

        <FormError>{error}</FormError>
      </KeyboardAwareScrollView>

      <View style={styles.footer}>
        <TouchableOpacity
          style={[styles.footerBtn, { backgroundColor: accent }, submit.isPending && styles.footerBtnDisabled]}
          disabled={submit.isPending || taskCount === 0}
          activeOpacity={0.8}
          onPress={() => { setError(''); submit.mutate(); }}
        >
          <Text style={styles.footerBtnText}>
            {submit.isPending ? 'Creating…' : `Add ${taskCount} task${taskCount === 1 ? '' : 's'}`}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

function Row({ icon, label, selected, accent, onPress }: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  selected: boolean;
  accent: string;
  onPress: () => void;
}) {
  return (
    <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={onPress}>
      <Ionicons name={icon} size={20} color={colors.textMuted} style={styles.rowIcon} />
      <Text style={styles.rowLabel} numberOfLines={1}>{label}</Text>
      <Ionicons
        name={selected ? 'radio-button-on' : 'radio-button-off'}
        size={22}
        color={selected ? accent : colors.border}
      />
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  intro: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.md },
  group: { marginBottom: spacing.md },
  count: { color: colors.textMuted, fontWeight: '600' },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingVertical: 12 },
  rowIcon: { marginRight: spacing.sm },
  rowLabel: { flex: 1, fontSize: 15, color: colors.text },
  footer: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  footerBtn: { borderRadius: radius.md, paddingVertical: 14, alignItems: 'center' },
  footerBtnDisabled: { opacity: 0.5 },
  footerBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
});
