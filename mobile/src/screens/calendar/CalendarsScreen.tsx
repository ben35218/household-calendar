import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CALENDARS, useCalendarVisibility, useCalendarColors } from '../../lib/calendarPrefs';
import { colors, spacing } from '../../theme';
import type { CalendarStackParamList } from '../../navigation/CalendarNavigator';

// Cog/settings link next to a calendar opens its dedicated feature flow —
// mirrors LINK_TARGETS in client/src/views/CalendarsView.vue.
const LINK_TARGETS: Record<string, keyof CalendarStackParamList> = {
  maintenance: 'MaintenanceHome',
  chores: 'ChoresHome',
  recipes: 'KitchenHome',
  vacations: 'Vacations',
  'canadian-holidays': 'Holidays',
  weather: 'Weather',
};

// Mirrors client/src/views/CalendarsView.vue — per-calendar visibility toggles
// persisted to AsyncStorage and shared with the calendar grid + events list.
export default function CalendarsScreen() {
  const nav = useNavigation<NativeStackNavigationProp<CalendarStackParamList>>();
  const { visibility, setVisible } = useCalendarVisibility();
  const { colors: calColors } = useCalendarColors();

  const groups = [
    { label: 'Basic', items: CALENDARS.filter((c) => c.group === 'basic') },
    { label: 'Advanced', items: CALENDARS.filter((c) => c.group === 'advanced') },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <TouchableOpacity style={styles.colorsBtn} activeOpacity={0.7} onPress={() => nav.navigate('CalendarColors')}>
        <Ionicons name="color-palette-outline" size={20} color={colors.primary} />
        <Text style={styles.colorsBtnText}>Edit calendar colours</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>

      {groups.map((group) => (
        <View key={group.label} style={styles.group}>
          <Text style={styles.groupLabel}>{group.label.toUpperCase()}</Text>
          {group.items.map((cal) => {
            const on = visibility[cal.id] !== false;
            const link = LINK_TARGETS[cal.id];
            return (
              <TouchableOpacity
                key={cal.id}
                style={styles.row}
                activeOpacity={link ? 0.7 : 1}
                disabled={!link}
                onPress={() => link && nav.navigate(link as any)}
              >
                <View style={[styles.accent, { backgroundColor: calColors[cal.id] ?? cal.color, opacity: on ? 1 : 0.25 }]} />
                <Text style={[styles.name, !on && styles.nameOff]}>{cal.name}</Text>
                {link ? <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={styles.chev} /> : null}
                <Switch
                  value={on}
                  onValueChange={(v) => setVisible(cal.id, v)}
                  trackColor={{ true: calColors[cal.id] ?? cal.color }}
                />
              </TouchableOpacity>
            );
          })}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  colorsBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 12, paddingHorizontal: spacing.md, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.lg },
  colorsBtnText: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  group: { marginBottom: spacing.lg },
  groupLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8 },
  accent: { width: 4, height: 36, borderRadius: 2 },
  name: { flex: 1, fontSize: 16, color: colors.text },
  nameOff: { opacity: 0.4 },
  chev: { marginRight: 4 },
});
