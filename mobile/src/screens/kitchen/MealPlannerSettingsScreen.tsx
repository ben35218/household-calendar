import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../../api';
import { Button, Card, Input } from '../../components/ui';
import { colors, spacing } from '../../theme';

const TEAL = '#00897B';
const DEFAULT_SECTIONS = ['Produce', 'Deli', 'Bakery', 'Meat & Seafood', 'Dairy', 'Frozen', 'Pantry', 'Other'];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Mirrors client/src/views/MealPlannerSettingsView.vue.
export default function MealPlannerSettingsScreen() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await settingsApi.get()).data,
  });

  const [groceryDay, setGroceryDay] = useState(6);
  const [dayLoading, setDayLoading] = useState(false);
  const [sections, setSections] = useState<string[]>([...DEFAULT_SECTIONS]);
  const [newSection, setNewSection] = useState('');
  const [sectionSaving, setSectionSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setGroceryDay(settings.groceryShoppingDay ?? 6);
    const gs = (settings.grocerySections as string[] | undefined) ?? [];
    setSections(gs.length ? gs : [...DEFAULT_SECTIONS]);
  }, [settings]);

  async function setDay(day: number) {
    if (day === groceryDay) return;
    setDayLoading(true);
    setGroceryDay(day);
    try {
      await settingsApi.update({ groceryShoppingDay: day });
      qc.invalidateQueries({ queryKey: ['settings'] });
    } finally {
      setDayLoading(false);
    }
  }

  function move(i: number, dir: -1 | 1) {
    const j = i + dir;
    if (j < 0 || j >= sections.length) return;
    const s = [...sections];
    [s[i], s[j]] = [s[j], s[i]];
    setSections(s);
  }
  function addSection() {
    const name = newSection.trim();
    if (!name || sections.includes(name)) return;
    setSections((s) => [...s, name]);
    setNewSection('');
  }
  function removeSection(i: number) {
    setSections((s) => s.filter((_, idx) => idx !== i));
  }
  async function saveOrder() {
    setSectionSaving(true);
    try {
      await settingsApi.update({ grocerySections: sections });
      qc.invalidateQueries({ queryKey: ['settings'] });
    } finally {
      setSectionSaving(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={TEAL} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <Text style={styles.title}>Grocery Shopping Day</Text>
        <Text style={styles.subtitle}>The week starts on this day in the meal planner.</Text>
        {DAYS.map((d, i) => (
          <TouchableOpacity key={d} style={styles.dayRow} onPress={() => setDay(i)} disabled={dayLoading}>
            <Text style={[styles.dayName, groceryDay === i && styles.daySelected]}>{d}</Text>
            {dayLoading && groceryDay === i ? (
              <ActivityIndicator size="small" color={TEAL} />
            ) : groceryDay === i ? (
              <Ionicons name="checkmark" size={20} color={TEAL} />
            ) : null}
          </TouchableOpacity>
        ))}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.title}>Grocery Section Order</Text>
        <Text style={styles.subtitle}>
          Set your preferred shopping order. The assistant uses these sections when organizing your list.
        </Text>
        {sections.map((section, i) => (
          <View key={section} style={styles.sectionRow}>
            <Text style={styles.num}>{i + 1}</Text>
            <Text style={styles.sectionName}>{section}</Text>
            <TouchableOpacity disabled={i === 0} onPress={() => move(i, -1)}>
              <Ionicons name="chevron-up" size={20} color={i === 0 ? colors.border : colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity disabled={i === sections.length - 1} onPress={() => move(i, 1)}>
              <Ionicons name="chevron-down" size={20} color={i === sections.length - 1 ? colors.border : colors.textMuted} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => removeSection(i)}>
              <Ionicons name="close" size={20} color={colors.error} />
            </TouchableOpacity>
          </View>
        ))}
        <View style={styles.addRow}>
          <View style={styles.addInput}>
            <Input value={newSection} onChangeText={setNewSection} placeholder="Add section…" onSubmitEditing={addSection} returnKeyType="done" />
          </View>
          <TouchableOpacity style={styles.addBtn} onPress={addSection}>
            <Ionicons name="add" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
        <View style={styles.formActions}>
          <Button title="Reset to defaults" variant="ghost" onPress={() => setSections([...DEFAULT_SECTIONS])} />
          <Button title="Save Order" onPress={saveOrder} loading={sectionSaving} />
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  card: { marginBottom: spacing.md },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2, marginBottom: spacing.sm, lineHeight: 18 },
  dayRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  dayName: { fontSize: 15, color: colors.text },
  daySelected: { color: TEAL, fontWeight: '700' },
  sectionRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8 },
  num: { width: 18, textAlign: 'right', color: colors.textMuted, fontSize: 12 },
  sectionName: { flex: 1, fontSize: 15, color: colors.text },
  addRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginTop: spacing.sm },
  addInput: { flex: 1 },
  addBtn: { width: 40, height: 40, borderRadius: 8, backgroundColor: TEAL, alignItems: 'center', justifyContent: 'center' },
  formActions: { flexDirection: 'row', justifyContent: 'space-between', marginTop: spacing.sm },
});
