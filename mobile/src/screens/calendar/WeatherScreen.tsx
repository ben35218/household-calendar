import React from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { OutlookWeek } from '../../api';
import { loadForecast, loadOutlookWeeks } from '../../lib/weather';
import { Card } from '../../components/ui';
import HourlyForecast from '../../components/HourlyForecast';
import SkyBackground from '../../components/SkyBackground';
import WeatherIcon from '../../components/WeatherIcon';
import { weatherCardColors } from '../../lib/weatherTheme';
import { colors, spacing } from '../../theme';

const BLUE = '#0288D1';

// Temperature → bar colour (Apple's cold-cyan → green → yellow → orange → red ramp).
function tempColor(t: number): string {
  if (t <= 0) return '#7FB8E8';
  if (t <= 8) return '#5FC3D8';
  if (t <= 14) return '#8CCB7F';
  if (t <= 19) return '#D9CE58';
  if (t <= 24) return '#EBB63A';
  if (t <= 29) return '#E8853B';
  return '#E25A33';
}

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
  const insets = useSafeAreaInsets();
  const weatherQ = useQuery({ queryKey: ['weather'], queryFn: () => loadForecast() });
  const outlookQ = useQuery({ queryKey: ['weather', 'outlook'], queryFn: () => loadOutlookWeeks() });

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
  // Solid card fill/border tracks the current conditions so the panels read as
  // part of the same sky as the gradient behind them.
  const cardTheme = weatherCardColors(w?.current?.weatherCode);
  const solidCard = { backgroundColor: cardTheme.bg, borderColor: cardTheme.border };
  const todayStr = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}-${String(new Date().getDate()).padStart(2, '0')}`;
  const hourlyDay = w?.forecast?.find((d) => d.date === todayStr) ?? w?.forecast?.[0];

  // Week-wide temp bounds: each day's range bar is positioned inside this span.
  const weekMin = w?.forecast?.length ? Math.min(...w.forecast.map((d) => d.tempMin)) : 0;
  const weekMax = w?.forecast?.length ? Math.max(...w.forecast.map((d) => d.tempMax)) : 1;
  const weekSpan = Math.max(weekMax - weekMin, 1);
  const pct = (t: number) => Math.min(100, Math.max(0, ((t - weekMin) / weekSpan) * 100));

  return (
    <View style={styles.screen}>
      <SkyBackground weatherCode={w?.current?.weatherCode} />
      {/* Header is transparent — clear the status bar; the hero's HOME eyebrow
          sits between the floating back chevron and edit button. */}
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingTop: insets.top + 8 }]}>
      {weatherQ.isLoading ? (
        <ActivityIndicator color={BLUE} style={{ marginVertical: spacing.xl }} />
      ) : weatherQ.isError || !w ? (
        <Card style={styles.card}><Text style={styles.muted}>Weather needs a home address set in Account.</Text></Card>
      ) : (
        <>
          {/* Apple Weather-style hero over the sky — no card. */}
          <View style={styles.hero}>
            <Text style={styles.heroEyebrow}>HOME</Text>
            {/* Invisible left ° mirrors the real one so the digits themselves stay centered. */}
            <View style={styles.heroTempRow}>
              <Text style={[styles.heroDeg, styles.heroDegHidden]}>°</Text>
              <Text style={styles.heroTemp}>{Math.round(w.current.temperature)}</Text>
              <Text style={styles.heroDeg}>°</Text>
            </View>
            <Text style={styles.heroDesc}>{w.current.description}</Text>
            {hourlyDay ? (
              <Text style={styles.heroHiLo}>H:{Math.round(hourlyDay.tempMax)}°  L:{Math.round(hourlyDay.tempMin)}°</Text>
            ) : null}
            <Text style={styles.heroMeta}>Humidity {w.current.humidity}% · Wind {Math.round(w.current.windSpeed)} {w.units.wind}</Text>
          </View>

          {hourlyDay?.hours?.length ? (
            <Card style={[styles.card, solidCard]}>
              <HourlyForecast days={w.forecast} />
            </Card>
          ) : null}

          <Card style={[styles.card, solidCard]}>
            <View style={styles.weekHeader}>
              <MaterialCommunityIcons name="calendar-month-outline" size={14} color="rgba(255,255,255,0.7)" />
              <Text style={styles.weekHeaderText}>7-DAY FORECAST</Text>
            </View>
            {w.forecast.map((day, i) => (
              <View key={day.date} style={[styles.dayRow, i > 0 && styles.dayRowBorder]}>
                <Text style={styles.dayName}>
                  {day.date === todayStr ? 'Today' : new Date(day.date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short' })}
                </Text>
                <View style={styles.dayIconWrap}>
                  <WeatherIcon code={day.weatherCode} size={22} />
                  {day.precipProbability > 10 ? <Text style={styles.dayPrecip}>{day.precipProbability}%</Text> : null}
                </View>
                <Text style={styles.dayLow}>{Math.round(day.tempMin)}°</Text>
                <View style={styles.tempTrack}>
                  <View
                    style={[
                      styles.tempFill,
                      {
                        left: `${pct(day.tempMin)}%`,
                        width: `${Math.max(pct(day.tempMax) - pct(day.tempMin), 4)}%`,
                        experimental_backgroundImage: `linear-gradient(90deg, ${tempColor(day.tempMin)}, ${tempColor(day.tempMax)})`,
                      },
                    ]}
                  />
                  {day.date === todayStr ? (
                    <View style={[styles.nowDot, { left: `${pct(w.current.temperature)}%` }]} />
                  ) : null}
                </View>
                <Text style={styles.dayHigh}>{Math.round(day.tempMax)}°</Text>
              </View>
            ))}
          </Card>
        </>
      )}

      <Card style={[styles.card, solidCard]}>
        <Text style={styles.outlookTitle}>90-Day Seasonal Outlook</Text>
        <View style={styles.outlookDivider} />
        {outlookQ.isLoading ? (
          <ActivityIndicator color="#fff" style={{ marginVertical: spacing.lg }} />
        ) : outlookQ.isError ? (
          <Text style={styles.outlookError}>Could not load seasonal outlook.</Text>
        ) : (
          monthGroups.map((group) => (
            <View key={group.label}>
              <Text style={styles.monthHeading}>{group.label.toUpperCase()}</Text>
              {group.weeks.map((wk) => (
                <View key={wk.startDate} style={styles.weekRow}>
                  <Text style={styles.weekDates}>{weekRange(wk.startDate, wk.endDate)}</Text>
                  <View style={styles.weekTemp}>
                    <MaterialCommunityIcons name="thermometer-high" size={14} color="#EF6C00" />
                    <Text style={styles.weekTempHigh}>{wk.avgTempMax}°</Text>
                    <Text style={styles.weekTempLow}>/ {wk.avgTempMin}°</Text>
                  </View>
                  <View style={styles.weekPrecip}>
                    <MaterialCommunityIcons name="water" size={14} color={wk.totalPrecip > 20 ? '#9BD1FF' : wk.totalPrecip > 5 ? '#CFE8FF' : 'rgba(255,255,255,0.5)'} />
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
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  scroll: { flex: 1 },
  content: { padding: spacing.md },
  // Translucent panels so the sky gradient shows through (Apple Weather style).
  card: { marginBottom: spacing.md, backgroundColor: 'rgba(10,22,40,0.45)', borderColor: 'rgba(255,255,255,0.14)' },
  muted: { color: colors.textMuted, fontSize: 13, paddingVertical: spacing.sm },
  // Hero: current conditions floating over the sky, Apple Weather style.
  hero: { alignItems: 'center', paddingTop: spacing.md, paddingBottom: spacing.lg },
  heroEyebrow: { fontSize: 13, fontWeight: '600', letterSpacing: 1.5, color: 'rgba(255,255,255,0.85)', textShadowColor: 'rgba(0,0,0,0.25)', textShadowRadius: 6 },
  heroTempRow: { flexDirection: 'row', marginVertical: -4 },
  heroTemp: { fontSize: 84, fontWeight: '200', color: '#fff', textShadowColor: 'rgba(0,0,0,0.25)', textShadowRadius: 8 },
  heroDeg: { fontSize: 84, fontWeight: '200', color: '#fff', textShadowColor: 'rgba(0,0,0,0.25)', textShadowRadius: 8 },
  heroDegHidden: { opacity: 0 },
  heroDesc: { fontSize: 18, fontWeight: '600', color: '#CFE8FF', textShadowColor: 'rgba(0,0,0,0.25)', textShadowRadius: 6 },
  heroHiLo: { fontSize: 16, fontWeight: '600', color: '#fff', marginTop: 2, textShadowColor: 'rgba(0,0,0,0.25)', textShadowRadius: 6 },
  heroMeta: { fontSize: 12, color: 'rgba(255,255,255,0.75)', marginTop: spacing.sm, textShadowColor: 'rgba(0,0,0,0.25)', textShadowRadius: 6 },
  // Apple-style 10-day list: day / icon / low / range bar / high.
  weekHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.xs },
  weekHeaderText: { fontSize: 12, fontWeight: '700', letterSpacing: 0.8, color: 'rgba(255,255,255,0.7)' },
  dayRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  dayRowBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: 'rgba(255,255,255,0.25)' },
  dayName: { width: 62, fontSize: 17, fontWeight: '600', color: '#fff' },
  dayIconWrap: { width: 40, alignItems: 'center' },
  dayPrecip: { fontSize: 10, fontWeight: '600', color: '#9BD1FF', marginTop: 1 },
  dayLow: { width: 40, textAlign: 'right', fontSize: 17, fontWeight: '600', color: 'rgba(255,255,255,0.55)' },
  dayHigh: { width: 40, textAlign: 'right', fontSize: 17, fontWeight: '600', color: '#fff' },
  tempTrack: { flex: 1, height: 5, borderRadius: 2.5, backgroundColor: 'rgba(0,0,0,0.22)', marginHorizontal: 10 },
  tempFill: { position: 'absolute', top: 0, bottom: 0, borderRadius: 2.5 },
  nowDot: { position: 'absolute', top: -1.5, width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff', borderWidth: 1.5, borderColor: 'rgba(0,0,0,0.35)', marginLeft: -4 },
  outlookTitle: { fontSize: 15, fontWeight: '700', color: '#fff', marginBottom: spacing.sm },
  outlookDivider: { height: StyleSheet.hairlineWidth, backgroundColor: 'rgba(255,255,255,0.25)' },
  outlookError: { color: '#fff', fontSize: 13, paddingVertical: spacing.sm },
  monthHeading: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, color: '#fff', backgroundColor: 'rgba(255,255,255,0.10)', paddingVertical: 6, paddingHorizontal: 4, marginTop: spacing.sm },
  weekRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'rgba(255,255,255,0.25)' },
  weekDates: { width: 90, fontSize: 13, color: '#fff' },
  weekTemp: { flexDirection: 'row', alignItems: 'center', gap: 3, flex: 1, justifyContent: 'flex-end' },
  weekTempHigh: { fontSize: 13, fontWeight: '600', color: '#fff' },
  weekTempLow: { fontSize: 13, color: '#fff' },
  weekPrecip: { flexDirection: 'row', alignItems: 'center', gap: 3, width: 72, justifyContent: 'flex-end' },
  weekPrecipText: { fontSize: 12, color: '#fff' },
  rainDays: { width: 40, textAlign: 'right', fontSize: 12, color: '#fff' },
});
