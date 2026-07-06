import React from 'react';
import { View, Text, ScrollView, StyleSheet } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { WeatherHour } from '../api';
import { wmoIcon, weatherColor } from '../lib/weatherIcons';
import { colors, spacing, radius } from '../theme';

function hourLabel(h: number): string {
  if (h === 0) return '12am';
  if (h < 12) return `${h}am`;
  if (h === 12) return '12pm';
  return `${h - 12}pm`;
}

// Daytime hourly strip (6am–9pm) mirroring the web day view's hourly breakdown.
// `date` is the yyyy-MM-dd the hours belong to, used to highlight the current hour.
export default function HourlyForecast({ hours, date }: { hours?: WeatherHour[]; date: string }) {
  const slots = (hours ?? []).filter((h) => h.hour >= 6 && h.hour <= 21);
  if (!slots.length) return null;

  const now = new Date();
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
  const nowHour = now.getHours();
  const isNow = (h: WeatherHour) => date === todayStr && h.hour === nowHour;

  return (
    <View>
      <Text style={styles.heading}>HOURLY</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.strip}>
        {slots.map((h) => {
          const wet = h.precipitation > 0;
          const current = isNow(h);
          return (
            <View key={h.time} style={[styles.slot, wet ? styles.slotWet : styles.slotDry, current && styles.slotNow]}>
              <Text style={[styles.label, current && styles.labelNow]}>{current ? 'Now' : hourLabel(h.hour)}</Text>
              <MaterialCommunityIcons name={wmoIcon(h.weatherCode) as any} size={20} color={weatherColor(h.weatherCode)} style={{ marginVertical: 2 }} />
              <Text style={styles.temp}>{Math.round(h.temperature)}°</Text>
              {h.precipProbability > 0 ? <Text style={styles.prob}>{h.precipProbability}%</Text> : null}
              {h.precipitation > 0 ? <Text style={styles.mm}>{h.precipitation}mm</Text> : null}
            </View>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: colors.textMuted, marginBottom: spacing.sm },
  strip: { gap: spacing.sm, paddingBottom: 2 },
  slot: { minWidth: 54, alignItems: 'center', paddingVertical: spacing.sm, paddingHorizontal: 4, borderRadius: radius.sm, borderWidth: 1 },
  slotDry: { backgroundColor: colors.background, borderColor: colors.border },
  slotWet: { backgroundColor: colors.primary + '14', borderColor: colors.primary + '40' },
  slotNow: { borderColor: colors.primary, borderWidth: 2 },
  label: { fontSize: 12, fontWeight: '600', color: colors.textMuted },
  labelNow: { color: colors.primary },
  temp: { fontSize: 12, fontWeight: '600', color: colors.text },
  prob: { fontSize: 11, color: colors.primary },
  mm: { fontSize: 11, color: colors.primary, fontWeight: '600' },
});
