import React, { useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, FlatList, TouchableOpacity, useWindowDimensions, NativeSyntheticEvent, NativeScrollEvent } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useQuery } from '@tanstack/react-query';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { CalendarData, Chore } from '../../api';
import { loadCalendarData } from '../../lib/calendarData';
import { useAuth } from '../../store/auth';
import { weekBars, WeekBar, CALENDAR_COLORS, eventColor, ymd } from '../../lib/calendar';
import { getCanadianHolidays } from '../../lib/holidays';
import { useCalendarVisibility, useHolidayPrefs, useCalendarColors } from '../../lib/calendarPrefs';
import { mdiName } from '../../lib/recurrence';
import { CalendarStackParamList } from '../../navigation/CalendarNavigator';
import { colors, spacing } from '../../theme';
import AssistantIcon from '../../components/AssistantIcon';
import { useAiEnabled } from '../../lib/privacyPrefs';

type Nav = NativeStackNavigationProp<CalendarStackParamList, 'CalendarHome'>;

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

// Solid backing for the floating button clusters (one solid background per group).
const PILL_BG = colors.surface;
const BTN_FG = '#fff';
const TOP_BAR_ROW = 52; // button-row height below the status bar
const HEADER_MONTH_H = 40; // sticky "Month Year" row in the fixed header

// Layout metrics. Week rows are sized to their content, clamped to [MIN,MAX].
const WEEKDAY_ROW_H = 26;
const DAY_NUM_H = 26;     // centered date number
const BAR_H = 17;         // one spanning-bar lane
const CHIP_H1 = 20;       // one-line chip slot (incl. margin)
const CHIP_H2 = 34;       // two-line chip slot (incl. margin)
const CHIP_H3 = 48;       // three-line chip slot (title + start time; incl. margin)
const MORE_H = 14;        // "+N more"
const ICON_ROW_H = 22;    // task/chore/recipe/grocery icon row
const VPAD = 8;
const MIN_WEEK = 96;
const MAX_WEEK = 210;
const CHIP_MAX = 3;

const HOLIDAY_COLOR = CALENDAR_COLORS['canadian-holidays'];
const BIRTHDAY_COLOR = CALENDAR_COLORS.birthdays;

const pad = (n: number) => String(n).padStart(2, '0');
// Date-only / all-day records are stored at noon UTC, so read in UTC.
const ld = (s: string) => new Date(s).toISOString().slice(0, 10);
// Timed events are real instants → read in the device's local zone.
const eventLd = (e: { allDay?: boolean }, iso: string) => (e.allDay ? ld(iso) : ymd(new Date(iso)));
// Compact start-time label for chips: on-the-hour drops the minutes ("9:00 AM" → "9AM").
const chipTimeLabel = (iso: string) =>
  new Date(iso)
    .toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    .replace(':00', '')
    .replace(/\s+/g, '');

type Chip = { key: string; label: string; color: string; time?: string };
type CellContent = { chips: Chip[]; tasks: number; chores: Chore[]; recipes: number; grocery: boolean };
type RenderCell = { date: string; day: number; isToday: boolean; content: CellContent };
type RenderWeek = { key: string; cells: RenderCell[]; bars: WeekBar[]; height: number; headerH: number; monthLabel: string };

// 2 past months + current + 9 future, matching the web's initView window.
function monthWindow(): { year: number; month: number }[] {
  const base = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(base.getFullYear(), base.getMonth() + (i - 2), 1);
    return { year: d.getFullYear(), month: d.getMonth() };
  });
}

export default function CalendarScreen() {
  const navigation = useNavigation<Nav>();
  const insets = useSafeAreaInsets();
  const aiEnabled = useAiEnabled();
  const { user } = useAuth();
  const { width } = useWindowDimensions();
  const { visibility } = useCalendarVisibility();
  const { enabledIds } = useHolidayPrefs();
  const { colors: calColors } = useCalendarColors();

  const cellSize = (width - spacing.md * 2) / 7;
  const headerH = insets.top + TOP_BAR_ROW + HEADER_MONTH_H + WEEKDAY_ROW_H;
  const topPad = headerH + 8;
  // Approx. characters that fit on one chip line; titles longer than this wrap
  // to a second line (titles are capped at 2 lines).
  const charsPerLine = Math.max(4, Math.floor((cellSize - 8) / 6.5));
  const titleLines = (label: string) => (label.trim().length > charsPerLine ? 2 : 1);
  // Total chip rows: title lines plus one row for a start time (capped at 3).
  const chipRows = (chip: Chip) => Math.min(3, titleLines(chip.label) + (chip.time ? 1 : 0));
  const chipHeight = (rows: number) => (rows >= 3 ? CHIP_H3 : rows === 2 ? CHIP_H2 : CHIP_H1);
  const listRef = useRef<FlatList<RenderWeek>>(null);

  const win = useMemo(monthWindow, []);
  const range = useMemo(() => {
    const first = new Date(win[0].year, win[0].month, 1);
    const last = new Date(win[win.length - 1].year, win[win.length - 1].month + 1, 0);
    return { from: first.toISOString(), to: last.toISOString(), fromDate: first, toDate: last };
  }, [win]);

  // Continuous (Sunday-first) week grid spanning the whole window: gridStart is
  // the Sunday on/before the first day, rangeEnd the last day of the last month.
  const grid = useMemo(() => {
    const first = new Date(win[0].year, win[0].month, 1);
    const gridStart = new Date(first);
    gridStart.setDate(1 - first.getDay());
    const rangeEnd = new Date(win[win.length - 1].year, win[win.length - 1].month + 1, 0);
    return { gridStart, rangeEnd };
  }, [win]);

  // Open on the week that holds the 1st of the current month.
  const initialWeekIndex = useMemo(() => {
    const now = new Date();
    const monthFirst = new Date(now.getFullYear(), now.getMonth(), 1);
    return Math.max(0, Math.floor((+monthFirst - +grid.gridStart) / (7 * 86400000)));
  }, [grid]);

  const [curIdx, setCurIdx] = useState(initialWeekIndex);

  const calQ = useQuery({
    queryKey: ['calendar', range.from, range.to],
    queryFn: async () => loadCalendarData({ from: range.from, to: range.to }),
  });

  const holidaysByDate = useMemo(() => {
    const map: Record<string, { id: string; name: string; date: string }[]> = {};
    for (const h of getCanadianHolidays(range.fromDate, range.toDate, enabledIds)) {
      (map[h.date] ??= []).push(h);
    }
    return map;
  }, [range, enabledIds]);

  const visible = (id: string) => visibility[id] !== false;

  const visData: CalendarData | undefined = useMemo(() => {
    if (!calQ.data) return undefined;
    return {
      ...calQ.data,
      trips: visible('vacations') ? calQ.data.trips : [],
      events: (calQ.data.events ?? []).filter((e) => visible(e.calendarType)),
    };
  }, [calQ.data, visibility]);

  const { weeks, offsets, todayWeekOffset } = useMemo(() => {
    const data = calQ.data;
    const now = new Date();
    const todayStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;

    const content = (dateStr: string): CellContent => {
      if (!data) return { chips: [], tasks: 0, chores: [], recipes: 0, grocery: false };
      const chips: Chip[] = [];
      if (visible('canadian-holidays')) for (const h of holidaysByDate[dateStr] ?? []) chips.push({ key: `hol-${h.id}`, label: h.name, color: calColors['canadian-holidays'] });
      if (visible('birthdays')) for (const b of data.birthdays ?? []) if (ld(b.date) === dateStr) chips.push({ key: `b-${b.id}`, label: b.name, color: calColors.birthdays });
      for (const e of data.events ?? []) {
        if (!visible(e.calendarType)) continue;
        const start = eventLd(e, e.startDate);
        const end = e.endDate ? eventLd(e, e.endDate) : start;
        if (start === end && start === dateStr) {
          const time = e.allDay ? undefined : chipTimeLabel(e.startDate);
          chips.push({ key: `e-${e._id}`, label: e.title, color: eventColor(e), time });
        }
      }
      const tasks = visible('maintenance') ? (data.tasks ?? []).filter((t) => t.nextDueDate && ld(t.nextDueDate) === dateStr).length : 0;
      const chores = visible('chores') ? (data.chores ?? []).filter((c) => c.nextDueDate && ld(c.nextDueDate) === dateStr) : [];
      const recipes = visible('recipes') ? (data.recipes ?? []).filter((r) => ld(r.scheduledDate) === dateStr).length : 0;
      const grocery = visible('recipes') ? (data.groceryShopping ?? []).some((g) => g.date === dateStr) : false;
      return { chips, tasks, chores, recipes, grocery };
    };

    const cellItemsHeight = (c: CellContent): number => {
      const chipsH = c.chips
        .slice(0, CHIP_MAX)
        .reduce((s, chip) => s + chipHeight(chipRows(chip)), 0);
      const hasIcons = c.tasks > 0 || c.chores.length > 0 || c.recipes > 0 || c.grocery;
      return chipsH + (c.chips.length > CHIP_MAX ? MORE_H : 0) + (hasIcons ? ICON_ROW_H : 0);
    };

    const weeksR: RenderWeek[] = [];
    const cursor = new Date(grid.gridStart);
    while (cursor <= grid.rangeEnd) {
      const cells: RenderCell[] = [];
      let monthLabel = '';
      for (let i = 0; i < 7; i++) {
        const d = new Date(cursor);
        d.setDate(cursor.getDate() + i);
        const dateStr = ymd(d);
        // A week spans at most two months; its Wednesday (index 3) always falls
        // in the majority month, so use it for the sticky-header label.
        if (i === 3) monthLabel = d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
        cells.push({
          date: dateStr,
          day: d.getDate(),
          isToday: dateStr === todayStr,
          content: content(dateStr),
        });
      }
      const weekDates = cells.map((c) => c.date);
      const bars = weekBars(visData, weekDates);
      const headerH = DAY_NUM_H;
      // How many bar lanes actually cover a given column (0 if none).
      const lanesAt = (col: number) =>
        bars.reduce((max, b) => (col >= b.startCol && col <= b.endCol ? Math.max(max, b.lane + 1) : max), 0);
      // Size the week by its single tallest cell: that cell's own bar lanes
      // plus its own items. Adding the week-wide max of each separately would
      // over-allocate when the deepest bar and the tallest item stack live in
      // different cells, leaving a spurious gap above the next week.
      const maxCell = Math.max(0, ...cells.map((c, col) => lanesAt(col) * BAR_H + cellItemsHeight(c.content)));
      const raw = headerH + maxCell + VPAD;
      const height = Math.min(MAX_WEEK, Math.max(MIN_WEEK, raw));
      weeksR.push({ key: weekDates[0], cells, bars, height, headerH, monthLabel });
      cursor.setDate(cursor.getDate() + 7);
    }

    const offs: number[] = [];
    let acc = 0;
    for (const w of weeksR) { offs.push(acc); acc += w.height; }

    const tIdx = weeksR.findIndex((w) => w.cells.some((c) => c.date === todayStr));
    const twOff = tIdx >= 0 ? offs[tIdx] : 0;

    return { weeks: weeksR, offsets: offs, todayWeekOffset: twOff };
  }, [calQ.data, visData, holidaysByDate, visibility, grid, charsPerLine, calColors]);

  // Place today's week at the top of the viewport, just below the sticky header.
  const goToday = () =>
    listRef.current?.scrollToOffset({
      offset: Math.max(0, topPad + todayWeekOffset - headerH),
      animated: true,
    });
  const initial = user?.firstName?.charAt(0).toUpperCase() ?? '?';

  // Track which week sits at the top of the viewport so the sticky header can
  // show that week's "Month Year" label. offsets[i] is week i's top within the content.
  const onScroll = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    const y = e.nativeEvent.contentOffset.y;
    let idx = 0;
    for (let i = 0; i < offsets.length; i++) {
      if (offsets[i] <= y + 1) idx = i;
      else break;
    }
    if (idx !== curIdx) setCurIdx(idx);
  };

  const renderWeek = ({ item: week }: { item: RenderWeek }) => (
    <View style={[styles.weekRow, { height: week.height }]}>
      {week.cells.map((cell, col) => {
        const c = cell.content;
        // Reserve only the bar lanes that actually cover this cell, so days
        // without a spanning event don't inherit blank space from days that do.
        const cellLanes = week.bars.reduce(
          (max, b) => (col >= b.startCol && col <= b.endCol ? Math.max(max, b.lane + 1) : max),
          0,
        );
        return (
          <TouchableOpacity
            key={cell.date}
            style={[styles.dayCell, { width: cellSize, height: week.height }]}
            activeOpacity={0.7}
            onPress={() => navigation.navigate('CalendarDay', { date: cell.date })}
          >
            <View style={[styles.dayHeader, { height: week.headerH }]}>
              <View style={[styles.dayNumWrap, cell.isToday && styles.todayWrap]}>
                <Text style={[styles.dayNum, cell.isToday && styles.todayNum]}>{cell.day}</Text>
              </View>
            </View>

            {/* reserved space for the spanning bars overlaid on this cell */}
            <View style={{ height: cellLanes * BAR_H }} />

            <View style={styles.cellItems}>
              {c.chips.slice(0, CHIP_MAX).map((chip) => (
                <View key={chip.key} style={[styles.chip, { backgroundColor: chip.color, height: chipHeight(chipRows(chip)) - 2 }]}>
                  <Text style={styles.chipText} numberOfLines={titleLines(chip.label)} ellipsizeMode="clip">{chip.label}</Text>
                  {/* numberOfLines={1} keeps the time on one line; ellipsizeMode "clip"
                      cuts off overflow (e.g. "10:30A") with no "…" and no wrapped "M". */}
                  {chip.time ? <Text style={styles.chipTime} numberOfLines={1} ellipsizeMode="clip">{chip.time}</Text> : null}
                </View>
              ))}
              {c.chips.length > CHIP_MAX ? <Text style={styles.moreText}>+{c.chips.length - CHIP_MAX} more</Text> : null}

              <View style={styles.iconRow}>
                {c.tasks > 0 ? <IconChip count={c.tasks} icon="wrench" color={calColors.maintenance} /> : null}
                {c.chores.slice(0, 3).map((ch) => (
                  <MaterialCommunityIcons key={`ch-${ch._id}`} name={mdiName(ch.icon) as any} size={16} color={calColors.chores} />
                ))}
                {c.recipes > 0 ? <IconChip count={c.recipes} icon="silverware-fork-knife" color={calColors.recipes} /> : null}
                {c.grocery ? <MaterialCommunityIcons name="cart" size={16} color={calColors.recipes} /> : null}
              </View>
            </View>
          </TouchableOpacity>
        );
      })}

      {week.bars.map((bar) => (
        <View
          key={bar.key}
          style={[
            styles.spanBar,
            {
              backgroundColor: bar.color,
              left: bar.startCol * cellSize + 1,
              width: (bar.endCol - bar.startCol + 1) * cellSize - 3,
              top: week.headerH + bar.lane * BAR_H,
            },
          ]}
        >
          <Text style={styles.spanBarText} numberOfLines={1} ellipsizeMode="clip">{bar.label}</Text>
        </View>
      ))}
    </View>
  );

  return (
    <View style={styles.screen}>
      {calQ.isLoading ? <ActivityIndicator color={colors.primary} style={[styles.loader, { top: topPad }]} /> : null}
      <FlatList
        ref={listRef}
        data={weeks}
        keyExtractor={(w) => w.key}
        renderItem={renderWeek}
        initialScrollIndex={initialWeekIndex}
        getItemLayout={(_, index) => ({ length: weeks[index].height, offset: offsets[index], index })}
        contentContainerStyle={[styles.content, { paddingTop: topPad }]}
        onScrollToIndexFailed={() => {}}
        onScroll={onScroll}
        scrollEventThrottle={16}
      />

      {/* ── Fixed 3-row header: buttons · sticky Month Year · weekday labels ───── */}
      <View style={[styles.topBar, { height: headerH, paddingTop: insets.top }]}>
        {/* Row 1 — avatar + action buttons */}
        <View style={[styles.headerButtonRow, { height: TOP_BAR_ROW }]}>
          <TouchableOpacity style={styles.avatar} activeOpacity={0.8} onPress={() => navigation.navigate('ProfileHome')}>
            <Text style={styles.avatarText}>{initial}</Text>
          </TouchableOpacity>
          <View style={styles.pill}>
            <TouchableOpacity style={styles.pillBtn} onPress={() => navigation.navigate('Events')}>
              <Ionicons name="list" size={22} color={BTN_FG} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.pillBtn} onPress={() => navigation.navigate('CalendarSearch')}>
              <Ionicons name="search" size={20} color={BTN_FG} />
            </TouchableOpacity>
            <TouchableOpacity style={styles.pillBtn} onPress={() => navigation.navigate('EventForm', {})}>
              <Ionicons name="add" size={26} color={BTN_FG} />
            </TouchableOpacity>
          </View>
        </View>

        {/* Row 2 — current month, updated as the user scrolls */}
        <View style={[styles.headerMonthRow, { height: HEADER_MONTH_H }]}>
          <Text style={styles.monthLabel}>{weeks[curIdx]?.monthLabel}</Text>
        </View>

        {/* Row 3 — weekday labels */}
        <View style={[styles.weekdayRow, { height: WEEKDAY_ROW_H }]}>
          {WEEKDAYS.map((d, i) => (
            <View key={i} style={[styles.weekdayCell, { width: cellSize }]}>
              <Text style={styles.weekdayText}>{d}</Text>
            </View>
          ))}
        </View>
      </View>

      {/* ── Bottom-left: Today ───────────────────────────────────────────────── */}
      <View style={[styles.pill, styles.bottomLeft, { bottom: insets.bottom + 16 }]}>
        <TouchableOpacity style={styles.todayBtn} onPress={goToday}>
          <Text style={styles.todayText}>Today</Text>
        </TouchableOpacity>
      </View>

      {/* ── Bottom-right: Calendars + Assistant (assistant on the right) ──────── */}
      <View style={[styles.pill, styles.bottomRight, { bottom: insets.bottom + 16 }]}>
        <TouchableOpacity style={styles.bottomPillBtn} onPress={() => navigation.navigate('Calendars')}>
          <MaterialCommunityIcons name="calendar-multiple" size={22} color={BTN_FG} />
        </TouchableOpacity>
        {aiEnabled && (
          <TouchableOpacity style={styles.bottomPillBtn} onPress={() => navigation.navigate('CalendarAssistant')}>
            <AssistantIcon size={22} color={BTN_FG} />
          </TouchableOpacity>
        )}
      </View>
    </View>
  );
}

// A small icon with a count (e.g. 2 maintenance tasks).
function IconChip({ count, icon, color }: { count: number; icon: string; color: string }) {
  return (
    <View style={styles.iconChip}>
      <MaterialCommunityIcons name={icon as any} size={16} color={color} />
      {count > 1 ? <Text style={[styles.iconCount, { color }]}>{count}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#000' },
  loader: { position: 'absolute', alignSelf: 'center', zIndex: 1 },
  content: { paddingHorizontal: spacing.md, paddingBottom: 96 },
  monthLabel: { fontSize: 20, fontWeight: '700', color: colors.text },
  weekdayRow: { flexDirection: 'row' },
  weekdayCell: { alignItems: 'center', paddingVertical: 4 },
  weekdayText: { fontSize: 13, color: colors.textMuted, fontWeight: '600' },
  weekRow: { flexDirection: 'row', position: 'relative', borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  dayCell: { paddingTop: 2, paddingHorizontal: 2, overflow: 'hidden' },
  dayHeader: { alignItems: 'center', justifyContent: 'flex-start' },
  dayNumWrap: { minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 4, alignItems: 'center', justifyContent: 'center' },
  todayWrap: { backgroundColor: colors.primary },
  dayNum: { fontSize: 15, color: colors.text, fontWeight: '600' },
  todayNum: { color: '#fff', fontWeight: '700' },
  spanBar: { position: 'absolute', height: BAR_H - 2, borderRadius: 3, justifyContent: 'center', paddingHorizontal: 4 },
  spanBarText: { fontSize: 12, lineHeight: 13, color: '#fff', fontWeight: '600' },
  cellItems: { flex: 1 },
  chip: { borderRadius: 4, paddingHorizontal: 4, paddingVertical: 1, marginBottom: 2, justifyContent: 'center', overflow: 'hidden' },
  chipText: { fontSize: 12, lineHeight: 13, color: '#fff', fontWeight: '600' },
  chipTime: { fontSize: 10, lineHeight: 12, color: 'rgba(255,255,255,0.85)', fontWeight: '600', marginTop: 1 },
  moreText: { fontSize: 11, fontWeight: '600', color: colors.textMuted, paddingLeft: 2 },
  iconRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 3, marginBottom: 2 },
  iconChip: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  iconCount: { fontSize: 11, fontWeight: '700' },

  // ── Top bar + floating buttons ──
  topBar: {
    position: 'absolute', top: 0, left: 0, right: 0, zIndex: 10,
    paddingHorizontal: spacing.md, backgroundColor: '#000',
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  headerButtonRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerMonthRow: { justifyContent: 'center' },
  avatar: {
    width: 44, height: 44, borderRadius: 22, backgroundColor: PILL_BG,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  avatarText: { color: BTN_FG, fontSize: 18, fontWeight: '700' },
  pill: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: PILL_BG, borderRadius: 999,
    paddingHorizontal: 6, paddingVertical: 4,
    shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 4, shadowOffset: { width: 0, height: 2 }, elevation: 3,
  },
  bottomLeft: { position: 'absolute', left: spacing.md, zIndex: 10 },
  bottomRight: { position: 'absolute', right: spacing.md, zIndex: 10 },
  pillBtn: { paddingHorizontal: 8, paddingVertical: 6 },
  bottomPillBtn: { paddingHorizontal: 12, paddingVertical: 6 },
  todayBtn: { paddingHorizontal: 22, paddingVertical: 6 },
  todayText: { color: BTN_FG, fontSize: 17, fontWeight: '700' },
});
