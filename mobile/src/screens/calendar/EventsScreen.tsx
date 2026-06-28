import React, { useMemo } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { calendarApi } from '../../api';
import { getCanadianHolidays } from '../../lib/holidays';
import { useCalendarVisibility, useHolidayPrefs } from '../../lib/calendarPrefs';
import { SegmentedControl } from '../../components/ui';
import { colors, spacing } from '../../theme';
import type { CalendarStackParamList } from '../../navigation/CalendarNavigator';

type Nav = NativeStackNavigationProp<CalendarStackParamList>;

const CAL_COLORS: Record<string, string> = {
  maintenance: '#1976D2', activities: '#388E3C', appointments: '#7B1FA2',
  chores: '#F57C00', 'canadian-holidays': '#D32F2F', birthdays: '#E91E63',
};
const CAL_ICONS: Record<string, string> = {
  maintenance: 'wrench', activities: 'run', appointments: 'stethoscope',
  chores: 'broom', 'canadian-holidays': 'flag', birthdays: 'cake-variant',
};

type AgendaItem = {
  _id: string;
  calendarType: string;
  title: string;
  startDate: string;
  endDate?: string;
  allDay: boolean;
  subtitle?: string | null;
  description?: string | null;
  isCompletion?: boolean;
  nav?: () => void;
};

const ymd = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

function dayLabel(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const today = ymd(new Date());
  const t = new Date();
  const tomorrow = ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1));
  const yesterday = ymd(new Date(t.getFullYear(), t.getMonth(), t.getDate() - 1));
  const md = d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  if (dateStr === today) return `Today · ${md}`;
  if (dateStr === tomorrow) return `Tomorrow · ${md}`;
  if (dateStr === yesterday) return `Yesterday · ${md}`;
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
}

function timeLabel(item: AgendaItem): string {
  if (item.allDay) return 'All day';
  const start = new Date(item.startDate).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (!item.endDate) return start;
  return `${start} – ${new Date(item.endDate).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

// Mirrors client/src/views/EventsView.vue — a unified agenda of tasks, chores,
// events, and holidays grouped by day with a Today marker. (The paused/completed/
// category/item filter menu lands with the shared CalendarFilterMenu in Wave 10.)
export default function EventsScreen() {
  const nav = useNavigation<Nav>();
  const { visibility } = useCalendarVisibility();
  const { enabledIds } = useHolidayPrefs();
  const [timeFilter, setTimeFilter] = React.useState<'all' | 'upcoming' | 'past'>('all');

  const range = useMemo(() => {
    const now = new Date();
    const from = new Date(now.getFullYear() - 5, now.getMonth(), now.getDate());
    const to = new Date(now.getFullYear() + 5, now.getMonth(), now.getDate());
    return { from, to };
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['calendar', 'events-list'],
    queryFn: async () =>
      (await calendarApi.get({ from: range.from.toISOString(), to: range.to.toISOString() })).data,
  });

  const groups = useMemo(() => {
    if (!data) return [];
    const items: AgendaItem[] = [];

    for (const t of data.tasks ?? []) {
      if (!t.nextDueDate) continue;
      items.push({
        _id: t._id, calendarType: 'maintenance', title: t.title, startDate: t.nextDueDate,
        allDay: true, subtitle: null, description: null,
        nav: () => nav.getParent()?.navigate('Tasks' as never),
      });
    }
    for (const c of data.chores ?? []) {
      if (!c.nextDueDate) continue;
      items.push({
        _id: c._id, calendarType: 'chores', title: c.title, startDate: c.nextDueDate,
        allDay: true, description: c.description ?? null,
        nav: () => nav.getParent()?.navigate('Tasks' as never),
      });
    }
    for (const e of data.events ?? []) {
      items.push({
        _id: e._id, calendarType: e.calendarType, title: e.title, startDate: e.startDate,
        endDate: e.endDate, allDay: !!e.allDay, subtitle: e.location ?? null, description: e.description ?? null,
        nav: () => nav.navigate('EventForm', { eventId: e._id }),
      });
    }
    for (const b of data.birthdays ?? []) {
      items.push({
        _id: `bday-${b.id}`, calendarType: 'birthdays', title: `${b.name}'s Birthday`,
        startDate: b.date + 'T12:00:00Z', allDay: true,
      });
    }
    for (const h of getCanadianHolidays(range.from, range.to, enabledIds)) {
      items.push({
        _id: `holiday-${h.date}-${h.id}`, calendarType: 'canadian-holidays', title: h.name,
        startDate: h.date + 'T12:00:00Z', allDay: true,
      });
    }

    const today = ymd(new Date());
    const visible = items.filter((i) => {
      if (visibility[i.calendarType] === false) return false;
      if (timeFilter !== 'all') {
        const d = i.allDay ? new Date(i.startDate).toISOString().slice(0, 10) : ymd(new Date(i.startDate));
        if (timeFilter === 'upcoming' && d < today) return false;
        if (timeFilter === 'past' && d >= today) return false;
      }
      return true;
    });
    visible.sort((a, b) => +new Date(a.startDate) - +new Date(b.startDate));

    const map = new Map<string, AgendaItem[]>();
    for (const item of visible) {
      const dateStr = item.allDay ? new Date(item.startDate).toISOString().slice(0, 10) : ymd(new Date(item.startDate));
      if (!map.has(dateStr)) map.set(dateStr, []);
      map.get(dateStr)!.push(item);
    }
    const arr = Array.from(map.entries()).map(([date, its]) => ({ date, label: dayLabel(date), items: its, todayMarker: false }));
    const firstIdx = arr.findIndex((g) => g.date >= today);
    if (firstIdx !== -1) arr[firstIdx].todayMarker = true;
    return arr;
  }, [data, visibility, enabledIds, timeFilter, range, nav]);

  return (
    <View style={styles.container}>
      <View style={styles.filterBar}>
        <SegmentedControl
          value={timeFilter}
          options={[
            { label: 'All', value: 'all' },
            { label: 'Upcoming', value: 'upcoming' },
            { label: 'Past', value: 'past' },
          ]}
          onChange={setTimeFilter}
        />
      </View>

      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : groups.length === 0 ? (
        <View style={styles.center}>
          <Ionicons name="calendar-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>No events.</Text>
        </View>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>
          {groups.map((group) => (
            <View key={group.date}>
              {group.todayMarker ? (
                <View style={styles.todayDivider}>
                  <View style={styles.todayLine} />
                  <Text style={styles.todayLabel}>TODAY</Text>
                  <View style={styles.todayLine} />
                </View>
              ) : null}
              <Text style={styles.dateLabel}>{group.label.toUpperCase()}</Text>
              {group.items.map((item) => {
                const color = CAL_COLORS[item.calendarType] ?? '#9E9E9E';
                const Row: any = item.nav ? TouchableOpacity : View;
                return (
                  <Row key={item._id} style={styles.card} onPress={item.nav} activeOpacity={0.7}>
                    <MaterialCommunityIcons
                      name={(CAL_ICONS[item.calendarType] ?? 'calendar') as any}
                      size={24}
                      color={color}
                      style={styles.cardIcon}
                    />
                    <View style={styles.cardText}>
                      <Text style={styles.cardTitle}>{item.title}</Text>
                      {item.subtitle ? <Text style={styles.cardSub}>{item.subtitle}</Text> : null}
                      {item.description ? <Text style={styles.cardSub} numberOfLines={2}>{item.description}</Text> : null}
                    </View>
                    <Text style={styles.cardTime}>{timeLabel(item)}</Text>
                  </Row>
                );
              })}
            </View>
          ))}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  filterBar: { padding: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  content: { padding: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: { color: colors.textMuted, marginTop: spacing.sm },
  todayDivider: { flexDirection: 'row', alignItems: 'center', gap: 8, marginVertical: spacing.md },
  todayLine: { flex: 1, height: 2, backgroundColor: colors.primary, borderRadius: 1 },
  todayLabel: { color: colors.primary, fontWeight: '700', fontSize: 12, letterSpacing: 1 },
  dateLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5, marginTop: spacing.md, marginBottom: spacing.sm },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, marginBottom: spacing.sm },
  cardIcon: { marginRight: spacing.md },
  cardText: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 15, fontWeight: '500', color: colors.text },
  cardSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  cardTime: { fontSize: 12, color: colors.textMuted, marginLeft: spacing.sm },
});
