import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CALENDARS, useCalendarVisibility } from '../../lib/calendarPrefs';
import { colors, spacing } from '../../theme';
import type { CalendarStackParamList } from '../../navigation/CalendarNavigator';

// Mirrors client/src/views/CalendarsView.vue — per-calendar visibility toggles
// persisted to AsyncStorage and shared with the calendar grid + events list.
export default function CalendarsScreen() {
  const nav = useNavigation<NativeStackNavigationProp<CalendarStackParamList>>();
  const { visibility, setVisible, setAll } = useCalendarVisibility();

  const groups = [
    { label: 'Basic', items: CALENDARS.filter((c) => c.group === 'basic') },
    { label: 'Advanced', items: CALENDARS.filter((c) => c.group === 'advanced') },
  ];

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.topActions}>
        <TouchableOpacity onPress={() => setAll(true)}><Text style={styles.link}>Show all</Text></TouchableOpacity>
        <TouchableOpacity onPress={() => setAll(false)}><Text style={styles.linkMuted}>Hide all</Text></TouchableOpacity>
      </View>

      {groups.map((group) => (
        <View key={group.label} style={styles.group}>
          <Text style={styles.groupLabel}>{group.label.toUpperCase()}</Text>
          {group.items.map((cal) => {
            const on = visibility[cal.id] !== false;
            return (
              <TouchableOpacity key={cal.id} style={styles.row} activeOpacity={0.7} onPress={() => setVisible(cal.id, !on)}>
                <View style={[styles.accent, { backgroundColor: cal.color, opacity: on ? 1 : 0.25 }]} />
                <Text style={[styles.name, !on && styles.nameOff]}>{cal.name}</Text>
                {cal.id === 'canadian-holidays' ? (
                  <TouchableOpacity onPress={() => nav.navigate('Holidays')} style={styles.cog}>
                    <Ionicons name="settings-outline" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                ) : cal.id === 'weather' ? (
                  <TouchableOpacity onPress={() => nav.navigate('Weather')} style={styles.cog}>
                    <Ionicons name="open-outline" size={18} color={colors.textMuted} />
                  </TouchableOpacity>
                ) : null}
                <Switch
                  value={on}
                  onValueChange={(v) => setVisible(cal.id, v)}
                  trackColor={{ true: cal.color }}
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
  topActions: { flexDirection: 'row', gap: spacing.md, marginBottom: spacing.md },
  link: { color: colors.primary, fontWeight: '600', fontSize: 13 },
  linkMuted: { color: colors.textMuted, fontWeight: '600', fontSize: 13 },
  group: { marginBottom: spacing.lg },
  groupLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8 },
  accent: { width: 4, height: 36, borderRadius: 2 },
  name: { flex: 1, fontSize: 16, color: colors.text },
  nameOff: { opacity: 0.4 },
  cog: { padding: 4 },
});
