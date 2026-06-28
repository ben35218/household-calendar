import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { HOLIDAY_DEFS } from '../../lib/holidays';
import { useHolidayPrefs } from '../../lib/calendarPrefs';
import { Card } from '../../components/ui';
import { colors, spacing } from '../../theme';

const GROUP_LABELS: Record<string, string> = {
  cultural: 'Cultural Holidays',
  multicultural: 'Multicultural & Religious Holidays',
};

// Mirrors client/src/views/HolidaysView.vue. Statutory holidays are always on;
// only cultural + multicultural groups are toggleable.
export default function HolidaysScreen() {
  const { isEnabled, toggle, setGroup } = useHolidayPrefs();

  const groups = (['cultural', 'multicultural'] as const).map((key) => ({
    key,
    label: GROUP_LABELS[key],
    defs: HOLIDAY_DEFS.filter((d) => d.group === key),
  }));

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>Choose which cultural holidays to display on your calendar.</Text>

      {groups.map((group) => (
        <Card key={group.key} style={styles.card}>
          <View style={styles.cardHead}>
            <Text style={styles.groupLabel}>{group.label}</Text>
            <View style={styles.headActions}>
              <TouchableOpacity onPress={() => setGroup(group.defs.map((d) => d.id), true)}>
                <Text style={styles.action}>All</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={() => setGroup(group.defs.map((d) => d.id), false)}>
                <Text style={styles.action}>None</Text>
              </TouchableOpacity>
            </View>
          </View>
          {group.defs.map((def) => {
            const on = isEnabled(def.id);
            return (
              <TouchableOpacity key={def.id} style={styles.row} activeOpacity={0.7} onPress={() => toggle(def.id)}>
                <Ionicons
                  name={on ? 'checkbox' : 'square-outline'}
                  size={22}
                  color={on ? colors.primary : colors.textMuted}
                />
                <Text style={styles.name}>{def.name}</Text>
                {group.key === 'multicultural' ? <Text style={styles.approx}>approx.</Text> : null}
              </TouchableOpacity>
            );
          })}
        </Card>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  intro: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 18 },
  card: { marginBottom: spacing.md },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  groupLabel: { fontSize: 15, fontWeight: '700', color: colors.text, flex: 1 },
  headActions: { flexDirection: 'row', gap: spacing.md },
  action: { color: '#D32F2F', fontWeight: '600', fontSize: 13 },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8 },
  name: { flex: 1, fontSize: 14, color: colors.text },
  approx: { fontSize: 11, color: colors.textMuted },
});
