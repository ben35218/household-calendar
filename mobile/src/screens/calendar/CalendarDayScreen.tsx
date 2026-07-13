import React, { useLayoutEffect, useMemo, useState, useRef, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Animated, Dimensions } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { WeatherData, CalendarEvent } from '../../api';
import { loadCalendarData } from '../../lib/calendarData';
import { loadForecast } from '../../lib/weather';
import { Card, CenteredLoader, CardRow } from '../../components/ui';
import HourlyForecast from '../../components/HourlyForecast';
import { itemsForDate, eventColor, CALENDAR_COLORS } from '../../lib/calendar';
import { getHolidays } from '../../lib/holidays';
import { useCalendarVisibility, useHolidayCalendars, holidayEnabledIds, useCalendarColors } from '../../lib/calendarPrefs';
import WeatherIcon from '../../components/WeatherIcon';
import { weatherCardColors } from '../../lib/weatherTheme';
import { zonedTimeLabel } from '../../lib/tz';
import { useHorizontalSwipe } from '../../lib/useHorizontalSwipe';
import { mdiName } from '../../lib/recurrence';
import { CalendarStackParamList } from '../../navigation/CalendarNavigator';
import { colors, spacing, radius } from '../../theme';

type Nav = NativeStackNavigationProp<CalendarStackParamList, 'CalendarDay'>;
type Rt = RouteProp<CalendarStackParamList, 'CalendarDay'>;

const HOLIDAY_COLOR = CALENDAR_COLORS['canadian-holidays'];
const SCREEN_W = Dimensions.get('window').width;

// Fetch a tight window around the date so the aggregate is cheap.
function windowFor(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00');
  const from = new Date(d);
  from.setDate(from.getDate() - 7);
  const to = new Date(d);
  to.setDate(to.getDate() + 7);
  return { from: from.toISOString(), to: to.toISOString() };
}

function Row({ icon, color, title, subtitle, onPress }: { icon: string; color: string; title: string; subtitle?: string; onPress?: () => void }) {
  return (
    <CardRow
      onPress={onPress}
      leading={<MaterialCommunityIcons name={icon as any} size={20} color={color} />}
      title={title}
      subtitle={subtitle}
      style={{ borderLeftColor: color, borderLeftWidth: 4 }}
    />
  );
}

export default function CalendarDayScreen() {
  const navigation = useNavigation<Nav>();
  const { date: initialDate } = useRoute<Rt>().params;
  const { visibility } = useCalendarVisibility();
  const { calendars: holidayCals } = useHolidayCalendars();
  const { colors: calColors } = useCalendarColors();

  // The visible day is local state so swiping animates the content in place,
  // rather than pushing/replacing a screen (whose transition direction the native
  // stack won't reliably let us flip). The route param just seeds the first day.
  const [date, setDate] = useState(initialDate);

  // Directional slide for day-to-day movement: slide the current content off in
  // the swipe direction, swap the date, then slide the new content in from the
  // opposite edge. next day → out to the left; previous day → out to the right.
  const tx = useRef(new Animated.Value(0)).current;
  const animating = useRef(false);
  const shiftDay = useCallback((delta: number) => {
    if (animating.current) return;
    animating.current = true;
    const out = delta > 0 ? -SCREEN_W : SCREEN_W;
    Animated.timing(tx, { toValue: out, duration: 160, useNativeDriver: true }).start(() => {
      setDate((cur) => {
        const d = new Date(cur + 'T12:00:00');
        d.setDate(d.getDate() + delta);
        return d.toISOString().slice(0, 10);
      });
      tx.setValue(-out);
      Animated.timing(tx, { toValue: 0, duration: 160, useNativeDriver: true }).start(() => {
        animating.current = false;
      });
    });
  }, [tx]);
  // Set while a touch is on the weather card, so its horizontally-scrollable
  // hourly strip owns left/right swipes instead of flipping the day.
  const swipeBlocked = useRef(false);
  const swipe = useHorizontalSwipe({
    onSwipeLeft: () => shiftDay(1),
    onSwipeRight: () => shiftDay(-1),
    enabled: () => !swipeBlocked.current,
  });

  const range = useMemo(() => windowFor(date), [date]);
  const calQ = useQuery({
    queryKey: ['calendar', range.from, range.to],
    queryFn: async () => loadCalendarData(range),
    // Keep the previous day's data on screen while the new day loads, so the
    // slide-in isn't interrupted by a full-screen spinner.
    placeholderData: (prev) => prev,
  });

  // Weather for this day (from the 16-day forecast, when available).
  const weatherQ = useQuery({
    queryKey: ['weather', 'current'],
    queryFn: () => loadForecast(),
  });
  const wx = useMemo<WeatherData['forecast'][number] | null>(
    () => weatherQ.data?.forecast?.find((d) => d.date === date) ?? null,
    [weatherQ.data, date]
  );
  // Card fill tracks the day's conditions (daytime tint — it's a day forecast).
  const wxColors = weatherCardColors(wx?.weatherCode, false);
  // This day onward, so the hourly strip can roll past midnight into the next day.
  const wxDays = useMemo(() => {
    const f = weatherQ.data?.forecast ?? [];
    const i = f.findIndex((d) => d.date === date);
    return i >= 0 ? f.slice(i) : [];
  }, [weatherQ.data, date]);

  const day = useMemo(() => itemsForDate(calQ.data, date), [calQ.data, date]);

  const holidays = useMemo(() => {
    const d = new Date(date + 'T12:00:00');
    const out: { id: string; name: string; color: string }[] = [];
    for (const cal of holidayCals) {
      if (visibility[cal.id] === false) continue;
      const color = calColors[cal.id] ?? cal.color;
      for (const h of getHolidays(cal.country, d, d, holidayEnabledIds(cal))) {
        if (h.date === date) out.push({ id: `${cal.id}-${h.id}`, name: h.name, color });
      }
    }
    return out;
  }, [date, holidayCals, visibility, calColors]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }),
      // Disable the native swipe-back so a horizontal swipe navigates between
      // days (right → previous, left → next) instead of popping to the calendar.
      // The header back button still returns to the calendar view.
      gestureEnabled: false,
      headerRight: () => (
        <TouchableOpacity onPress={() => navigation.navigate('EventForm', { date })} style={{ paddingHorizontal: 4 }}>
          <Ionicons name="add" size={26} color="#fff" />
        </TouchableOpacity>
      ),
    });
  }, [navigation, date]);

  if (calQ.isLoading) {
    return (
      <CenteredLoader />
    );
  }

  const empty =
    !day.events.length && !day.tasks.length && !day.chores.length && !day.recipes.length &&
    !day.trips.length && !day.birthdays.length && !day.grocery && !holidays.length;

  const eventTime = (e: CalendarEvent) => (e.allDay ? 'All day' : zonedTimeLabel(e.startDate));

  return (
    <View style={styles.screen}>
      <Animated.View style={[styles.pane, { transform: [{ translateX: tx }] }]} {...swipe}>
      <ScrollView style={styles.scroll} contentContainerStyle={styles.content}>
      {/* Weather for this day (mirrors the web day view).
          Hidden on trip days — trip weather lives in the trip's own daily view,
          and showing it here too would be confusing. */}
      {wx && !day.trips.length ? (
        <View
          onTouchStart={() => { swipeBlocked.current = true; }}
          onTouchEnd={() => { swipeBlocked.current = false; }}
          onTouchCancel={() => { swipeBlocked.current = false; }}
        >
        <Card style={[styles.weatherCard, { backgroundColor: wxColors.bg, borderColor: wxColors.border }]}>
          <View style={styles.weatherRow}>
            <WeatherIcon code={wx.weatherCode} size={40} />
            <View style={{ flex: 1 }}>
              <Text style={styles.weatherTemp}>{Math.round(wx.tempMax)}° / {Math.round(wx.tempMin)}°</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              {wx.precipProbability > 0 ? <Text style={styles.weatherSub}>{wx.precipProbability}% chance of rain</Text> : null}
              {wx.precipSum > 0 ? <Text style={styles.weatherRain}>{wx.precipSum} mm expected</Text> : null}
            </View>
          </View>
          {wx.hours?.length ? (
            <>
              <View style={styles.weatherDivider} />
              <HourlyForecast days={wxDays} />
            </>
          ) : null}
        </Card>
        </View>
      ) : null}

      {empty ? <Text style={styles.empty}>Nothing scheduled.</Text> : null}

      {day.trips.map((t) => (
        <Row key={`trip-${t.id}`} icon="bag-suitcase" color={t.color} title={t.name} subtitle="Trip" onPress={() => navigation.navigate('TripDetail', { id: t.id })} />
      ))}
      {holidays.map((h) => (
        <Row key={`hol-${h.id}`} icon="flag-variant" color={h.color} title={h.name} subtitle="Holiday" />
      ))}
      {day.birthdays.map((b) => (
        <Row key={`bday-${b.id}`} icon="cake-variant" color={calColors.birthdays} title={b.name} subtitle="Birthday" />
      ))}
      {day.events.map((e) => (
        <Row key={e._id} icon="calendar" color={eventColor(e)} title={e.title} subtitle={[eventTime(e), e.location].filter(Boolean).join(' · ')} onPress={() => navigation.navigate('EventForm', { eventId: e._id, date })} />
      ))}
      {day.tasks.map((t) => (
        <Row key={t._id} icon="wrench" color={calColors.maintenance} title={t.title} subtitle="Maintenance task" onPress={() => navigation.navigate('TaskDetail', { id: t._id })} />
      ))}
      {day.chores.map((c) => (
        <Row key={c._id} icon={mdiName(c.icon)} color={calColors.chores} title={c.title} subtitle="Chore" onPress={() => navigation.navigate('ChoreDetail', { id: c._id })} />
      ))}
      {day.recipes.map((r, i) => (
        <Row key={`recipe-${i}`} icon="silverware-fork-knife" color={calColors.recipes} title={r.title} subtitle="Meal" onPress={() => (r.recipeId ? navigation.navigate('RecipeDetail', { id: r.recipeId }) : navigation.navigate('KitchenHome'))} />
      ))}
      {day.grocery ? (
        <Row icon="cart" color="#F9A825" title="Grocery shopping" subtitle="Shopping day" onPress={() => navigation.navigate('KitchenHome', { pane: 'grocery' })} />
      ) : null}
      </ScrollView>
      </Animated.View>
      {/* Prev/next-day chevrons pinned to the footer corners. Rendered on top of
          the ScrollView so they can receive taps, but the container is box-none:
          only the two icon hit-areas are interactive, and every other touch —
          including on any card that scrolls over this strip — passes straight
          through to the content below. */}
      <View style={styles.footerNav} pointerEvents="box-none">
        <TouchableOpacity onPress={() => shiftDay(-1)} hitSlop={16} style={styles.footerBtn}>
          <Ionicons name="chevron-back" size={30} color={colors.textMuted} />
        </TouchableOpacity>
        <TouchableOpacity onPress={() => shiftDay(1)} hitSlop={16} style={styles.footerBtn}>
          <Ionicons name="chevron-forward" size={30} color={colors.textMuted} />
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  // Sliding pane carries the day content during the swipe transition; solid
  // background so the outgoing/incoming day isn't see-through as it moves.
  pane: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1, backgroundColor: 'transparent' },
  footerNav: { position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: spacing.md, paddingBottom: spacing.xl },
  footerBtn: { padding: spacing.xs },
  content: { padding: spacing.md },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl },
  // Solid sky blue matching the weather screen's hourly card.
  weatherCard: { marginBottom: spacing.md, backgroundColor: '#5089D2', borderColor: 'rgba(255,255,255,0.22)' },
  weatherRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  weatherTemp: { fontSize: 18, fontWeight: '700', color: '#fff' },
  weatherSub: { fontSize: 13, color: 'rgba(255,255,255,0.85)' },
  weatherRain: { fontSize: 13, color: '#CFE8FF', fontWeight: '600' },
  weatherDivider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.25)', marginVertical: spacing.sm },
});
