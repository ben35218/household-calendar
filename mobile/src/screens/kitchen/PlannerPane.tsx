import React, { useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, ScrollView } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { recipeScheduleApi, settingsApi, RecipeSchedule } from '../../api';
import { Card } from '../../components/ui';
import { KitchenStackParamList } from '../../navigation/KitchenNavigator';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { colors, spacing } from '../../theme';
import { DAY_NAMES, GroceryFrequency, iso, periodDaysOf } from './constants';

type Nav = NativeStackNavigationProp<KitchenStackParamList, 'KitchenHome'>;

const recipeTitle = (s: RecipeSchedule) => (typeof s.recipeId === 'object' ? s.recipeId.title || 'Recipe' : 'Recipe');
const recipeId = (s: RecipeSchedule) => (typeof s.recipeId === 'object' ? s.recipeId._id : s.recipeId);

// The week's meal schedule (weekStart comes from KitchenScreen so the Grocery
// pane shows the same week). The grocery list itself lives in GroceryPane.
export default function PlannerPane({ weekStart }: { weekStart: Date }) {
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const accent = useCalendarColors().colors.recipes;
  // Set after scheduling a freshly-created recipe: scroll to reveal its day.
  const routeParams = useRoute<RouteProp<KitchenStackParamList, 'KitchenHome'>>().params;
  const scrollToDate = routeParams?.scrollToDate;
  const scrollRef = useRef<ScrollView>(null);
  const dayOffsets = useRef<Record<string, number>>({});

  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: async () => (await settingsApi.get()).data });
  const frequency: GroceryFrequency = settingsQ.data?.groceryFrequency ?? 'weekly';
  const periodDays = periodDaysOf(frequency);

  const start = iso(weekStart);
  const endDate = new Date(weekStart);
  endDate.setDate(endDate.getDate() + periodDays - 1);
  const end = iso(endDate);

  // periodDays is in the key so the range refetches when the cadence changes.
  const schedulesQ = useQuery({ queryKey: ['recipe-schedule', start, periodDays], queryFn: async () => (await recipeScheduleApi.list({ start, end })).data });

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

  const remove = useMutation({
    mutationFn: (id: string) => recipeScheduleApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipe-schedule', start] });
      qc.invalidateQueries({ queryKey: ['grocery-list', start] });
    },
  });

  const days = Array.from({ length: periodDays }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const dateStr = iso(d);
    return {
      date: dateStr, dayName: DAY_NAMES[d.getDay()], dayNum: d.getDate(), isToday: dateStr === iso(new Date()),
      // Only the period's first day is a shopping day (a biweekly period spans
      // two occurrences of the weekday, but only the first gets shopped).
      isGroceryDay: i === 0,
      schedules: (schedulesQ.data ?? []).filter((s) => new Date(s.scheduledDate).toISOString().slice(0, 10) === dateStr),
    };
  });

  if (schedulesQ.isLoading) {
    return <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: spacing.xl }} />;
  }

  return (
    <ScrollView ref={scrollRef} style={styles.pane} contentContainerStyle={styles.content}>
      {days.map((day) => (
        <TouchableOpacity
          key={day.date}
          activeOpacity={0.85}
          onLayout={(e) => { dayOffsets.current[day.date] = e.nativeEvent.layout.y; }}
          onPress={() => navigation.navigate('AddMeal', { date: day.date })}
        >
          <Card style={[styles.dayCard, day.isToday && styles.todayCard]}>
            <View style={styles.dayHeader}>
              <Text style={styles.dayName}>{day.dayName} {day.dayNum}</Text>
              <View style={styles.dayHeaderRight}>
                {day.isGroceryDay ? (
                  <TouchableOpacity onPress={() => navigation.navigate('GrocerySchedule')}>
                    <Text style={[styles.grocDayText, { color: accent }]}>Grocery Shopping Day</Text>
                  </TouchableOpacity>
                ) : null}
                {day.isToday ? <Text style={styles.todayLabel}>Today</Text> : null}
              </View>
            </View>
            {day.schedules.map((s) => (
              <TouchableOpacity key={s._id} style={styles.schedRow} onPress={() => navigation.navigate('RecipeDetail', { id: recipeId(s) })}>
                <Ionicons name="restaurant-outline" size={16} color={colors.primary} />
                <Text style={styles.schedTitle}>{recipeTitle(s)}</Text>
                <TouchableOpacity onPress={() => remove.mutate(s._id)}><Ionicons name="close" size={18} color={colors.error} /></TouchableOpacity>
              </TouchableOpacity>
            ))}
            <TouchableOpacity style={styles.addRow} onPress={() => navigation.navigate('AddMeal', { date: day.date })}>
              <Ionicons name="add" size={16} color="#fff" />
              <Text style={styles.addText}>Add recipe</Text>
            </TouchableOpacity>
          </Card>
        </TouchableOpacity>
      ))}

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  pane: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  dayCard: { marginBottom: spacing.sm },
  todayCard: { borderColor: colors.primary },
  dayHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.xs },
  dayHeaderRight: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dayName: { fontSize: 14, fontWeight: '700', color: colors.text },
  grocDayText: { fontSize: 12, fontWeight: '600' },
  todayLabel: { fontSize: 12, fontWeight: '700', color: colors.primary },
  schedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  schedTitle: { flex: 1, fontSize: 14, color: colors.text },
  addRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingVertical: 6 },
  addText: { fontSize: 13, fontWeight: '600', color: '#fff' },
});
