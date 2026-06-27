import React, { useLayoutEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { tripsApi, Trip, TripItem } from '../../api';
import { Card, Badge, Divider } from '../../components/ui';
import { tripTypeMeta, tripStatusLabel, tripStatusColor, TRIP_PURPLE } from '../../lib/tripTypes';
import { zonedParts, zonedTimeLabel } from '../../lib/tz';
import { TripsStackParamList } from '../../navigation/TripsNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<TripsStackParamList, 'TripDetail'>;
type Rt = RouteProp<TripsStackParamList, 'TripDetail'>;

const todayStr = new Date().toISOString().slice(0, 10);

function eachDay(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const d = new Date(startISO + 'T12:00:00');
  const end = new Date(endISO + 'T12:00:00');
  while (d <= end) {
    out.push(d.toISOString().slice(0, 10));
    d.setDate(d.getDate() + 1);
  }
  return out;
}

export default function TripDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { id } = useRoute<Rt>().params;
  const qc = useQueryClient();
  const [dayIndex, setDayIndex] = useState<number | null>(null); // null = grid view

  const tripQ = useQuery({ queryKey: ['trips', id], queryFn: async () => (await tripsApi.get(id)).data });
  const budgetQ = useQuery({ queryKey: ['trips', id, 'budget'], queryFn: async () => (await tripsApi.budget(id)).data });
  const trip = tripQ.data;
  const tz = trip?.destinationTz || '';

  const share = useMutation({
    mutationFn: () => tripsApi.share(id),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['trips', id] });
      Alert.alert('Trip shared', `Invite code: ${res.data.shareCode}`);
    },
  });
  const del = useMutation({
    mutationFn: () => tripsApi.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      navigation.goBack();
    },
  });

  const dayList = useMemo(() => {
    if (!trip) return [];
    let start = trip.startDate;
    let end = trip.endDate || trip.startDate;
    if (!start && trip.candidateRanges?.length) {
      start = trip.candidateRanges[0].start;
      end = trip.candidateRanges[0].end;
    }
    if (!start && trip.items?.length) {
      const ds = trip.items.map((i) => new Date(i.start).getTime());
      start = new Date(Math.min(...ds)).toISOString();
      end = new Date(Math.max(...trip.items.map((i) => new Date(i.end || i.start).getTime()))).toISOString();
    }
    if (!start) return [];
    return eachDay(start.slice(0, 10), (end || start).slice(0, 10));
  }, [trip]);

  const itemsForDate = (dateStr: string): TripItem[] =>
    (trip?.items ?? [])
      .filter((it) => zonedParts(it.start, tz).dateStr === dateStr)
      .sort((a, b) => new Date(a.start).getTime() - new Date(b.start).getTime());

  const confirmShare = () => {
    if (trip?.shareCode) {
      Alert.alert('Shared trip', `Invite code: ${trip.shareCode}`, [
        { text: 'Stop sharing', style: 'destructive', onPress: () => tripsApi.unshare(id).then(() => qc.invalidateQueries({ queryKey: ['trips', id] })) },
        { text: 'OK' },
      ]);
    } else {
      share.mutate();
    }
  };

  useLayoutEffect(() => {
    navigation.setOptions({
      title: trip?.name || 'Trip',
      headerRight: () => (
        <View style={styles.headerActions}>
          <TouchableOpacity
            onPress={() => navigation.navigate('VacationAssistant', { tripId: id, tripName: trip?.name })}
            style={styles.headerBtn}
          >
            <Ionicons name="sparkles" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={confirmShare} style={styles.headerBtn}>
            <Ionicons name="share-social-outline" size={20} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('TripForm', { id })} style={styles.headerBtn}>
            <Ionicons name="create-outline" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity
            onPress={() =>
              Alert.alert('Delete trip?', `Delete "${trip?.name}"?`, [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => del.mutate() },
              ])
            }
            style={styles.headerBtn}
          >
            <Ionicons name="trash-outline" size={20} color="#fff" />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, id, trip?.name, trip?.shareCode]);

  if (tripQ.isLoading || !trip) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={TRIP_PURPLE} />
      </View>
    );
  }

  const selectedDate = dayIndex != null ? dayList[dayIndex] : null;

  // ── Day itinerary view ──
  if (selectedDate) {
    const items = itemsForDate(selectedDate);
    return (
      <View style={styles.screen}>
        <View style={styles.dayNav}>
          <TouchableOpacity disabled={dayIndex === 0} onPress={() => setDayIndex((i) => (i ?? 0) - 1)}>
            <Ionicons name="chevron-back" size={24} color={dayIndex === 0 ? colors.border : TRIP_PURPLE} />
          </TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.dayWeekday}>{new Date(selectedDate + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long' })}</Text>
            <Text style={styles.dayLabel}>{new Date(selectedDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</Text>
            <Text style={styles.dayCount}>Day {(dayIndex ?? 0) + 1} of {dayList.length}</Text>
          </View>
          <TouchableOpacity disabled={dayIndex === dayList.length - 1} onPress={() => setDayIndex((i) => (i ?? 0) + 1)}>
            <Ionicons name="chevron-forward" size={24} color={dayIndex === dayList.length - 1 ? colors.border : TRIP_PURPLE} />
          </TouchableOpacity>
        </View>
        <TouchableOpacity style={styles.backToCal} onPress={() => setDayIndex(null)}>
          <Ionicons name="calendar-outline" size={16} color={TRIP_PURPLE} />
          <Text style={styles.backToCalText}>Back to trip calendar</Text>
        </TouchableOpacity>

        <ScrollView contentContainerStyle={styles.content}>
          {items.length === 0 ? (
            <Text style={styles.empty}>Nothing booked this day.</Text>
          ) : (
            items.map((it) => {
              const meta = tripTypeMeta(it.type);
              return (
                <TouchableOpacity key={it._id} activeOpacity={0.8} onPress={() => navigation.navigate('TripItemForm', { tripId: id, itemId: it._id, date: selectedDate })}>
                  <Card style={[styles.itemCard, { borderLeftColor: meta.color, borderLeftWidth: 4 }]}>
                    <View style={styles.itemHeader}>
                      <MaterialCommunityIcons name={meta.icon as any} size={18} color={meta.color} />
                      <Text style={styles.itemTitle}>{it.title}</Text>
                      {it.confirmed ? <Ionicons name="checkmark-circle" size={14} color={colors.success} /> : null}
                    </View>
                    <Text style={styles.itemTime}>
                      {zonedTimeLabel(it.start, tz)}
                      {it.end ? ` – ${zonedTimeLabel(it.end, tz)}` : ''}
                    </Text>
                    {it.location ? <Text style={styles.itemSub}>{it.location}</Text> : null}
                    {it.cost != null ? <Text style={styles.itemSub}>{it.currency || '$'}{it.cost}</Text> : null}
                  </Card>
                </TouchableOpacity>
              );
            })
          )}
        </ScrollView>

        <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('TripItemForm', { tripId: id, date: selectedDate })}>
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      </View>
    );
  }

  // ── Grid (calendar) view ──
  return (
    <View style={styles.screen}>
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.titleRow}>
          <Badge label={tripStatusLabel(trip.status)} color={tripStatusColor(trip.status)} />
          {trip.destination ? <Text style={styles.destination}>{trip.destination}</Text> : null}
        </View>

        {trip.status === 'considering' && trip.candidateRanges?.length ? (
          <View style={styles.optionsWrap}>
            <Text style={styles.sectionLabel}>Date options</Text>
            {trip.candidateRanges.map((r, i) => (
              <Card key={i} style={styles.optionCard}>
                <Text style={styles.optionTitle}>{r.label || `Option ${i + 1}`}</Text>
                <Text style={styles.itemSub}>{r.start.slice(0, 10)} – {r.end.slice(0, 10)}</Text>
              </Card>
            ))}
          </View>
        ) : null}

        {dayList.length ? (
          <>
            <Text style={styles.sectionLabel}>{dayList.length}-day trip — tap a day</Text>
            <View style={styles.daysGrid}>
              {dayList.map((dateStr, idx) => {
                const d = new Date(dateStr + 'T12:00:00');
                const dayItems = itemsForDate(dateStr);
                const types = Array.from(new Set(dayItems.map((i) => i.type))).slice(0, 4);
                return (
                  <TouchableOpacity key={dateStr} style={[styles.dayCell, dateStr === todayStr && styles.dayCellToday]} onPress={() => setDayIndex(idx)}>
                    <Text style={styles.dcIndex}>Day {idx + 1}</Text>
                    <Text style={styles.dcWeekday}>{d.toLocaleDateString(undefined, { weekday: 'short' })}</Text>
                    <Text style={styles.dcDayNum}>{d.getDate()}</Text>
                    <Text style={styles.dcMonth}>{d.toLocaleDateString(undefined, { month: 'short' })}</Text>
                    <View style={styles.dcMarkers}>
                      {types.map((t) => (
                        <MaterialCommunityIcons key={t} name={tripTypeMeta(t).icon as any} size={12} color={tripTypeMeta(t).color} />
                      ))}
                    </View>
                  </TouchableOpacity>
                );
              })}
            </View>
          </>
        ) : null}

        {/* Budget */}
        {budgetQ.data && (budgetQ.data.costedCount || budgetQ.data.budget != null) ? (
          <Card style={styles.budgetCard}>
            <View style={styles.budgetHeader}>
              <Ionicons name="wallet-outline" size={18} color={TRIP_PURPLE} />
              <Text style={styles.budgetTitle}>Your budget</Text>
              <Text style={styles.budgetTotal}>
                {budgetQ.data.baseCurrency} {Math.round(budgetQ.data.total)}
                {budgetQ.data.budget != null ? ` / ${Math.round(budgetQ.data.budget)}` : ''}
              </Text>
            </View>
            {budgetQ.data.byType.length ? <Divider /> : null}
            {budgetQ.data.byType.map((b) => (
              <View key={b.type} style={styles.btRow}>
                <MaterialCommunityIcons name={tripTypeMeta(b.type).icon as any} size={14} color={tripTypeMeta(b.type).color} />
                <Text style={styles.btLabel}>{tripTypeMeta(b.type).label}</Text>
                <Text style={styles.btAmount}>{budgetQ.data!.baseCurrency} {Math.round(b.amount)}</Text>
              </View>
            ))}
            <TouchableOpacity style={styles.settleLink} onPress={() => navigation.navigate('TripSettle', { id })}>
              <Text style={styles.settleText}>Settle up</Text>
              <Ionicons name="chevron-forward" size={16} color={TRIP_PURPLE} />
            </TouchableOpacity>
          </Card>
        ) : null}

        {trip.notes ? (
          <View style={styles.notesWrap}>
            <Text style={styles.sectionLabel}>Notes</Text>
            <Text style={styles.notes}>{trip.notes}</Text>
          </View>
        ) : null}
      </ScrollView>

      {dayList.length ? (
        <TouchableOpacity style={styles.fab} onPress={() => navigation.navigate('TripItemForm', { tripId: id, date: dayList[0] })}>
          <Ionicons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: 96 },
  headerActions: { flexDirection: 'row' },
  headerBtn: { paddingHorizontal: 5 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md, flexWrap: 'wrap' },
  destination: { fontSize: 14, color: colors.textMuted },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginBottom: spacing.sm },
  optionsWrap: { marginBottom: spacing.md },
  optionCard: { marginBottom: spacing.sm },
  optionTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  daysGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  dayCell: { width: 84, padding: spacing.sm, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  dayCellToday: { borderColor: TRIP_PURPLE, borderWidth: 2 },
  dcIndex: { fontSize: 11, color: TRIP_PURPLE, fontWeight: '700' },
  dcWeekday: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  dcDayNum: { fontSize: 22, fontWeight: '700', color: colors.text },
  dcMonth: { fontSize: 12, color: colors.textMuted },
  dcMarkers: { flexDirection: 'row', gap: 2, marginTop: 4, minHeight: 14 },
  dayNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  dayWeekday: { fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', fontWeight: '600' },
  dayLabel: { fontSize: 17, fontWeight: '700', color: colors.text },
  dayCount: { fontSize: 12, color: colors.textMuted },
  backToCal: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  backToCalText: { color: TRIP_PURPLE, fontSize: 13, fontWeight: '600' },
  itemCard: { marginBottom: spacing.sm },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  itemTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text },
  itemTime: { fontSize: 13, color: colors.text, marginTop: 4, fontWeight: '500' },
  itemSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  budgetCard: { marginBottom: spacing.md },
  budgetHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  budgetTitle: { fontSize: 15, fontWeight: '700', color: colors.text, flex: 1 },
  budgetTotal: { fontSize: 14, fontWeight: '600', color: colors.text },
  btRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  btLabel: { flex: 1, fontSize: 14, color: colors.text },
  btAmount: { fontSize: 14, color: colors.textMuted },
  settleLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  settleText: { color: TRIP_PURPLE, fontWeight: '700', fontSize: 13, textTransform: 'uppercase' },
  notesWrap: { marginTop: spacing.sm },
  notes: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: TRIP_PURPLE,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
});
