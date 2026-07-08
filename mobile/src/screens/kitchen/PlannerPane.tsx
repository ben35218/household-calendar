import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity, Modal } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  recipeScheduleApi, inventoryApi, settingsApi,
  RecipeSchedule, GroceryItem, OrganizedGroceryList, GrocerySessionState,
} from '../../api';
import { Card, Divider, Input } from '../../components/ui';
import AiUsageBanner from '../../components/AiUsageBanner';
import { KitchenStackParamList } from '../../navigation/KitchenNavigator';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<KitchenStackParamList, 'KitchenHome'>;

// Start the week on the grocery shopping day (0=Sun..6=Sat): the most recent
// occurrence of that weekday on or before `d`.
function startOfWeek(d: Date, weekStartDay: number): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  const diff = (x.getDay() - weekStartDay + 7) % 7;
  x.setDate(x.getDate() - diff);
  return x;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const recipeTitle = (s: RecipeSchedule) => (typeof s.recipeId === 'object' ? s.recipeId.title || 'Recipe' : 'Recipe');
const recipeId = (s: RecipeSchedule) => (typeof s.recipeId === 'object' ? s.recipeId._id : s.recipeId);
const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DAY_NAMES_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export default function PlannerPane() {
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const accent = useCalendarColors().colors.recipes;
  // Set after scheduling a freshly-created recipe: scroll to reveal its day.
  const scrollToDate = useRoute<RouteProp<KitchenStackParamList, 'KitchenHome'>>().params?.scrollToDate;
  const scrollRef = useRef<ScrollView>(null);
  const dayOffsets = useRef<Record<string, number>>({});
  // Default grocery day is Saturday (6) until settings load; realigned below.
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), 6));
  const alignedToSettings = useRef(false);
  const [dayPickerOpen, setDayPickerOpen] = useState(false);

  // Grocery session state (persisted server-side per week).
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  const [substitutions, setSubstitutions] = useState<Record<string, string>>({});
  const [notFound, setNotFound] = useState<Record<string, boolean>>({});
  const [haveHome, setHaveHome] = useState<Record<string, boolean>>({});
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

  const groceryDay = settingsQ.data?.groceryShoppingDay ?? 6;

  // Once settings load, realign the current week to start on the grocery day.
  useEffect(() => {
    if (settingsQ.data && !alignedToSettings.current) {
      alignedToSettings.current = true;
      setWeekStart(startOfWeek(new Date(), groceryDay));
    }
  }, [settingsQ.data, groceryDay]);

  // Hydrate session when the week (or its saved session) loads.
  useEffect(() => {
    hydrating.current = true;
    const s = sessionQ.data;
    setChecked(s?.checked ?? {});
    setSubstitutions(s?.substitutions ?? {});
    setNotFound(s?.notFound ?? {});
    setHaveHome(s?.haveHome ?? {});
    setOrganized(s?.organizedList ?? null);
    setTimeout(() => { hydrating.current = false; }, 0);
  }, [sessionQ.data, start]);

  // Persist session on change (skip during hydration). Also write the state into
  // the query cache so a quick unmount/remount (e.g. switching Kitchen tabs)
  // rehydrates the latest edits instead of the pre-edit cached value — the
  // 30s global staleTime would otherwise serve stale data without refetching.
  useEffect(() => {
    if (hydrating.current) return;
    const state: GrocerySessionState = { checked, substitutions, notFound, haveHome, organizedList: organized };
    qc.setQueryData(['grocery-session', start], state);
    recipeScheduleApi.sessionPut(start, state).catch(() => {});
  }, [checked, substitutions, notFound, haveHome, organized, start, qc]);

  // Reveal a just-scheduled recipe's day, then clear the param so returning here
  // later doesn't re-scroll. The delay lets the refreshed schedule (the new meal
  // row) finish laying out before we read the day's offset.
  useEffect(() => {
    if (!scrollToDate) return;
    const t = setTimeout(() => {
      const y = dayOffsets.current[scrollToDate];
      if (y != null) scrollRef.current?.scrollTo({ y: Math.max(0, y - spacing.md), animated: true });
      navigation.setParams({ scrollToDate: undefined });
    }, 250);
    return () => clearTimeout(t);
  }, [scrollToDate, schedulesQ.data, navigation]);

  const setGroceryDay = useMutation({
    mutationFn: (day: number) => settingsApi.update({ groceryShoppingDay: day }),
    onSuccess: (_res, day) => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      setWeekStart(startOfWeek(new Date(), day));
      setDayPickerOpen(false);
    },
  });

  const remove = useMutation({
    mutationFn: (id: string) => recipeScheduleApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipe-schedule', start] });
      qc.invalidateQueries({ queryKey: ['grocery-list', start] });
    },
  });

  const organize = useMutation({
    mutationFn: () => recipeScheduleApi.organizeGroceryList(groceryQ.data ?? [], settingsQ.data?.grocerySections),
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
      isGroceryDay: d.getDay() === groceryDay,
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
    const autoHave = haveItem(g.name);
    const markedHome = !!haveHome[g.name];
    const have = autoHave || markedHome;
    const on = checked[g.name];
    const nf = notFound[g.name];
    const struck = have || on || nf;
    // When an item is substituted, its checkbox moves next to the substitution
    // note below (rendered in the substitution's accent color).
    const subbed = !!substitutions[g.name] && subEditing !== g.name;
    return (
      <View key={g.name}>
        <View style={styles.grocRow}>
          {have ? (
            <MaterialCommunityIcons name="home-import-outline" size={20} color={accent} />
          ) : subbed ? (
            <MaterialCommunityIcons name="subdirectory-arrow-right" size={20} color={accent} />
          ) : (
            <TouchableOpacity onPress={() => setChecked((c) => ({ ...c, [g.name]: !c[g.name] }))}>
              {nf ? (
                <MaterialCommunityIcons name="close-box" size={20} color={colors.error} />
              ) : (
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? colors.success : colors.textMuted} />
              )}
            </TouchableOpacity>
          )}
          <Text style={[styles.grocName, subbed ? { color: accent } : (struck && (nf ? styles.grocNotFound : styles.grocChecked))]}>{g.name}</Text>
          {g.amount ? <Text style={styles.grocAmount}>{g.amount}</Text> : null}
          <TouchableOpacity onPress={() => setHaveHome((h) => ({ ...h, [g.name]: !h[g.name] }))}>
            <MaterialCommunityIcons name={have ? 'home' : 'home-outline'} size={18} color={have ? accent : colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => toggleSub(g.name)}>
            <MaterialCommunityIcons name="swap-horizontal" size={18} color={substitutions[g.name] ? accent : colors.textMuted} />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => setNotFound((n) => ({ ...n, [g.name]: !n[g.name] }))}>
            <Ionicons name="close-circle-outline" size={18} color={nf ? colors.error : colors.textMuted} />
          </TouchableOpacity>
        </View>
        {subbed ? (
          <View style={styles.subRow}>
            <TouchableOpacity onPress={() => setChecked((c) => ({ ...c, [g.name]: !c[g.name] }))}>
              <Ionicons name={on ? 'checkbox' : 'square-outline'} size={18} color={on ? colors.success : colors.textMuted} />
            </TouchableOpacity>
            <Text style={[styles.subNote, on && styles.grocChecked]}>{substitutions[g.name]}</Text>
          </View>
        ) : null}
        {subEditing === g.name ? (
          <View style={styles.subEdit}>
            <View style={styles.subEditField}>
              <Input value={subDraft} onChangeText={setSubDraft} autoFocus onSubmitEditing={() => commitSub(g.name)} />
            </View>
            <TouchableOpacity style={[styles.saveBtn, { backgroundColor: accent }]} onPress={() => commitSub(g.name)}>
              <Text style={styles.saveBtnText}>Save</Text>
            </TouchableOpacity>
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
    <>
    <ScrollView ref={scrollRef} style={styles.pane} contentContainerStyle={styles.content}>
      <View style={styles.weekNav}>
        <TouchableOpacity onPress={() => shiftWeek(-1)} style={styles.navBtn}><Ionicons name="chevron-back" size={22} color={colors.primary} /></TouchableOpacity>
        <TouchableOpacity onPress={() => setWeekStart(startOfWeek(new Date(), groceryDay))}><Text style={styles.weekLabel}>{weekLabel}</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => shiftWeek(1)} style={styles.navBtn}><Ionicons name="chevron-forward" size={22} color={colors.primary} /></TouchableOpacity>
      </View>

      {days.map((day) => (
        <TouchableOpacity
          key={day.date}
          activeOpacity={0.85}
          onLayout={(e) => { dayOffsets.current[day.date] = e.nativeEvent.layout.y; }}
          onPress={() => navigation.navigate('AddMeal', { date: day.date })}
        >
          <Card style={[styles.dayCard, day.isToday && styles.todayCard]}>
            <View style={styles.dayHeader}>
              <Text style={[styles.dayName, day.isToday && styles.todayText]}>{day.dayName} {day.dayNum}</Text>
              {day.isGroceryDay ? (
                <TouchableOpacity style={styles.grocDayBadge} onPress={() => setDayPickerOpen(true)}>
                  <Ionicons name="cart" size={13} color={accent} />
                  <Text style={[styles.grocDayText, { color: accent }]}>Grocery shopping day</Text>
                  <Ionicons name="pencil" size={12} color={accent} />
                </TouchableOpacity>
              ) : null}
            </View>
            {day.schedules.map((s) => (
              <TouchableOpacity key={s._id} style={styles.schedRow} onPress={() => navigation.navigate('RecipeDetail', { id: recipeId(s) })}>
                <Ionicons name="restaurant-outline" size={16} color={colors.primary} />
                <Text style={styles.schedTitle}>{recipeTitle(s)}</Text>
                <TouchableOpacity onPress={() => remove.mutate(s._id)}><Ionicons name="close" size={18} color={colors.error} /></TouchableOpacity>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.addRow} onPress={() => navigation.navigate('AddMeal', { date: day.date })}>
              <Ionicons name="add" size={16} color={accent} />
              <Text style={[styles.addText, { color: accent }]}>Add recipe</Text>
            </TouchableOpacity>
          </Card>
        </TouchableOpacity>
      ))}

      <Card style={styles.grocCard}>
        <View style={styles.grocHeader}>
          <Text style={styles.grocTitle}>Grocery List</Text>
          <View style={styles.grocHeaderActions}>
            {list.length > 0 && !groceryQ.isLoading ? (
              organized ? (
                <TouchableOpacity style={[styles.organizeBtn, { backgroundColor: accent }]} onPress={() => setOrganized(null)}>
                  <Text style={styles.organizeBtnText}>Plain list</Text>
                </TouchableOpacity>
              ) : (
                <TouchableOpacity
                  style={[styles.organizeBtn, { backgroundColor: accent }, organize.isPending && { opacity: 0.6 }]}
                  disabled={organize.isPending}
                  onPress={() => organize.mutate()}
                >
                  {organize.isPending ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.organizeBtnText}>Organize</Text>
                  )}
                </TouchableOpacity>
              )
            ) : null}
            <TouchableOpacity onPress={() => navigation.navigate('MealPlannerSettings')} style={styles.grocHeaderBtn}>
              <MaterialCommunityIcons name="sort" size={20} color={accent} />
            </TouchableOpacity>
          </View>
        </View>
        <Divider />
        {/* Organize is an AI call; this card warns as the weekly budget runs
            down and, at 100%, explains why Organize is refused (taps to Plan). */}
        <AiUsageBanner />
        {groceryQ.isLoading ? (
          <ActivityIndicator color={colors.primary} style={{ margin: spacing.md }} />
        ) : list.length === 0 ? (
          <Text style={styles.noMeals}>Schedule recipes to build your grocery list.</Text>
        ) : (
          <>
            {organized ? (
              organized.categories.map((cat) => (
                <View key={cat.name}>
                  <Text style={[styles.catLabel, { color: accent }]}>{cat.name}</Text>
                  {cat.items.map(renderItem)}
                </View>
              ))
            ) : (
              list.map(renderItem)
            )}

            <View style={styles.grocActions}>
              <TouchableOpacity style={[styles.clearBtn, { backgroundColor: accent }]} onPress={() => { setChecked({}); setNotFound({}); setSubstitutions({}); setHaveHome({}); }}>
                <Text style={styles.clearBtnText}>Clear</Text>
              </TouchableOpacity>
            </View>
          </>
        )}
      </Card>
    </ScrollView>

    <Modal visible={dayPickerOpen} transparent animationType="fade" onRequestClose={() => setDayPickerOpen(false)}>
      <TouchableOpacity style={styles.modalBackdrop} activeOpacity={1} onPress={() => setDayPickerOpen(false)}>
        <View style={styles.modalCard}>
          <Text style={styles.modalTitle}>Grocery shopping day</Text>
          <Text style={styles.modalSubtitle}>The planner week starts on this day.</Text>
          {DAY_NAMES_FULL.map((d, i) => (
            <TouchableOpacity key={d} style={styles.modalDayRow} onPress={() => setGroceryDay.mutate(i)} disabled={setGroceryDay.isPending}>
              <Text style={[styles.modalDayName, groceryDay === i && { color: accent, fontWeight: '700' }]}>{d}</Text>
              {setGroceryDay.isPending && setGroceryDay.variables === i ? (
                <ActivityIndicator size="small" color={accent} />
              ) : groceryDay === i ? (
                <Ionicons name="checkmark" size={20} color={accent} />
              ) : null}
            </TouchableOpacity>
          ))}
        </View>
      </TouchableOpacity>
    </Modal>
    </>
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
  dayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  dayName: { fontSize: 14, fontWeight: '700', color: colors.text },
  grocDayBadge: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  grocDayText: { fontSize: 12, fontWeight: '600' },
  todayText: { color: colors.primary },
  schedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  schedTitle: { flex: 1, fontSize: 14, color: colors.text },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  addText: { fontSize: 13, fontWeight: '600' },
  noMeals: { fontSize: 13, color: colors.textMuted, paddingVertical: 4, paddingHorizontal: spacing.md },
  grocCard: { marginTop: spacing.md, padding: 0, paddingTop: spacing.md },
  grocHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  grocHeaderBtn: { padding: 4 },
  grocHeaderActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  organizeBtn: { borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center' },
  organizeBtnText: { color: '#fff', fontSize: 13, fontWeight: '600' },
  saveBtn: { borderRadius: 12, paddingVertical: 10, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  saveBtnText: { color: '#fff', fontSize: 15, fontWeight: '600' },
  grocTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  catLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', paddingHorizontal: spacing.md, paddingTop: spacing.md, paddingBottom: 2 },
  grocRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8, paddingHorizontal: spacing.md },
  grocName: { flex: 1, fontSize: 15, color: colors.text },
  grocChecked: { textDecorationLine: 'line-through', color: colors.textMuted },
  grocNotFound: { textDecorationLine: 'line-through', color: colors.error },
  grocAmount: { fontSize: 13, color: colors.textMuted },
  subRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: 6 },
  subNote: { flex: 1, fontSize: 15, color: colors.text },
  subEdit: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  // Cancel the shared Input's bottom margin so the Save button aligns to the
  // field's top and bottom instead of sitting slightly below it.
  subEditField: { flex: 1, marginBottom: -spacing.md },
  grocActions: { padding: spacing.md },
  clearBtn: { borderRadius: 12, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  clearBtnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: spacing.lg },
  modalCard: { backgroundColor: colors.surface, borderRadius: 14, padding: spacing.md },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  modalSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2, marginBottom: spacing.sm },
  modalDayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  modalDayName: { fontSize: 15, color: colors.text },
});
