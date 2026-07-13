import React, { forwardRef, useImperativeHandle, useMemo, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, FlatList } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { loadCalendarData } from '../../lib/calendarData';
import { getHolidays } from '../../lib/holidays';
import { useCalendarVisibility, useHolidayCalendars, holidayEnabledIds, useCalendarColors } from '../../lib/calendarPrefs';
import { SegmentedControl } from '../../components/ui';
import { colors, spacing } from '../../theme';
import type { CalendarStackParamList } from '../../navigation/CalendarNavigator';

type Nav = NativeStackNavigationProp<CalendarStackParamList>;

// Imperative handle shared with CalendarGrid so the host's single Today button
// can drive whichever layer is active.
export type TodayHandle = { scrollToToday: (animated?: boolean) => void };

const TOP_BAR_ROW = 52; // matches CalendarScreen's floating button row

// Lazy data window. loadCalendarData decrypts and recurrence-expands the whole
// requested range on-device, so a fixed ±5y load is the expensive part — not
// the list itself (already virtualized). Start with a generous window around
// today and widen by 2-year chunks when the user scrolls near either edge,
// capped at ±5y (the old fixed range).
const INITIAL_PAST_MONTHS = 12;
const INITIAL_FUTURE_MONTHS = 24;
const EXTEND_MONTHS = 24;
const MAX_MONTHS = 60;
// Extend the past once the user scrolls within ~3 screens of the top.
const PAST_TRIGGER_PX = 2400;

// Fixed row heights — deterministic so getItemLayout is exact, which lets the
// list paint directly at the Today marker via initialScrollIndex (no scroll-from-top).
const FILTER_H = 56;
const TODAY_H = 48;
const HEADER_H = 40;
const ITEM_H1 = 60; // one line  (card 52 + 8 margin)
const ITEM_H2 = 76; // two lines (card 68 + 8 margin)
const CARD_H1 = 52;
const CARD_H2 = 68;
const EMPTY_H = 240;

const CAL_ICONS: Record<string, string> = {
  maintenance: 'wrench', activities: 'run', appointments: 'stethoscope',
  chores: 'broom', birthdays: 'cake-variant',
};

// Icon for a calendar row: per-country holiday calendars (holiday-XX) all use a
// flag; everything else falls back to CAL_ICONS.
const iconForCalendar = (calendarType: string): string =>
  CAL_ICONS[calendarType] ?? (calendarType.startsWith('holiday-') ? 'flag' : 'calendar');

type AgendaItem = {
  _id: string;
  calendarType: string;
  title: string;
  startDate: string;
  endDate?: string;
  allDay: boolean;
  secondary?: string | null;
  nav?: () => void;
};

// Flattened rows so the agenda can be virtualized (opens fast, lazy-renders) and
// jumped to the Today marker by index.
type Row =
  | { kind: 'filter'; key: string }
  | { kind: 'today'; key: string }
  | { kind: 'header'; key: string; label: string }
  | { kind: 'item'; key: string; item: AgendaItem }
  | { kind: 'empty'; key: string };

function rowHeight(r: Row): number {
  switch (r.kind) {
    case 'filter': return FILTER_H;
    case 'today': return TODAY_H;
    case 'header': return HEADER_H;
    case 'empty': return EMPTY_H;
    case 'item': return r.item.secondary ? ITEM_H2 : ITEM_H1;
  }
}

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
  const start = new Date(item.startDate).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
  if (!item.endDate) return start;
  return `${start} – ${new Date(item.endDate).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true })}`;
}

// Mirrors client/src/views/EventsView.vue — a unified agenda of tasks, chores,
// events, and holidays grouped by day with a Today marker; opens painted
// directly at Today. Rendered as a content layer inside CalendarScreen's view
// toggle: the host owns all floating chrome (avatar, pills) and crossfades this
// layer against the month grid, so this draws no buttons of its own — just the
// list and a black backdrop under the host's top button row.
const AgendaView = forwardRef<TodayHandle>(function AgendaView(_props, ref) {
  const nav = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const { visibility } = useCalendarVisibility();
  const { calendars: holidayCals } = useHolidayCalendars();
  const { colors: calColors } = useCalendarColors();
  const [timeFilter, setTimeFilter] = React.useState<'all' | 'upcoming' | 'past'>('all');

  const listRef = useRef<FlatList<Row>>(null);
  const topOffset = insets.top + TOP_BAR_ROW + 8;

  const [pastMonths, setPastMonths] = React.useState(INITIAL_PAST_MONTHS);
  const [futureMonths, setFutureMonths] = React.useState(INITIAL_FUTURE_MONTHS);

  const range = useMemo(() => {
    const now = new Date();
    const from = new Date(now.getFullYear(), now.getMonth() - pastMonths, now.getDate());
    const to = new Date(now.getFullYear(), now.getMonth() + futureMonths, now.getDate());
    return { from, to };
  }, [pastMonths, futureMonths]);

  // placeholderData keeps the current rows on screen while a widened window
  // loads, so extending the range never blanks the list back to a spinner.
  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['calendar', 'events-list', pastMonths, futureMonths],
    queryFn: async () =>
      loadCalendarData({ from: range.from.toISOString(), to: range.to.toISOString() }),
    placeholderData: (prev) => prev,
  });

  // Widening is scroll-driven and idempotent at the caps; skip directions the
  // active filter can't show, and don't stack loads while one is in flight.
  const extendPast = () => {
    if (isFetching || timeFilter === 'upcoming') return;
    setPastMonths((m) => Math.min(MAX_MONTHS, m + EXTEND_MONTHS));
  };
  const extendFuture = () => {
    if (isFetching || timeFilter === 'past') return;
    setFutureMonths((m) => Math.min(MAX_MONTHS, m + EXTEND_MONTHS));
  };

  // Build flattened rows + the index of the Today marker + per-row offsets.
  const { rows, todayIndex, offsets } = useMemo(() => {
    const out: Row[] = [{ kind: 'filter', key: 'filter' }];
    let tIdx = -1;

    if (data) {
      const items: AgendaItem[] = [];
      for (const t of data.tasks ?? []) {
        if (!t.nextDueDate) continue;
        items.push({
          _id: t._id, calendarType: 'maintenance', title: t.title, startDate: t.nextDueDate,
          allDay: true, nav: () => nav.navigate('TaskDetail', { id: t._id }),
        });
      }
      for (const c of data.chores ?? []) {
        if (!c.nextDueDate) continue;
        items.push({
          _id: c._id, calendarType: 'chores', title: c.title, startDate: c.nextDueDate,
          allDay: true, secondary: c.description ?? null, nav: () => nav.navigate('ChoreDetail', { id: c._id }),
        });
      }
      for (const e of data.events ?? []) {
        items.push({
          _id: e._id, calendarType: e.calendarType, title: e.title, startDate: e.startDate,
          endDate: e.endDate, allDay: !!e.allDay, secondary: e.location ?? e.description ?? null,
          nav: () => nav.navigate('EventForm', { eventId: e._id }),
        });
      }
      for (const b of data.birthdays ?? []) {
        items.push({
          _id: `bday-${b.id}`, calendarType: 'birthdays', title: `${b.name}'s Birthday`,
          startDate: b.date + 'T12:00:00Z', allDay: true,
        });
      }
      for (const cal of holidayCals) {
        for (const h of getHolidays(cal.country, range.from, range.to, holidayEnabledIds(cal))) {
          items.push({
            _id: `${cal.id}-${h.date}-${h.id}`, calendarType: cal.id, title: h.name,
            startDate: h.date + 'T12:00:00Z', allDay: true,
          });
        }
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
      const dates = Array.from(map.keys());
      const todayDate = dates.find((d) => d >= today);

      for (const date of dates) {
        if (date === todayDate) {
          tIdx = out.length;
          out.push({ kind: 'today', key: 'today' });
        }
        out.push({ kind: 'header', key: `h-${date}`, label: dayLabel(date) });
        for (const item of map.get(date)!) out.push({ kind: 'item', key: `${date}-${item._id}`, item });
      }
      if (out.length === 1) out.push({ kind: 'empty', key: 'empty' });
    }

    // Cumulative offsets — getItemLayout offset deliberately EXCLUDES the
    // contentContainer top padding so scrollToIndex/initialScrollIndex land the
    // row just below the floating top buttons (a constant topOffset gap).
    const offs: number[] = [];
    let acc = 0;
    for (const r of out) { offs.push(acc); acc += rowHeight(r); }

    return { rows: out, todayIndex: tIdx, offsets: offs };
  }, [data, visibility, holidayCals, timeFilter, range, nav]);

  const scrollToToday = (animated: boolean) => {
    if (todayIndex < 0) return;
    listRef.current?.scrollToIndex({ index: todayIndex, animated });
  };

  useImperativeHandle(ref, () => ({ scrollToToday: (animated = true) => scrollToToday(animated) }));

  const renderRow = ({ item: row }: { item: Row }) => {
    if (row.kind === 'filter') {
      return (
        <View style={styles.filterRow}>
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
      );
    }
    if (row.kind === 'empty') {
      return (
        <View style={[styles.center, { height: EMPTY_H }]}>
          <Ionicons name="calendar-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>No events.</Text>
        </View>
      );
    }
    if (row.kind === 'today') {
      return (
        <View style={styles.todayDivider}>
          <View style={styles.todayLine} />
          <Text style={styles.todayLabel}>TODAY</Text>
          <View style={styles.todayLine} />
        </View>
      );
    }
    if (row.kind === 'header') {
      return (
        <View style={styles.headerWrap}>
          <Text style={styles.dateLabel}>{row.label.toUpperCase()}</Text>
        </View>
      );
    }
    const item = row.item;
    const color = calColors[item.calendarType] ?? '#9E9E9E';
    const RowWrap: any = item.nav ? TouchableOpacity : View;
    return (
      <RowWrap
        style={[styles.card, { height: item.secondary ? CARD_H2 : CARD_H1 }]}
        onPress={item.nav}
        activeOpacity={0.7}
      >
        <MaterialCommunityIcons
          name={iconForCalendar(item.calendarType) as any}
          size={24}
          color={color}
          style={styles.cardIcon}
        />
        <View style={styles.cardText}>
          <Text style={styles.cardTitle} numberOfLines={1}>{item.title}</Text>
          {item.secondary ? <Text style={styles.cardSub} numberOfLines={1}>{item.secondary}</Text> : null}
        </View>
        <Text style={styles.cardTime}>{timeLabel(item)}</Text>
      </RowWrap>
    );
  };

  return (
    <View style={styles.container}>
      {isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : (
        <FlatList
          ref={listRef}
          data={rows}
          keyExtractor={(r) => r.key}
          renderItem={renderRow}
          getItemLayout={(_, index) => ({ length: rowHeight(rows[index]), offset: offsets[index], index })}
          initialScrollIndex={todayIndex >= 0 ? todayIndex : undefined}
          contentContainerStyle={{ paddingHorizontal: spacing.md, paddingTop: topOffset, paddingBottom: insets.bottom + 80 }}
          initialNumToRender={20}
          windowSize={11}
          onScroll={(e) => {
            if (e.nativeEvent.contentOffset.y < PAST_TRIGGER_PX) extendPast();
          }}
          scrollEventThrottle={32}
          onEndReached={extendFuture}
          onEndReachedThreshold={2}
          // Keep the viewport anchored when a past extension prepends rows.
          maintainVisibleContentPosition={{ minIndexForVisible: 0 }}
          // Visible while widening toward the future (a past widening fills in
          // above the viewport, so no indicator is needed there).
          ListFooterComponent={
            isFetching && !isLoading ? <ActivityIndicator color={colors.primary} style={styles.footerLoader} /> : null
          }
          onScrollToIndexFailed={(info) => {
            listRef.current?.scrollToOffset({ offset: info.averageItemLength * info.index, animated: false });
            setTimeout(() => scrollToToday(false), 60);
          }}
        />
      )}

      {/* Black backdrop so scrolled content doesn't show behind the host's top buttons. */}
      <View style={[styles.topBackdrop, { height: insets.top + TOP_BAR_ROW }]} />
    </View>
  );
});

export default AgendaView;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#000' },
  filterRow: { height: FILTER_H, justifyContent: 'flex-start', paddingBottom: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: { color: colors.textMuted, marginTop: spacing.sm },
  todayDivider: { height: TODAY_H, flexDirection: 'row', alignItems: 'center', gap: 8 },
  todayLine: { flex: 1, height: 2, backgroundColor: colors.primary, borderRadius: 1 },
  todayLabel: { color: colors.primary, fontWeight: '700', fontSize: 12, letterSpacing: 1 },
  headerWrap: { height: HEADER_H, justifyContent: 'flex-end', paddingBottom: spacing.sm },
  dateLabel: { fontSize: 11, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5 },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface, borderRadius: 12, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  cardIcon: { marginRight: spacing.md },
  cardText: { flex: 1, minWidth: 0 },
  cardTitle: { fontSize: 15, fontWeight: '500', color: colors.text },
  cardSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  cardTime: { fontSize: 12, color: colors.textMuted, marginLeft: spacing.sm },
  topBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, backgroundColor: '#000', zIndex: 10 },
  footerLoader: { paddingVertical: spacing.lg },
});
