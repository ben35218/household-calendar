import React from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { weatherApi, OutlookWeek } from '../../api';
import { loadForecast } from '../../lib/weather';
import { Card, Divider } from '../../components/ui';
import HourlyForecast from '../../components/HourlyForecast';
import { wmoIcon, weatherColor } from '../../lib/weatherIcons';
import { colors, spacing } from '../../theme';

const BLUE = '#0288D1';

function weekRange(start: string, end: string) {
  const s = new Date(start + 'T12:00:00');
  const e = new Date(end + 'T12:00:00');
  const sM = s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  if (s.getMonth() === e.getMonth()) return `${sM}–${e.getDate()}`;
  return `${sM}–${e.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`;
}

// Mirrors client/src/views/WeatherView.vue + WeatherWidget: current conditions,
// a 7-day forecast strip, and the 90-day seasonal outlook grouped by month.
export default function WeatherScreen() {
  const weatherQ = useQuery({ queryKey: ['weather'], queryFn: () => loadForecast() });
  const outlookQ = useQuery({ queryKey: ['weather', 'outlook'], queryFn: async () => (await weatherApi.outlook()).data.weeks });

  const monthGroups = React.useMemo(() => {
    const groups: { label: string; weeks: OutlookWeek[] }[] = [];
    (outlookQ.data ?? []).forEach((wk) => {
      const label = new Date(wk.startDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
      let g = groups.find((x) => x.label === label);
      if (!g) { g = { label, weeks: [] }; groups.push(g); }
      g.weeks.push(wk);
    });
    return groups;
  }, [outlookQ.data]);

  const w = weatherQ.data;
  const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
  const hourlyDay = w?.forecast?.find((d) => d.date === todayStr) ?? w?.forecast?.[0];

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {weatherQ.isLoading ? (
        <ActivityIndicator color={BLUE} style={{ marginVertical: spacing.xl }} />
      ) : weatherQ.isError || !w ? (
        <Card style={styles.card}><Text style={styles.muted}>Weather needs a home address set in Account.</Text></Card>
      ) : (
        <Card style={styles.card}>
          <View style={styles.currentRow}>
            <MaterialCommunityIcons name={wmoIcon(w.current.weatherCode) as any} size={48} color={weatherColor(w.current.weatherCode)} />
            <View style={{ marginLeft: spacing.md }}>
              <Text style={styles.temp}>{Math.round(w.current.temperature)}{w.units.temperature}</Text>
              <Text style={styles.desc}>{w.current.description}</Text>
            </View>
            <View style={styles.currentMeta}>
              <Text style={styles.metaLine}>Humidity {w.current.humidity}%</Text>
              <Text style={styles.metaLine}>Wind {Math.round(w.current.windSpeed)} {w.units.wind}</Text>
            </View>
          </View>
          <Divider />
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.forecastStrip}>
            {w.forecast.map((day) => (
              <View key={day.date} style={[styles.fday, day.goodWeather && styles.fdayGood]}>
                <Text style={styles.fdayLabel}>{new Date(day.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' })}</Text>
                <MaterialCommunityIcons name={wmoIcon(day.weatherCode) as any} size={22} color={weatherColor(day.weatherCode)} />
                <Text style={styles.fdayHigh}>{Math.round(day.tempMax)}°</Text>
                <Text style={styles.fdayLow}>{Math.round(day.tempMin)}°</Text>
                {day.precipProbability > 10 ? <Text style={styles.fdayPrecip}>{day.precipProbability}%</Text> : null}
              </View>
            ))}
          </ScrollView>
        </Card>
      )}

      {hourlyDay?.hours?.length ? (
        <Card style={styles.card}>
          <HourlyForecast hours={hourlyDay.hours} date={hourlyDay.date} />
        </Card>
      ) : null}

      <Card style={styles.card}>
        <Text style={styles.outlookTitle}>90-Day Seasonal Outlook</Text>
        <Divider />
        {outlookQ.isLoading ? (
          <ActivityIndicator color={BLUE} style={{ marginVertical: spacing.lg }} />
        ) : outlookQ.isError ? (
          <Text style={styles.muted}>Could not load seasonal outlook.</Text>
        ) : (
          monthGroups.map((group) => (
            <View key={group.label}>
              <Text style={styles.monthHeading}>{group.label.toUpperCase()}</Text>
              {group.weeks.map((wk) => (
                <View
                  key={wk.startDate}
                  style={[styles.weekRow, wk.rainyDays >= 4 ? styles.weekWet : wk.rainyDays === 0 ? styles.weekDry : null]}
                >
                  <Text style={styles.weekDates}>{weekRange(wk.startDate, wk.endDate)}</Text>
                  <View style={styles.weekTemp}>
                    <MaterialCommunityIcons name="thermometer-high" size={14} color="#EF6C00" />
                    <Text style={styles.weekTempHigh}>{wk.avgTempMax}°</Text>
                    <Text style={styles.weekTempLow}>/ {wk.avgTempMin}°</Text>
                  </View>
                  <View style={styles.weekPrecip}>
                    <MaterialCommunityIcons name="water" size={14} color={wk.totalPrecip > 20 ? '#1565C0' : wk.totalPrecip > 5 ? BLUE : '#B0BEC5'} />
                    <Text style={styles.weekPrecipText}>{wk.totalPrecip} mm</Text>
                  </View>
                  <Text style={styles.rainDays}>{wk.rainyDays}/7</Text>
                </View>
              ))}
            </View>
          ))
        )}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  card: { marginBottom: spacing.md },
  muted: { color: colors.textMuted, fontSize: 13, paddingVertical: spacing.sm },
  currentRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm },
  temp: { fontSize: 28, fontWeight: '700', color: colors.text },
  desc: { fontSize: 13, color: colors.textMuted },
  currentMeta: { marginLeft: 'auto', alignItems: 'flex-end' },
  metaLine: { fontSize: 12, color: colors.textMuted },
  forecastStrip: { gap: spacing.sm, paddingTop: spacing.sm },
  fday: { alignItems: 'center', padding: spacing.sm, borderRadius: 10, backgroundColor: colors.background, minWidth: 56 },
  fdayGood: { backgroundColor: '#E8F5E9' },
  fdayLabel: { fontSize: 12, fontWeight: '600', color: colors.text },
  fdayHigh: { fontSize: 13, fontWeight: '600', color: colors.text, marginTop: 2 },
  fdayLow: { fontSize: 12, color: colors.textMuted },
  fdayPrecip: { fontSize: 11, color: BLUE },
  outlookTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  monthHeading: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, color: colors.textMuted, backgroundColor: colors.background, paddingVertical: 6, paddingHorizontal: 4, marginTop: spacing.sm },
  weekRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  weekWet: { backgroundColor: 'rgba(13,71,161,0.04)' },
  weekDry: { backgroundColor: 'rgba(56,142,60,0.04)' },
  weekDates: { width: 90, fontSize: 13, color: colors.textMuted },
  weekTemp: { flexDirection: 'row', alignItems: 'center', gap: 3, flex: 1, justifyContent: 'flex-end' },
  weekTempHigh: { fontSize: 13, fontWeight: '600', color: colors.text },
  weekTempLow: { fontSize: 13, color: colors.textMuted },
  weekPrecip: { flexDirection: 'row', alignItems: 'center', gap: 3, width: 72, justifyContent: 'flex-end' },
  weekPrecipText: { fontSize: 12, color: colors.textMuted },
  rainDays: { width: 40, textAlign: 'right', fontSize: 12, color: colors.textMuted },
});
