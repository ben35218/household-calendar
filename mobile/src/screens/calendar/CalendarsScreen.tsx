import React, { useEffect } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, Switch, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  CALENDARS,
  CalendarDef,
  CustomCalendar,
  useCalendarVisibility,
  useCalendarColors,
  useCustomCalendars,
  useDeletedDefaultCalendars,
  useCalendarOrder,
  sortByCalendarOrder,
  refreshCustomCalendars,
} from '../../lib/calendarPrefs';
import { colors, spacing } from '../../theme';
import type { CalendarStackParamList } from '../../navigation/CalendarNavigator';

// Feature home screen the OPEN button on a calendar's row launches —
// mirrors LINK_TARGETS in client/src/views/CalendarsView.vue.
const LINK_TARGETS: Record<string, keyof CalendarStackParamList> = {
  maintenance: 'MaintenanceHome',
  chores: 'ChoresHome',
  recipes: 'KitchenHome',
  trips: 'Trips',
  birthdays: 'Birthdays',
  weather: 'Weather',
};

// Where a custom calendar sorts: Just me (no sharing), Household (everyone),
// or Shared (specific members / outside people, incl. calendars shared to us).
function customGroup(cal: CustomCalendar): 'justMe' | 'household' | 'shared' {
  if (cal.sharedWithHousehold) return 'household';
  if (!cal.mine || cal.sharedWith.length > 0 || cal.sharedWithOutside.length > 0) return 'shared';
  return 'justMe';
}

// Calendars grouped by who can see them. Every row reads the same way: the
// switch on the left toggles visibility (persisted to AsyncStorage; drives the
// calendar grid + events list), tapping the row opens Edit Calendar, and
// feature-backed calendars add an OPEN button for their home screen. Built-ins
// delete from Edit Calendar (or long-press); Add Calendar restores them.
export default function CalendarsScreen() {
  const nav = useNavigation<NativeStackNavigationProp<CalendarStackParamList>>();
  const { visibility, setVisible } = useCalendarVisibility();
  const { colors: calColors } = useCalendarColors();
  const { calendars: customCalendars } = useCustomCalendars();
  const { deletedIds, deleteDefault } = useDeletedDefaultCalendars();
  const { order } = useCalendarOrder();
  // Pick up calendars a housemate shared since the last background refresh.
  useEffect(() => {
    void refreshCustomCalendars();
  }, []);

  // Honour the display order set in Colours & Order (per-group, so the
  // sharing tiers stay intact while calendars sort within them).
  const defaults = sortByCalendarOrder(CALENDARS.filter((c) => !deletedIds.includes(c.id)), order);
  const inGroup = (g: 'justMe' | 'household' | 'shared') =>
    sortByCalendarOrder(customCalendars.filter((c) => customGroup(c) === g), order);

  // Holiday calendars are custom records now, so they sort by who can see them
  // alongside subscriptions and hand-made calendars.
  const groups: { label: string; defaults: CalendarDef[]; custom: CustomCalendar[] }[] = [
    { label: 'JUST ME', defaults: [], custom: inGroup('justMe') },
    { label: 'HOUSEHOLD', defaults, custom: inGroup('household') },
    { label: 'SHARED', defaults: [], custom: inGroup('shared') },
  ];

  const confirmDeleteDefault = (cal: CalendarDef) => {
    Alert.alert(
      `Delete ${cal.name} calendar?`,
      'Its events will be hidden. You can add it back any time with Add Calendar.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete', style: 'destructive', onPress: () => deleteDefault(cal.id) },
      ]
    );
  };

  // The Add Calendar chooser (new / subscribe / holiday / restore deleted).
  const onAddCalendar = () => nav.navigate('AddCalendarMenu');

  const renderDefault = (cal: CalendarDef) => {
    const on = visibility[cal.id] !== false;
    const link = LINK_TARGETS[cal.id];
    const tint = calColors[cal.id] ?? cal.color;
    return (
      <TouchableOpacity
        key={cal.id}
        style={styles.row}
        activeOpacity={0.7}
        // Feature calendars open their home view; the rest open Edit Calendar.
        // The trailing icon signals which: a launch arrow vs. an edit chevron.
        onPress={() => nav.navigate(link ? (link as any) : 'AddCalendar', link ? undefined : { calendarId: cal.id })}
        onLongPress={() => confirmDeleteDefault(cal)}
        delayLongPress={400}
        accessibilityRole="button"
        accessibilityLabel={link ? `Open ${cal.name}` : `Edit ${cal.name} calendar`}
      >
        <View style={[styles.accent, { backgroundColor: tint, opacity: on ? 1 : 0.25 }]} />
        <Text style={[styles.name, !on && styles.nameOff]}>{cal.name}</Text>
        {link ? (
          <Ionicons name="open-outline" size={18} color={colors.text} style={styles.chev} />
        ) : (
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={styles.chev} />
        )}
        <Switch
          value={on}
          onValueChange={(v) => setVisible(cal.id, v)}
          trackColor={{ true: tint }}
        />
      </TouchableOpacity>
    );
  };

  // Holiday calendars open their holidays editor (which days show); other
  // custom calendars open the Edit Calendar form. The subtitle names the kind.
  const renderCustom = (cal: CustomCalendar) => {
    const on = visibility[cal.id] !== false;
    const isHoliday = !!cal.holiday;
    const subtitle = isHoliday
      ? cal.mine ? 'Holidays' : 'Holidays · Shared with you'
      : cal.feedUrl
      ? cal.mine ? 'Subscription' : 'Subscription · Shared with you'
      : !cal.mine ? 'Shared with you'
      : null;
    return (
      <TouchableOpacity
        key={cal.id}
        style={styles.row}
        activeOpacity={0.7}
        onPress={() =>
          isHoliday
            ? nav.navigate('Holidays', { calendarId: cal.id })
            : nav.navigate('AddCalendar', { calendarId: cal.id })
        }
      >
        <View style={[styles.accent, { backgroundColor: cal.color, opacity: on ? 1 : 0.25 }]} />
        <View style={styles.nameWrap}>
          <Text style={[styles.name, !on && styles.nameOff]}>{cal.name}</Text>
          {subtitle ? <Text style={styles.nameSub}>{subtitle}</Text> : null}
        </View>
        <Ionicons
          name={isHoliday ? 'open-outline' : 'chevron-forward'}
          size={18}
          color={isHoliday ? colors.text : colors.textMuted}
          style={styles.chev}
        />
        <Switch value={on} onValueChange={(v) => setVisible(cal.id, v)} trackColor={{ true: cal.color }} />
      </TouchableOpacity>
    );
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {groups
        .filter((g) => g.defaults.length + g.custom.length > 0)
        .map((group) => (
          <View key={group.label} style={styles.group}>
            <Text style={styles.groupLabel}>{group.label}</Text>
            {group.defaults.map(renderDefault)}
            {group.custom.map(renderCustom)}
          </View>
        ))}

      <TouchableOpacity style={styles.addBtn} activeOpacity={0.7} onPress={onAddCalendar}>
        <Ionicons name="add-circle-outline" size={20} color={colors.primary} />
        <Text style={styles.addBtnText}>Add calendar</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>

      <TouchableOpacity style={styles.colorsBtn} activeOpacity={0.7} onPress={() => nav.navigate('CalendarColors')}>
        <Ionicons name="options-outline" size={20} color={colors.primary} />
        <Text style={styles.colorsBtnText}>Calendar colours & order</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>

      <TouchableOpacity style={styles.printBtn} activeOpacity={0.7} onPress={() => nav.navigate('PrintCalendar')}>
        <Ionicons name="print-outline" size={20} color={colors.primary} />
        <Text style={styles.printBtnText}>Print…</Text>
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  colorsBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 12, paddingHorizontal: spacing.md, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border },
  colorsBtnText: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  printBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 12, paddingHorizontal: spacing.md, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginTop: spacing.sm },
  printBtnText: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  addBtn: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 12, paddingHorizontal: spacing.md, backgroundColor: colors.surface, borderRadius: 12, borderWidth: 1, borderColor: colors.border, marginBottom: spacing.sm },
  addBtnText: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  group: { marginBottom: spacing.lg },
  groupLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 1, marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, paddingVertical: 8 },
  accent: { width: 4, height: 36, borderRadius: 2 },
  name: { flex: 1, fontSize: 16, color: colors.text },
  nameWrap: { flex: 1 },
  nameSub: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  nameOff: { opacity: 0.4 },
  chev: { marginRight: 4 },
});
