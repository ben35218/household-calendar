import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, ScrollView } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { settingsApi } from '../../api';
import { Card } from '../../components/ui';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { colors, spacing } from '../../theme';
import { DAY_NAMES_FULL, GroceryFrequency, iso, startOfWeek } from './constants';

// Grocery schedule configuration, reached from the Meals view's schedule card
// and the planner's shopping-day badge. Each tap applies immediately.
//
// The biweekly anchor (a known shopping date) fixes which alternating week is
// the shopping week; switching frequency or day re-anchors to the current week,
// and the "Next shopping day" rows let the user flip to the opposite week.
export default function GroceryScheduleScreen() {
  const qc = useQueryClient();
  const accent = useCalendarColors().colors.recipes;

  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: async () => (await settingsApi.get()).data });
  const groceryDay = settingsQ.data?.groceryShoppingDay ?? 6;
  const frequency: GroceryFrequency = settingsQ.data?.groceryFrequency ?? 'weekly';
  const anchor = settingsQ.data?.groceryAnchor ?? null;

  const update = useMutation({
    mutationFn: (patch: Record<string, unknown>) => settingsApi.update(patch),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['settings'] });
      // Shopping-day markers on the calendar views come from the same setting.
      qc.invalidateQueries({ queryKey: ['calendar'] });
      // The server sizes these ranges from the cadence, so refetch even when
      // the period start (the query key) is unchanged.
      qc.invalidateQueries({ queryKey: ['grocery-list'] });
      qc.invalidateQueries({ queryKey: ['recipe-schedule'] });
    },
  });
  const pending = update.isPending;

  // Anchor to the week containing today so the current week stays a shopping
  // week when the cadence or day changes.
  const anchorForToday = (day: number) => iso(startOfWeek(new Date(), day));

  const setFrequency = (f: GroceryFrequency) => {
    if (f === frequency || pending) return;
    update.mutate(f === 'biweekly'
      ? { groceryFrequency: f, groceryAnchor: anchorForToday(groceryDay) }
      : { groceryFrequency: f });
  };
  const setDay = (day: number) => {
    if (day === groceryDay || pending) return;
    update.mutate(frequency === 'biweekly'
      ? { groceryShoppingDay: day, groceryAnchor: anchorForToday(day) }
      : { groceryShoppingDay: day });
  };

  // The two possible upcoming shopping days under a biweekly cadence: the next
  // occurrence of the weekday, and the one a week later.
  const next = new Date();
  next.setHours(0, 0, 0, 0);
  next.setDate(next.getDate() + ((groceryDay - next.getDay() + 7) % 7));
  const candidates = [next, new Date(next.getTime() + 7 * 86400000)];
  const isShoppingWeek = (d: Date) => {
    if (!anchor) return iso(d) === iso(candidates[0]);
    const a = startOfWeek(new Date(`${anchor}T00:00:00`), groceryDay);
    const weeks = Math.round((startOfWeek(d, groceryDay).getTime() - a.getTime()) / 604800000);
    return ((weeks % 2) + 2) % 2 === 0;
  };
  const dateLabel = (d: Date) => d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' });

  const checkRow = (label: string, selected: boolean, onPress: () => void, first: boolean, key?: string) => (
    <TouchableOpacity key={key ?? label} style={[styles.row, !first && styles.rowBorder]} onPress={onPress} disabled={pending}>
      <Text style={[styles.rowLabel, selected && { color: accent, fontWeight: '700' }]}>{label}</Text>
      {selected ? <Ionicons name="checkmark" size={20} color={accent} /> : null}
    </TouchableOpacity>
  );

  if (settingsQ.isLoading) {
    return <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: spacing.xl }} />;
  }

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Text style={styles.hint}>The meal planner and grocery list cover one shopping trip at a time.</Text>

      <Text style={[styles.sectionLabel, { color: accent }]}>How often</Text>
      <Card style={styles.card}>
        {checkRow('Every week', frequency === 'weekly', () => setFrequency('weekly'), true)}
        {checkRow('Every 2 weeks', frequency === 'biweekly', () => setFrequency('biweekly'), false)}
      </Card>

      <Text style={[styles.sectionLabel, { color: accent }]}>Shopping day</Text>
      <Card style={styles.card}>
        {DAY_NAMES_FULL.map((d, i) => checkRow(d, groceryDay === i, () => setDay(i), i === 0, d))}
      </Card>

      {frequency === 'biweekly' ? (
        <>
          <Text style={[styles.sectionLabel, { color: accent }]}>Next shopping day</Text>
          <Card style={styles.card}>
            {candidates.map((d, i) =>
              checkRow(dateLabel(d), isShoppingWeek(d), () => update.mutate({ groceryAnchor: iso(d) }), i === 0, iso(d))
            )}
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: spacing.xl },
  hint: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm },
  sectionLabel: { fontSize: 12, fontWeight: '700', textTransform: 'uppercase', marginTop: spacing.md, marginBottom: spacing.xs },
  card: { paddingVertical: 0 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 13 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  rowLabel: { fontSize: 15, color: colors.text },
});
