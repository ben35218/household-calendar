import React, { useEffect, useLayoutEffect, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '../../api';
import { Card, SegmentedControl } from '../../components/ui';
import PlannerPane from './PlannerPane';
import GroceryPane from './GroceryPane';
import { GroceryFrequency, iso, periodDaysOf, periodStartOf, scheduleSummary, startOfWeek } from './constants';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { colors, spacing } from '../../theme';
import type { KitchenStackParamList } from '../../navigation/KitchenNavigator';
import type { KitchenPane } from '../../navigation/types';

type Nav = NativeStackNavigationProp<KitchenStackParamList>;

export default function KitchenScreen() {
  const [pane, setPane] = useState<KitchenPane>('planner');
  const navigation = useNavigation<Nav>();
  const params = useRoute<RouteProp<KitchenStackParamList, 'KitchenHome'>>().params;
  const scrollToDate = params?.scrollToDate;
  const paneParam = params?.pane;
  const accent = useCalendarColors().colors.recipes;

  // The Planner and Grocery panes share one shopping period (a week — or two,
  // for biweekly shoppers — starting on the grocery shopping day) so flipping
  // between them shows the same span.
  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: async () => (await settingsApi.get()).data });
  const groceryDay = settingsQ.data?.groceryShoppingDay ?? 6;
  const frequency: GroceryFrequency = settingsQ.data?.groceryFrequency ?? 'weekly';
  const anchor = settingsQ.data?.groceryAnchor ?? null;
  const periodDays = periodDaysOf(frequency);
  const settingsLoaded = !!settingsQ.data;
  // Default: weekly on Saturday (6) until settings load; realigned below.
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date(), 6));

  // Realign the period once settings load, and again if the schedule changes
  // (the schedule modal only invalidates the settings query).
  useEffect(() => {
    if (settingsLoaded) setWeekStart(periodStartOf(new Date(), groceryDay, frequency, anchor));
  }, [settingsLoaded, groceryDay, frequency, anchor]);

  // Landing here to reveal a freshly-scheduled recipe: make sure the Planner
  // is the active pane so PlannerPane can scroll there.
  useEffect(() => {
    if (scrollToDate) setPane('planner');
  }, [scrollToDate]);

  // Direct pane requests (e.g. the calendar's shopping-day row → grocery);
  // clear the param so returning here later doesn't re-apply it.
  useEffect(() => {
    if (paneParam) {
      setPane(paneParam);
      navigation.setParams({ pane: undefined });
    }
  }, [paneParam, navigation]);

  // The recipe library entry point lives in the header's top-right corner.
  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <TouchableOpacity style={styles.recipesBtn} onPress={() => navigation.navigate('Recipes')}>
          <MaterialCommunityIcons name="book-open-variant" size={15} color="#fff" />
          <Text style={styles.recipesBtnText}>Recipes</Text>
        </TouchableOpacity>
      ),
    });
  }, [navigation]);

  const endDate = new Date(weekStart);
  endDate.setDate(endDate.getDate() + periodDays - 1);
  // The current and next periods read as words; anything further shows dates.
  const currentStart = periodStartOf(new Date(), groceryDay, frequency, anchor);
  const nextStart = new Date(currentStart);
  nextStart.setDate(nextStart.getDate() + periodDays);
  const onCurrent = iso(weekStart) === iso(currentStart);
  const weekLabel = onCurrent ? 'This Week'
    : iso(weekStart) === iso(nextStart) ? 'Next Week'
    : `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
  const shiftWeek = (dir: number) => setWeekStart((w) => { const n = new Date(w); n.setDate(n.getDate() + dir * periodDays); return n; });

  return (
    <View style={styles.screen}>
      <TouchableOpacity activeOpacity={0.85} style={styles.scheduleWrap} onPress={() => navigation.navigate('GrocerySchedule')}>
        <Card style={styles.scheduleCard}>
          <Ionicons name="calendar-outline" size={18} color={accent} />
          <View style={styles.scheduleCardText}>
            <Text style={styles.scheduleCardTitle}>Grocery Schedule</Text>
            <Text style={styles.scheduleCardSummary}>{scheduleSummary(groceryDay, frequency)}</Text>
          </View>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </Card>
      </TouchableOpacity>
      <View style={styles.weekNav}>
        <TouchableOpacity onPress={() => shiftWeek(-1)} style={styles.navBtn}><Ionicons name="chevron-back" size={22} color={colors.primary} /></TouchableOpacity>
        <TouchableOpacity onPress={() => setWeekStart(currentStart)}>
          <Text style={styles.weekLabel}>{weekLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => shiftWeek(1)} style={styles.navBtn}><Ionicons name="chevron-forward" size={22} color={colors.primary} /></TouchableOpacity>
      </View>
      <View style={styles.segmentWrap}>
        <SegmentedControl<KitchenPane>
          value={pane}
          onChange={setPane}
          options={[
            { label: 'Meal Planner', value: 'planner' },
            { label: 'Grocery List', value: 'grocery' },
          ]}
        />
      </View>
      <View style={styles.body}>
        {pane === 'grocery'
          ? <GroceryPane weekStart={weekStart} onShowPlanner={() => setPane('planner')} />
          : <PlannerPane weekStart={weekStart} />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scheduleWrap: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  scheduleCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  scheduleCardText: { flex: 1 },
  scheduleCardTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  scheduleCardSummary: { fontSize: 13, color: colors.textMuted, marginTop: 1 },
  segmentWrap: { padding: spacing.md, paddingBottom: spacing.sm },
  // Transparent header button, white like the rest of the header chrome.
  recipesBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingVertical: 6, paddingHorizontal: 4 },
  recipesBtnText: { fontSize: 14, fontWeight: '600', color: '#fff' },
  // The chevrons' own touch padding (navBtn) renders as part of the gap, so
  // only a small top margin is needed to match the stack's vertical rhythm.
  weekNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: spacing.md, marginTop: spacing.sm },
  navBtn: { padding: spacing.sm },
  weekLabel: { fontSize: 16, fontWeight: '700', color: colors.text },
  body: { flex: 1 },
});
