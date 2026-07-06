import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { CALENDARS, useCalendarColors } from '../../lib/calendarPrefs';
import { colors, spacing, radius } from '../../theme';

// Palette offered for each calendar.
const PRESETS = [
  '#1976D2', '#0288D1', '#00ACC1', '#00897B', '#43A047', '#388E3C',
  '#F9A825', '#F57C00', '#D32F2F', '#C2185B', '#E91E63', '#8E24AA',
  '#7B1FA2', '#5E35B1', '#3949AB', '#546E7A', '#6D4C41', '#455A64',
];

// Lets the user recolour each calendar; changes persist and flow through the
// calendar grid, day view, events list and search via lib/calendar colorOf.
export default function CalendarColorsScreen() {
  const { colors: calColors, setColor, resetColor } = useCalendarColors();
  const [openId, setOpenId] = useState<string | null>(null);
  // Local, instant selection. We only persist + apply app-wide when the panel
  // for a calendar is minimized, so picking a colour feels immediate.
  const [draft, setDraft] = useState<Record<string, string>>({});

  const commit = (id: string) => {
    const picked = draft[id];
    if (picked && picked.toLowerCase() !== (calColors[id] ?? '').toLowerCase()) setColor(id, picked);
    setDraft((d) => {
      const n = { ...d };
      delete n[id];
      return n;
    });
  };

  const togglePanel = (id: string) => {
    if (openId === id) {
      commit(id);
      setOpenId(null);
    } else {
      if (openId) commit(openId);
      setOpenId(id);
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>Tap a calendar, pick a colour, then collapse it to apply.</Text>

      {CALENDARS.map((cal) => {
        const current = draft[cal.id] ?? calColors[cal.id] ?? cal.color;
        const open = openId === cal.id;
        return (
          <View key={cal.id} style={styles.card}>
            <TouchableOpacity style={styles.row} activeOpacity={0.7} onPress={() => togglePanel(cal.id)}>
              <View style={[styles.swatch, { backgroundColor: current }]} />
              <Text style={styles.name}>{cal.name}</Text>
              <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
            </TouchableOpacity>

            {open ? (
              <View style={styles.palette}>
                {PRESETS.map((c) => {
                  const selected = c.toLowerCase() === current.toLowerCase();
                  return (
                    <TouchableOpacity
                      key={c}
                      style={[styles.paletteSwatch, { backgroundColor: c }, selected && styles.paletteSelected]}
                      onPress={() => setDraft((d) => ({ ...d, [cal.id]: c }))}
                    >
                      {selected ? <Ionicons name="checkmark" size={16} color="#fff" /> : null}
                    </TouchableOpacity>
                  );
                })}
                <TouchableOpacity
                  style={styles.resetBtn}
                  onPress={() => {
                    resetColor(cal.id);
                    setDraft((d) => {
                      const n = { ...d };
                      delete n[cal.id];
                      return n;
                    });
                  }}
                >
                  <Ionicons name="refresh" size={14} color={colors.textMuted} />
                  <Text style={styles.resetText}>Reset</Text>
                </TouchableOpacity>
              </View>
            ) : null}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  intro: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, padding: spacing.md },
  swatch: { width: 28, height: 28, borderRadius: 6 },
  name: { flex: 1, fontSize: 16, color: colors.text },
  palette: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md },
  paletteSwatch: { width: 36, height: 36, borderRadius: 18, alignItems: 'center', justifyContent: 'center' },
  paletteSelected: { borderWidth: 3, borderColor: '#fff' },
  resetBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 10, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.border },
  resetText: { color: colors.textMuted, fontSize: 13, fontWeight: '600' },
});
