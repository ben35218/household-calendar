import React, { useLayoutEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { WeatherData, CalendarEvent } from '../../api';
import { loadCalendarData } from '../../lib/calendarData';
import { loadForecast } from '../../lib/weather';
import { Card, Divider } from '../../components/ui';
import HourlyForecast from '../../components/HourlyForecast';
import { itemsForDate, eventColor, CALENDAR_COLORS } from '../../lib/calendar';
import { getCanadianHolidays } from '../../lib/holidays';
import { useCalendarVisibility, useHolidayPrefs, useCalendarColors } from '../../lib/calendarPrefs';
import { wmoIcon, weatherColor } from '../../lib/weatherIcons';
import { zonedTimeLabel } from '../../lib/tz';
import { mdiName } from '../../lib/recurrence';
import { CalendarStackParamList } from '../../navigation/CalendarNavigator';
import { colors, spacing, radius } from '../../theme';

type Nav = NativeStackNavigationProp<CalendarStackParamList, 'CalendarDay'>;
type Rt = RouteProp<CalendarStackParamList, 'CalendarDay'>;

const HOLIDAY_COLOR = CALENDAR_COLORS['canadian-holidays'];

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
  const Wrapper: any = onPress ? TouchableOpacity : View;
  return (
    <Wrapper onPress={onPress} activeOpacity={0.7}>
      <Card style={[styles.row, { borderLeftColor: color, borderLeftWidth: 4 }]}>
        <MaterialCommunityIcons name={icon as any} size={20} color={color} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{title}</Text>
          {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
        </View>
        {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
      </Card>
    </Wrapper>
  );
}

export default function CalendarDayScreen() {
  const navigation = useNavigation<Nav>();
  const { date } = useRoute<Rt>().params;
  const { visibility } = useCalendarVisibility();
  const { enabledIds } = useHolidayPrefs();
  const { colors: calColors } = useCalendarColors();

  const range = useMemo(() => windowFor(date), [date]);
  const calQ = useQuery({
    queryKey: ['calendar', range.from, range.to],
    queryFn: async () => loadCalendarData(range),
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

  const day = useMemo(() => itemsForDate(calQ.data, date), [calQ.data, date]);

  const holidays = useMemo(() => {
    if (visibility['canadian-holidays'] === false) return [];
    const d = new Date(date + 'T12:00:00');
    return getCanadianHolidays(d, d, enabledIds).filter((h) => h.date === date);
  }, [date, enabledIds, visibility]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      headerRight: () => (
        <TouchableOpacity onPress={() => navigation.navigate('EventForm', { date })} style={{ paddingHorizontal: 4 }}>
          <Ionicons name="add" size={26} color="#fff" />
        </TouchableOpacity>
      ),
    });
  }, [navigation, date]);

  if (calQ.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const empty =
    !day.events.length && !day.tasks.length && !day.chores.length && !day.recipes.length &&
    !day.trips.length && !day.birthdays.length && !day.grocery && !holidays.length;

  const eventTime = (e: CalendarEvent) => (e.allDay ? 'All day' : zonedTimeLabel(e.startDate));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {/* Weather for this day (mirrors the web day view) */}
      {wx ? (
        <Card style={styles.weatherCard}>
          <View style={styles.weatherRow}>
            <MaterialCommunityIcons name={wmoIcon(wx.weatherCode) as any} size={40} color={weatherColor(wx.weatherCode)} />
            <View style={{ flex: 1 }}>
              <Text style={styles.weatherTemp}>{Math.round(wx.tempMax)}° / {Math.round(wx.tempMin)}°</Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              {wx.precipProbability > 0 ? <Text style={styles.weatherSub}>{wx.precipProbability}% chance of rain</Text> : null}
              {wx.precipSum > 0 ? <Text style={styles.weatherRain}>{wx.precipSum} mm expected</Text> : null}
            </View>
          </View>
          {wx.goodWeather ? (
            <View style={[styles.weatherChip, { backgroundColor: colors.success + '22' }]}>
              <MaterialCommunityIcons name="grass" size={14} color={colors.success} />
              <Text style={[styles.weatherChipText, { color: colors.success }]}>Good day to mow</Text>
            </View>
          ) : wx.precipProbability >= 35 || wx.precipSum >= 3 ? (
            <View style={[styles.weatherChip, { backgroundColor: colors.warning + '22' }]}>
              <MaterialCommunityIcons name="water" size={14} color={colors.warning} />
              <Text style={[styles.weatherChipText, { color: colors.warning }]}>Wet — skip mowing</Text>
            </View>
          ) : null}
          {wx.hours?.length ? (
            <>
              <Divider />
              <HourlyForecast hours={wx.hours} date={date} />
            </>
          ) : null}
        </Card>
      ) : null}

      {empty ? <Text style={styles.empty}>Nothing scheduled.</Text> : null}

      {day.trips.map((t) => (
        <Row key={`trip-${t.id}`} icon="bag-suitcase" color={t.color} title={t.name} subtitle="Trip" onPress={() => navigation.navigate('TripDetail', { id: t.id })} />
      ))}
      {holidays.map((h) => (
        <Row key={`hol-${h.id}`} icon="flag-variant" color={calColors['canadian-holidays']} title={h.name} subtitle="Holiday" />
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
        <Row icon="cart" color="#F9A825" title="Grocery shopping" subtitle="Shopping day" onPress={() => navigation.navigate('KitchenHome')} />
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { padding: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  rowTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl },
  weatherCard: { marginBottom: spacing.md },
  weatherRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  weatherTemp: { fontSize: 18, fontWeight: '700', color: colors.text },
  weatherSub: { fontSize: 13, color: colors.textMuted },
  weatherRain: { fontSize: 13, color: colors.primary, fontWeight: '600' },
  weatherChip: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-start', marginTop: spacing.sm, paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.sm },
  weatherChipText: { fontSize: 13, fontWeight: '600' },
});
