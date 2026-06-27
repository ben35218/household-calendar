import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { recipeScheduleApi, RecipeSchedule, GroceryItem } from '../../api';
import { Card, Divider } from '../../components/ui';
import { KitchenStackParamList } from '../../navigation/KitchenNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<KitchenStackParamList, 'KitchenHome'>;

// Shopping week starts Sunday (mirrors web startOfShoppingWeek).
function startOfWeek(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  x.setDate(x.getDate() - x.getDay());
  return x;
}
function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function recipeTitle(s: RecipeSchedule) {
  return typeof s.recipeId === 'object' ? s.recipeId.title || 'Recipe' : 'Recipe';
}
function recipeId(s: RecipeSchedule) {
  return typeof s.recipeId === 'object' ? s.recipeId._id : s.recipeId;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export default function PlannerPane() {
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [checked, setChecked] = useState<Record<string, boolean>>({});

  const start = iso(weekStart);
  const endDate = new Date(weekStart);
  endDate.setDate(endDate.getDate() + 6);
  const end = iso(endDate);

  const schedulesQ = useQuery({
    queryKey: ['recipe-schedule', start],
    queryFn: async () => (await recipeScheduleApi.list({ start, end })).data,
  });
  const groceryQ = useQuery({
    queryKey: ['grocery-list', start],
    queryFn: async () => (await recipeScheduleApi.groceryList(start)).data.groceryList,
  });

  const remove = useMutation({
    mutationFn: (id: string) => recipeScheduleApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipe-schedule', start] });
      qc.invalidateQueries({ queryKey: ['grocery-list', start] });
    },
  });

  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(weekStart);
    d.setDate(d.getDate() + i);
    const dateStr = iso(d);
    const today = iso(new Date());
    return {
      date: dateStr,
      dayName: DAY_NAMES[d.getDay()],
      dayNum: d.getDate(),
      isToday: dateStr === today,
      schedules: (schedulesQ.data ?? []).filter(
        (s) => new Date(s.scheduledDate).toISOString().slice(0, 10) === dateStr
      ),
    };
  });

  const shiftWeek = (dir: number) =>
    setWeekStart((w) => {
      const n = new Date(w);
      n.setDate(n.getDate() + dir * 7);
      return n;
    });

  const weekLabel = `${weekStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${endDate.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;

  if (schedulesQ.isLoading) {
    return <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: spacing.xl }} />;
  }

  return (
    <ScrollView style={styles.pane} contentContainerStyle={styles.content}>
      <View style={styles.weekNav}>
        <TouchableOpacity onPress={() => shiftWeek(-1)} style={styles.navBtn}>
          <Ionicons name="chevron-back" size={22} color={colors.primary} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => setWeekStart(startOfWeek(new Date()))}>
          <Text style={styles.weekLabel}>{weekLabel}</Text>
        </TouchableOpacity>
        <TouchableOpacity onPress={() => shiftWeek(1)} style={styles.navBtn}>
          <Ionicons name="chevron-forward" size={22} color={colors.primary} />
        </TouchableOpacity>
      </View>

      {days.map((day) => (
        <Card key={day.date} style={[styles.dayCard, day.isToday && styles.todayCard]}>
          <View style={styles.dayHeader}>
            <Text style={[styles.dayName, day.isToday && styles.todayText]}>
              {day.dayName} {day.dayNum}
            </Text>
          </View>
          {day.schedules.map((s) => (
            <TouchableOpacity
              key={s._id}
              style={styles.schedRow}
              onPress={() => navigation.navigate('RecipeDetail', { id: recipeId(s) })}
            >
              <Ionicons name="restaurant-outline" size={16} color={colors.primary} />
              <Text style={styles.schedTitle}>{recipeTitle(s)}</Text>
              <TouchableOpacity onPress={() => remove.mutate(s._id)}>
                <Ionicons name="close" size={18} color={colors.error} />
              </TouchableOpacity>
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
        ) : (groceryQ.data ?? []).length === 0 ? (
          <Text style={styles.noMeals}>Schedule recipes to build your grocery list.</Text>
        ) : (
          (groceryQ.data ?? []).map((g: GroceryItem) => {
            const on = checked[g.name];
            return (
              <TouchableOpacity
                key={g.name}
                style={styles.grocRow}
                onPress={() => setChecked((c) => ({ ...c, [g.name]: !c[g.name] }))}
              >
                <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? colors.success : colors.textMuted} />
                <Text style={[styles.grocName, on && styles.grocChecked]}>{g.name}</Text>
                {g.amount ? <Text style={styles.grocAmount}>{g.amount}</Text> : null}
              </TouchableOpacity>
            );
          })
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
  dayHeader: { marginBottom: spacing.xs },
  dayName: { fontSize: 14, fontWeight: '700', color: colors.text },
  todayText: { color: colors.primary },
  schedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  schedTitle: { flex: 1, fontSize: 14, color: colors.text },
  noMeals: { fontSize: 13, color: colors.textMuted, paddingVertical: 4 },
  grocCard: { marginTop: spacing.md, padding: 0, paddingTop: spacing.md },
  grocTitle: { fontSize: 16, fontWeight: '700', color: colors.text, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  grocRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 10, paddingHorizontal: spacing.md },
  grocName: { flex: 1, fontSize: 15, color: colors.text },
  grocChecked: { textDecorationLine: 'line-through', color: colors.textMuted },
  grocAmount: { fontSize: 13, color: colors.textMuted },
});
