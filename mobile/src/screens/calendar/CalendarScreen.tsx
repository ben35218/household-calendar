import React, { useLayoutEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, FlatList, TouchableOpacity, useWindowDimensions } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { calendarApi } from '../../api';
import { buildMonth, dayDots, weekBars, MonthGrid } from '../../lib/calendar';
import { CalendarStackParamList } from '../../navigation/CalendarNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<CalendarStackParamList, 'CalendarHome'>;

const WEEKDAYS = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

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
  const { width } = useWindowDimensions();
  const cellSize = (width - spacing.md * 2) / 7;

  const win = useMemo(monthWindow, []);
  const range = useMemo(() => {
    const first = new Date(win[0].year, win[0].month, 1);
    const last = new Date(win[win.length - 1].year, win[win.length - 1].month + 1, 0);
    return { from: first.toISOString(), to: last.toISOString() };
  }, [win]);

  const calQ = useQuery({
    queryKey: ['calendar', range.from, range.to],
    queryFn: async () => (await calendarApi.get({ from: range.from, to: range.to })).data,
  });

  const months = useMemo(() => win.map((m) => buildMonth(m.year, m.month)), [win]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerBtns}>
          <TouchableOpacity onPress={() => navigation.navigate('Events')} style={{ paddingHorizontal: 4 }}>
            <Ionicons name="list" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('Calendars')} style={{ paddingHorizontal: 4 }}>
            <Ionicons name="options" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('CalendarAssistant')} style={{ paddingHorizontal: 4 }}>
            <Ionicons name="sparkles" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('EventForm', {})} style={{ paddingHorizontal: 4 }}>
            <Ionicons name="add" size={26} color="#fff" />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation]);

  const renderMonth = ({ item: month }: { item: MonthGrid }) => (
    <View style={styles.monthBlock}>
      <Text style={styles.monthLabel}>{month.label}</Text>
      <View style={styles.weekdayRow}>
        {WEEKDAYS.map((d, i) => (
          <View key={i} style={[styles.weekdayCell, { width: cellSize }]}>
            <Text style={styles.weekdayText}>{d}</Text>
          </View>
        ))}
      </View>
      {month.weeks.map((week, wi) => {
        const bars = weekBars(calQ.data, week.map((c) => c.date));
        return (
        <View key={wi} style={styles.weekRow}>
          {week.map((cell) => {
            const dots = cell.currentMonth ? dayDots(calQ.data, cell.date) : [];
            return (
              <TouchableOpacity
                key={cell.date}
                style={[styles.dayCell, { width: cellSize, height: cellSize }]}
                disabled={!cell.currentMonth}
                onPress={() => navigation.navigate('CalendarDay', { date: cell.date })}
              >
                {cell.currentMonth ? (
                  <>
                    <View style={[styles.dayNumWrap, cell.isToday && styles.todayWrap]}>
                      <Text style={[styles.dayNum, cell.isToday && styles.todayNum]}>{cell.day}</Text>
                    </View>
                    <View style={styles.dotRow}>
                      {dots.map((c, i) => (
                        <View key={i} style={[styles.dot, { backgroundColor: c }]} />
                      ))}
                    </View>
                  </>
                ) : null}
              </TouchableOpacity>
            );
          })}
          {bars.map((bar) => (
            <View
              key={bar.key}
              style={[
                styles.spanBar,
                {
                  backgroundColor: bar.color,
                  left: bar.startCol * cellSize + 1,
                  width: (bar.endCol - bar.startCol + 1) * cellSize - 3,
                  bottom: 3 + bar.lane * 8,
                },
              ]}
            >
              <Text style={styles.spanBarText} numberOfLines={1}>{bar.label}</Text>
            </View>
          ))}
        </View>
        );
      })}
    </View>
  );

  return (
    <View style={styles.screen}>
      {calQ.isLoading ? <ActivityIndicator color={colors.primary} style={styles.loader} /> : null}
      <FlatList
        data={months}
        keyExtractor={(m) => m.key}
        renderItem={renderMonth}
        initialScrollIndex={2}
        getItemLayout={(_, index) => {
          const h = 40 + 24 + 6 * (cellSize + 2);
          return { length: h, offset: h * index, index };
        }}
        contentContainerStyle={styles.content}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  headerBtns: { flexDirection: 'row', alignItems: 'center' },
  loader: { position: 'absolute', top: spacing.md, alignSelf: 'center', zIndex: 1 },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  monthBlock: { marginBottom: spacing.lg },
  monthLabel: { fontSize: 18, fontWeight: '700', color: colors.text, paddingVertical: spacing.sm },
  weekdayRow: { flexDirection: 'row' },
  weekdayCell: { alignItems: 'center', paddingVertical: 4 },
  weekdayText: { fontSize: 12, color: colors.textMuted, fontWeight: '600' },
  weekRow: { flexDirection: 'row', position: 'relative' },
  spanBar: { position: 'absolute', height: 7, borderRadius: 3, justifyContent: 'center', paddingHorizontal: 3 },
  spanBarText: { fontSize: 7, color: '#fff', fontWeight: '700' },
  dayCell: { alignItems: 'center', paddingTop: 4, borderWidth: 0.5, borderColor: colors.border },
  dayNumWrap: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  todayWrap: { backgroundColor: colors.primary },
  dayNum: { fontSize: 13, color: colors.text },
  todayNum: { color: '#fff', fontWeight: '700' },
  dotRow: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: 2, marginTop: 2, paddingHorizontal: 2 },
  dot: { width: 5, height: 5, borderRadius: 2.5 },
});
