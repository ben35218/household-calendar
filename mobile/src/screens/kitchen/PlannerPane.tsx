import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  recipeScheduleApi, inventoryApi, settingsApi,
  RecipeSchedule, GroceryItem, OrganizedGroceryList, GrocerySessionState,
} from '../../api';
import { Button, Card, Divider, Input } from '../../components/ui';
import { KitchenStackParamList } from '../../navigation/KitchenNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<KitchenStackParamList, 'KitchenHome'>;
const TEAL = '#00897B';

function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const recipeTitle = (s: RecipeSchedule) => (typeof s.recipeId === 'object' ? s.recipeId.title || 'Recipe' : 'Recipe');
const recipeId = (s: RecipeSchedule) => (typeof s.recipeId === 'object' ? s.recipeId._id : s.recipeId);
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function PlannerPane() {
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));

  // Grocery session state (persisted server-side per week).
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [substitutions, setSubstitutions] = useState<Record<string, string>>({});
  const [notFound, setNotFound] = useState<Record<string, boolean>>({});
  const [store, setStore] = useState('');
  const [organized, setOrganized] = useState<OrganizedGroceryList | null>(null);
  const [subEditing, setSubEditing] = useState<string | null>(null);
  const [subDraft, setSubDraft] = useState('');
  const hydrating = useRef(false);

  const start = iso(weekStart);
  const endDate = new Date(weekStart);
  endDate.setDate(endDate.getDate() + 6);
  const end = iso(endDate);

  const schedulesQ = useQuery({ queryKey: ['recipe-schedule', start], queryFn: async () => (await recipeScheduleApi.list({ start, end })).data });
  const groceryQ = useQuery({ queryKey: ['grocery-list', start], queryFn: async () => (await recipeScheduleApi.groceryList(start)).data.groceryList });
  const inventoryQ = useQuery({ queryKey: ['inventory', 'active'], queryFn: async () => (await inventoryApi.list({ status: 'active' })).data });
  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: async () => (await settingsApi.get()).data });
  const sessionQ = useQuery({ queryKey: ['grocery-session', start], queryFn: async () => (await recipeScheduleApi.sessionGet(start)).data });

  // Hydrate session when the week (or its saved session) loads.
  useEffect(() => {
    hydrating.current = true;
    const s = sessionQ.data?.state;
    setChecked(s?.checked ?? {});
    setSubstitutions(s?.substitutions ?? {});
    setNotFound(s?.notFound ?? {});
    setStore(s?.store ?? '');
    setOrganized(null);
    setTimeout(() => { hydrating.current = false; }, 0);
  }, [sessionQ.data, start]);

  // Persist session on change (skip during hydration).
  useEffect(() => {
    if (hydrating.current) return;
    const state: GrocerySessionState = { checked, substitutions, notFound, store };
    recipeScheduleApi.sessionPut(start, state).catch(() => {});
  }, [checked, substitutions, notFound, store, start]);

  const remove = useMutation({
    mutationFn: (id: string) => recipeScheduleApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipe-schedule', start] });
      qc.invalidateQueries({ queryKey: ['grocery-list', start] });
    },
  });

  const organize = useMutation({
    mutationFn: () => recipeScheduleApi.organizeGroceryList(groceryQ.data ?? [], store, settingsQ.data?.grocerySections),
    onSuccess: (res) => setOrganized(res.data),
  });

  const haveNames = (inventoryQ.data ?? []).map((i) => i.name.toLowerCase());
  const haveItem = (name: string) => {
    const n = name.toLowerCase();
    return haveNames.some((h) => h.includes(n) || n.includes(h));
  };

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const dateStr = iso(d);
    return {
      date: dateStr, dayName: DAY_NAMES[d.getDay()], dayNum: d.getDate(), isToday: dateStr === iso(new Date()),
      schedules: (schedulesQ.data ?? []).filter((s) => new Date(s.scheduledDate).toISOString().slice(0, 10) === dateStr),
    };
  });

  const shiftWeek = (dir: number) => setWeekStart((w) => { const n = new Date(w); n.setDate(n.getDate() + dir * 7); return n; });
  const weekLabel = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

  function toggleSub(name: string) {
    if (subEditing === name) { setSubEditing(null); return; }
    setSubEditing(name);
    setSubDraft(substitutions[name] ?? '');
  }
  function commitSub(name: string) {
    setSubstitutions((s) => {
      const next = { ...s };
      if (subDraft.trim()) next[name] = subDraft.trim();
      else delete next[name];
      return next;
    });
    setSubEditing(null);
  }

  const renderItem = (g: GroceryItem) => {
    const have = haveItem(g.name);
    const on = checked[g.name];
    const nf = notFound[g.name];
    const struck = have || on || nf;
    return (
      <View key={g.name}>
        <View style={styles.grocRow}>
          {have ? (
            <MaterialCommunityIcons name="home-import-outline" size={20} color={TEAL} />
          ) : (
            <TouchableOpacity onPress={() => setChecked((c) => ({ ...c, [g.name]: !c[g.name] }))}>
              <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? colors.success : colors.textMuted} />
            </TouchableOpacity>
          )}
          <Text style={[styles.grocName, struck && (nf ? styles.grocNotFound : styles.grocChecked)]}>{g.name}</Text>
          {g.amount ? <Text style={styles.grocAmount}>{g.amount}</Text> : null}
          <TouchableOpacity onPress={() => toggleSub(g.name)}>
            <MaterialCommunityIcons name="swap-horizontal" size={18} color={substitutions[g.name] ? TEAL : colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setNotFound((n) => ({ ...n, [g.name]: !n[g.name] }))}>
            <Ionicons name="close-circle-outline" size={18} color={nf ? colors.error : colors.textMuted} />
          </TouchableOpacity>
        </View>
        {substitutions[g.name] && subEditing !== g.name ? (
          <Text style={styles.subNote}>↳ {substitutions[g.name]}</Text>
        ) : null}
        {subEditing === g.name ? (
          <View style={styles.subEdit}>
            <View style={{ flex: 1 }}>
              <Input value={subDraft} onChangeText={setSubDraft} placeholder="Substitution note" onSubmitEditing={() => commitSub(g.name)} />
            </View>
            <Button title="Save" variant="ghost" onPress={() => commitSub(g.name)} />
          </View>
        ) : null}
      </View>
    );
  };

  if (schedulesQ.isLoading) {
    return <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: spacing.xl }} />;
  }

  const list = groceryQ.data ?? [];

  return (
    <ScrollView style={styles.pane} contentContainerStyle={styles.content}>
      <View style={styles.weekNav}>
        <TouchableOpacity onPress={() => shiftWeek(-1)} style={styles.navBtn}><Ionicons name="chevron-back" size={22} color={colors.primary} /></TouchableOpacity>
        <TouchableOpacity onPress={() => setWeekStart(startOfWeek(new Date()))}><Text style={styles.weekLabel}>{weekLabel}</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => shiftWeek(1)} style={styles.navBtn}><Ionicons name="chevron-forward" size={22} color={colors.primary} /></TouchableOpacity>
      </View>

      {days.map((day) => (
        <Card key={day.date} style={[styles.dayCard, day.isToday && styles.todayCard]}>
          <Text style={[styles.dayName, day.isToday && styles.todayText]}>{day.dayName} {day.dayNum}</Text>
          {day.schedules.map((s) => (
            <TouchableOpacity key={s._id} style={styles.schedRow} onPress={() => navigation.navigate('RecipeDetail', { id: recipeId(s) })}>
              <Ionicons name="restaurant-outline" size={16} color={colors.primary} />
              <Text style={styles.schedTitle}>{recipeTitle(s)}</Text>
              <TouchableOpacity onPress={() => remove.mutate(s._id)}><Ionicons name="close" size={18} color={colors.error} /></TouchableOpacity>
            </TouchableOpacity>
          ))}
          {day.schedules.length === 0 ? <Text style={styles.noMeals}>No meals planned</Text> : null}
        </Card>
      ))}

      <Card style={styles.grocCard}>
        <Text style={styles.grocTitle}>Grocery List</Text>
        <Divider />
        {groceryQ.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ margin: spacing.md }} />
        ) : list.length === 0 ? (
          <Text style={styles.noMeals}>Schedule recipes to build your grocery list.</Text>
        ) : (
          <>
            <View style={styles.organizeBar}>
              <View style={{ flex: 1 }}>
                <Input value={store} onChangeText={setStore} placeholder="Store (optional, for aisle order)" />
              </View>
              {organized ? (
                <Button title="Plain list" variant="ghost" onPress={() => setOrganized(null)} />
              ) : (
                <Button title="Organize" variant="ghost" loading={organize.isPending} onPress={() => organize.mutate()} />
              )}
            </View>
            {organized && organized.store_known === false && store ? (
              <Text style={styles.aisleNote}>Aisle info not available for {store} — showing generic section order.</Text>
            ) : null}

            {organized ? (
              organized.categories.map((cat) => (
                <View key={cat.name}>
                  <Text style={styles.catLabel}>{cat.name}</Text>
                  {cat.items.map(renderItem)}
                </View>
              ))
            ) : (
              list.map(renderItem)
            )}

            <View style={styles.grocActions}>
              <Button title="Clear checks" variant="ghost" onPress={() => { setChecked({}); setNotFound({}); }} />
            </View>
          </>
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pane: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  weekNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.md },
  navBtn: { padding: spacing.sm },
  weekLabel: { fontSize: 16, fontWeight: '700', color: colors.text },
  dayCard: { marginBottom: spacing.sm },
  todayCard: { borderColor: colors.primary },
  dayName: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: spacing.xs },
  todayText: { color: colors.primary },
  schedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  schedTitle: { flex: 1, fontSize: 14, color: colors.text },
  noMeals: { fontSize: 13, color: colors.textMuted, paddingVertical: 4, paddingHorizontal: spacing.md },
  grocCard: { marginTop: spacing.md, padding: 0, paddingTop: spacing.md },
  grocTitle: { fontSize: 16, fontWeight: '700', color: colors.text, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  organizeBar: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  aisleNote: { fontSize: 12, color: colors.textMuted, paddingHorizontal: spacing.md, paddingTop: 4 },
  catLabel: { fontSize: 12, fontWeight: '700', color: TEAL, textTransform: 'uppercase', paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: 2 },
  grocRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8, paddingHorizontal: spacing.md },
  grocName: { flex: 1, fontSize: 15, color: colors.text },
  grocChecked: { textDecorationLine: 'line-through', color: colors.textMuted },
  grocNotFound: { textDecorationLine: 'line-through', color: colors.error },
  grocAmount: { fontSize: 13, color: colors.textMuted },
  subNote: { fontSize: 12, color: TEAL, paddingHorizontal: spacing.md + 28, paddingBottom: 6 },
  subEdit: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  grocActions: { flexDirection: 'row', justifyContent: 'flex-end', padding: spacing.md },
});
