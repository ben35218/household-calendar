import React, { useLayoutEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity, Alert, Modal, Share } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { tripsApi, Trip, TripItem } from '../../api';
import { Card, Badge, Divider, RoundIconButton } from '../../components/ui';
import { tripTypeMeta, tripStatusLabel, tripStatusColor } from '../../lib/tripTypes';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { zonedParts, zonedTimeLabel } from '../../lib/tz';
import TripTimeline from '../../components/TripTimeline';
import AssistantIcon from '../../components/AssistantIcon';
import { useAiEnabled } from '../../lib/privacyPrefs';
import { getHDK, openRecord } from '../../lib/e2ee';
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
  const aiEnabled = useAiEnabled();
  const accent = useCalendarColors().colors.vacations;
  const { id } = useRoute<Rt>().params;
  const qc = useQueryClient();
  const [dayIndex, setDayIndex] = useState<number | null>(null); // null = grid view
  const [expandedType, setExpandedType] = useState<string | null>(null); // budget category drill-down
  const [showUncosted, setShowUncosted] = useState(false);
  const [shareModal, setShareModal] = useState(false);
  const [copied, setCopied] = useState(false);

  const tripQ = useQuery({ queryKey: ['trips', id], queryFn: async () => (await tripsApi.get(id)).data });
  const budgetQ = useQuery({ queryKey: ['trips', id, 'budget'], queryFn: async () => (await tripsApi.budget(id)).data });
  // GET /trips/:id returns { trip, items, isOwner }; flatten into a single Trip-with-items.
  const data = tripQ.data as unknown as { trip: Trip; items: TripItem[] } | undefined;
  const trip = data ? { ...data.trip, items: data.items } : undefined;
  const tz = trip?.destinationTz || '';

  const share = useMutation({
    mutationFn: async () => {
      try {
        return (await tripsApi.share(id)).data;
      } catch (e: any) {
        // Decrypt-on-share (§9.3): an E2EE private trip is ciphertext-only, so the
        // server asks us to hand it the decrypted trip + items to re-write as
        // plaintext for collaborators. Requires the household key to be unlocked.
        if (e?.response?.data?.error !== 'decrypt_required') throw e;
        if (!getHDK() || !data) throw new Error('Unlock your account, then try sharing again.');
        const decTrip = await openRecord('Trip', data.trip as any);
        const decItems = await Promise.all((data.items || []).map((i) => openRecord('TripItem', i as any)));
        return (await tripsApi.share(id, { trip: decTrip, items: decItems })).data;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trips', id] });
      setShareModal(true);
    },
    onError: (e: any) => {
      Alert.alert('Could not share trip', e?.message || e?.response?.data?.message || 'Please try again.');
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

  // Bookings whose dates all fall outside the trip's day window.
  const outOfRangeItems = useMemo(() => {
    if (!trip?.items?.length || !dayList.length) return [];
    const inWindow = new Set(dayList);
    return trip.items
      .filter((it) => {
        let dates: string[];
        if (it.type === 'hotel') {
          const ci = zonedParts(it.start, tz).dateStr;
          const co = zonedParts(it.end || it.start, tz).dateStr;
          dates = eachDay(ci, co);
        } else {
          const d = it.details as any;
          if ((it.type === 'flight' || it.type === 'transit') && (d?.departureTz || d?.arrivalTz)) {
            dates = [zonedParts(it.start, d.departureTz || tz).dateStr];
            if (it.end) dates.push(zonedParts(it.end, d.arrivalTz || tz).dateStr);
          } else {
            dates = [zonedParts(it.start, tz).dateStr];
            if (it.end) dates.push(zonedParts(it.end, tz).dateStr);
          }
        }
        return dates.length > 0 && !dates.some((d) => inWindow.has(d));
      })
      .map((it) => {
        const d = it.details as any;
        const itemTz = (it.type === 'flight' || it.type === 'transit') && d?.departureTz ? d.departureTz : tz;
        const { dateStr } = zonedParts(it.start, itemTz);
        const dateLabel = new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
        return { item: it, label: `${dateLabel} · ${zonedTimeLabel(it.start, itemTz)}` };
      })
      .sort((a, b) => a.item.start.localeCompare(b.item.start));
  }, [trip, dayList, tz]);

  // Distinct non-hotel booking types touching a date — journey legs (flight/transit)
  // count on both their departure and arrival local dates.
  const markerTypesForDate = (dateStr: string): string[] => {
    const seen: string[] = [];
    for (const it of trip?.items ?? []) {
      if (it.type === 'hotel') continue;
      const d = it.details as any;
      let touches = false;
      if ((it.type === 'flight' || it.type === 'transit') && (d?.departureTz || d?.arrivalTz)) {
        if (zonedParts(it.start, d.departureTz).dateStr === dateStr) touches = true;
        if (it.end && zonedParts(it.end, d.arrivalTz).dateStr === dateStr) touches = true;
      } else {
        touches = zonedParts(it.start, tz).dateStr === dateStr;
      }
      if (touches && !seen.includes(it.type)) seen.push(it.type);
    }
    return seen.slice(0, 4);
  };

  // A hotel covers every night from check-in through check-out date.
  const hasLodgingForDate = (dateStr: string): boolean =>
    (trip?.items ?? []).some((it) => {
      if (it.type !== 'hotel') return false;
      const ci = zonedParts(it.start, tz).dateStr;
      const co = zonedParts(it.end || it.start, tz).dateStr;
      return dateStr >= ci && dateStr <= co;
    });

  const confirmShare = () => {
    if (trip?.shareCode) {
      setShareModal(true);
    } else {
      share.mutate();
    }
  };

  const sendCode = () => {
    if (!trip?.shareCode) return;
    Share.share({
      message: `Join my trip "${trip.name}" on Household Calendar — use invite code ${trip.shareCode}.`,
    });
  };

  const copyCode = async () => {
    if (!trip?.shareCode) return;
    await Clipboard.setStringAsync(trip.shareCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const stopSharing = () => {
    Alert.alert('Stop sharing?', 'The invite code will stop working and others will lose access.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Stop sharing',
        style: 'destructive',
        onPress: () => {
          setShareModal(false);
          tripsApi.unshare(id).then(() => qc.invalidateQueries({ queryKey: ['trips', id] }));
        },
      },
    ]);
  };

  useLayoutEffect(() => {
    const targetDate = dayIndex != null ? dayList[dayIndex] : (dayList[0] ?? undefined);
    navigation.setOptions({
      headerStyle: { backgroundColor: colors.background },
      headerShadowVisible: false,
      headerTintColor: '#fff',
      title: trip?.name || 'Trip',
      headerTitle: dayIndex == null
        ? () => (
            <View style={styles.headerTitleRow}>
              <View style={styles.titleSpacer} />
              <Text style={styles.headerTitleText} numberOfLines={1}>{trip?.name || 'Trip'}</Text>
              <View style={styles.titleActions}>
                <TouchableOpacity onPress={() => navigation.navigate('TripForm', { id })} hitSlop={8}>
                  <Ionicons name="pencil" size={17} color="#fff" />
                </TouchableOpacity>
                <TouchableOpacity onPress={confirmShare} hitSlop={8}>
                  <MaterialCommunityIcons name="share" size={22} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>
          )
        : undefined,
      headerLeft: dayIndex != null
        ? () => (
            <TouchableOpacity onPress={() => setDayIndex(null)} style={styles.headerBtn} hitSlop={8}>
              <Ionicons name="chevron-back" size={26} color="#fff" />
            </TouchableOpacity>
          )
        : undefined,
      headerRight: () => (
        <RoundIconButton
          icon="add"
          onPress={() => navigation.navigate('TripItemForm', { tripId: id, date: targetDate })}
          bg={accent}
        />
      ),
    });
  }, [navigation, id, trip?.name, trip?.shareCode, dayIndex, dayList]);

  if (tripQ.isLoading || !trip) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={accent} />
      </View>
    );
  }

  const selectedDate = dayIndex != null ? dayList[dayIndex] : null;

  // ── Day itinerary view ──
  if (selectedDate) {
    const allItems = trip.items ?? [];
    // Hotels covering the selected night (check-in date through check-out date).
    const lodgingForDay = allItems.filter((it) => {
      if (it.type !== 'hotel') return false;
      const ci = zonedParts(it.start, tz).dateStr;
      const co = zonedParts(it.end || it.start, tz).dateStr;
      return selectedDate >= ci && selectedDate <= co;
    });
    const lodgingNote = (h: TripItem) => {
      const ci = zonedParts(h.start, tz).dateStr;
      const co = zonedParts(h.end || h.start, tz).dateStr;
      if (selectedDate === ci) return `Check in ${zonedTimeLabel(h.start, tz)}`;
      if (selectedDate === co) return `Check out ${zonedTimeLabel(h.end || h.start, tz)}`;
      return 'Overnight';
    };
    // Non-hotel bookings that land on this day (drives the timeline vs empty state).
    const timedItems = allItems.filter((it) => {
      if (it.type === 'hotel') return false;
      const d = it.details as any;
      if ((it.type === 'flight' || it.type === 'transit') && (d?.departureTz || d?.arrivalTz)) {
        if (zonedParts(it.start, d.departureTz).dateStr === selectedDate) return true;
        if (it.end && zonedParts(it.end, d.arrivalTz).dateStr === selectedDate) return true;
        return false;
      }
      return zonedParts(it.start, tz).dateStr === selectedDate;
    });
    return (
      <View style={styles.screen}>
        <View style={styles.dayNav}>
          <TouchableOpacity disabled={dayIndex === 0} onPress={() => setDayIndex((i) => (i ?? 0) - 1)}>
            <Ionicons name="chevron-back" size={24} color={dayIndex === 0 ? colors.border : accent} />
          </TouchableOpacity>
          <View style={{ alignItems: 'center' }}>
            <Text style={styles.dayWeekday}>{new Date(selectedDate + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'long' })}</Text>
            <Text style={styles.dayLabel}>{new Date(selectedDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })}</Text>
            <Text style={styles.dayCount}>Day {(dayIndex ?? 0) + 1} of {dayList.length}</Text>
          </View>
          <TouchableOpacity disabled={dayIndex === dayList.length - 1} onPress={() => setDayIndex((i) => (i ?? 0) + 1)}>
            <Ionicons name="chevron-forward" size={24} color={dayIndex === dayList.length - 1 ? colors.border : accent} />
          </TouchableOpacity>
        </View>
        <ScrollView contentContainerStyle={styles.content}>
          {lodgingForDay.map((h) => (
            <View key={`lodge-${h._id}`} style={styles.lodgeBanner}>
              <MaterialCommunityIcons name="bed" size={18} color="#6A1B9A" />
              <Text style={styles.lodgeTitle}>{h.title}</Text>
              <Text style={styles.lodgeNote}>{lodgingNote(h)}</Text>
              <TouchableOpacity onPress={() => navigation.navigate('TripItemForm', { tripId: id, itemId: h._id, date: selectedDate })}>
                <Ionicons name="pencil" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          ))}
          {timedItems.length === 0 ? (
            lodgingForDay.length === 0 ? <Text style={styles.empty}>Nothing booked this day.</Text> : null
          ) : (
            <TripTimeline
              items={trip.items ?? []}
              selectedDate={selectedDate}
              tz={tz}
              onEditItem={(itemId) => navigation.navigate('TripItemForm', { tripId: id, itemId, date: selectedDate })}
            />
          )}
        </ScrollView>
        {aiEnabled && (
          <TouchableOpacity
            style={[styles.fab, { backgroundColor: accent }]}
            activeOpacity={0.85}
            onPress={() => navigation.navigate('VacationAssistant', { tripId: id, tripName: trip?.name })}
          >
            <AssistantIcon size={26} color="#fff" />
          </TouchableOpacity>
        )}
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
                const types = markerTypesForDate(dateStr);
                const hasLodging = hasLodgingForDate(dateStr);
                return (
                  <TouchableOpacity key={dateStr} style={[styles.dayCell, dateStr === todayStr && { borderColor: accent, borderWidth: 2 }]} onPress={() => setDayIndex(idx)}>
                    <Text style={[styles.dcIndex, { color: accent }]}>Day {idx + 1}</Text>
                    <Text style={styles.dcWeekday}>{d.toLocaleDateString(undefined, { weekday: 'short' })}</Text>
                    <Text style={styles.dcDayNum}>{d.getDate()}</Text>
                    <Text style={styles.dcMonth}>{d.toLocaleDateString(undefined, { month: 'short' })}</Text>
                    <View style={styles.dcMarkers}>
                      {hasLodging ? (
                        <MaterialCommunityIcons name={tripTypeMeta('hotel').icon as any} size={12} color={tripTypeMeta('hotel').color} />
                      ) : null}
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
              <Ionicons name="wallet-outline" size={18} color={accent} />
              <Text style={styles.budgetTitle}>Your budget</Text>
              <Text style={styles.budgetTotal}>
                {budgetQ.data.baseCurrency} {Math.round(budgetQ.data.total)}
                {budgetQ.data.budget != null ? ` / ${Math.round(budgetQ.data.budget)}` : ''}
              </Text>
            </View>
            {(() => {
              const uncosted = (trip.items ?? []).filter((it) => (it.myData?.cost ?? it.cost) == null);
              if (!uncosted.length) return null;
              return (
                <View style={styles.uncostedWrap}>
                  <TouchableOpacity style={styles.uncostedToggle} onPress={() => setShowUncosted((v) => !v)}>
                    <Ionicons name="alert-circle-outline" size={14} color="#B26A00" />
                    <Text style={styles.uncostedToggleText}>
                      {uncosted.length} booking{uncosted.length > 1 ? 's have' : ' has'} no cost set
                    </Text>
                    <Ionicons name={showUncosted ? 'chevron-up' : 'chevron-down'} size={14} color="#B26A00" />
                  </TouchableOpacity>
                  {showUncosted && uncosted.map((it) => (
                    <TouchableOpacity
                      key={it._id}
                      style={styles.uncostedRow}
                      onPress={() => navigation.navigate('TripItemForm', { tripId: id, itemId: it._id })}
                    >
                      <MaterialCommunityIcons name={tripTypeMeta(it.type).icon as any} size={14} color={tripTypeMeta(it.type).color} />
                      <Text style={styles.uncostedRowTitle} numberOfLines={1}>{it.title}</Text>
                      <Ionicons name="pencil" size={14} color={colors.textMuted} />
                    </TouchableOpacity>
                  ))}
                </View>
              );
            })()}
            {budgetQ.data.byType.length ? <Divider /> : null}
            {budgetQ.data.byType.map((b) => {
              const expanded = expandedType === b.type;
              const typeItems = expanded
                ? (trip.items ?? [])
                    .filter((it) => it.type === b.type)
                    .sort((x, y) => x.start.localeCompare(y.start))
                : [];
              return (
                <View key={b.type}>
                  <TouchableOpacity style={styles.btRow} onPress={() => setExpandedType(expanded ? null : b.type)}>
                    <MaterialCommunityIcons name={tripTypeMeta(b.type).icon as any} size={14} color={tripTypeMeta(b.type).color} />
                    <Text style={styles.btLabel}>{tripTypeMeta(b.type).label}</Text>
                    <Text style={styles.btAmount}>{budgetQ.data!.baseCurrency} {Math.round(b.amount)}</Text>
                    <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={14} color={colors.textMuted} />
                  </TouchableOpacity>
                  {typeItems.map((it) => {
                    const cost = it.myData?.cost ?? it.cost;
                    const dateStr = zonedParts(it.start, tz).dateStr;
                    return (
                      <TouchableOpacity
                        key={it._id}
                        style={styles.btItemRow}
                        onPress={() => navigation.navigate('TripItemForm', { tripId: id, itemId: it._id })}
                      >
                        <Text style={styles.btItemTitle} numberOfLines={1}>{it.title}</Text>
                        <Text style={styles.btItemDate}>
                          {new Date(dateStr + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </Text>
                        <Text style={styles.btItemCost}>
                          {cost != null ? `${it.currency || budgetQ.data!.baseCurrency} ${Math.round(cost)}` : '—'}
                        </Text>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              );
            })}
            <TouchableOpacity style={styles.settleLink} onPress={() => navigation.navigate('TripSettle', { id })}>
              <Text style={[styles.settleText, { color: accent }]}>Settle up</Text>
              <Ionicons name="chevron-forward" size={16} color={accent} />
            </TouchableOpacity>
          </Card>
        ) : null}

        {outOfRangeItems.length > 0 ? (
          <View style={styles.oorWrap}>
            <Text style={styles.oorLabel}>Outside your trip dates</Text>
            <Text style={styles.oorSubtitle}>
              {outOfRangeItems.length === 1 ? 'This booking falls' : 'These bookings fall'} outside{' '}
              {dayList.length ? `${new Date(dayList[0] + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} – ${new Date(dayList[dayList.length - 1] + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'the trip dates'}.
              {' '}Edit a booking or adjust the trip dates.
            </Text>
            {outOfRangeItems.map(({ item, label }) => (
              <TouchableOpacity
                key={item._id}
                style={styles.oorCard}
                onPress={() => navigation.navigate('TripItemForm', { tripId: id, itemId: item._id })}
              >
                <View style={[styles.oorBar, { backgroundColor: tripTypeMeta(item.type).color }]} />
                <MaterialCommunityIcons name={tripTypeMeta(item.type).icon as any} size={16} color={tripTypeMeta(item.type).color} />
                <View style={styles.oorInfo}>
                  <Text style={styles.oorTitle} numberOfLines={1}>{item.title}</Text>
                  <Text style={styles.oorDate}>{label}</Text>
                </View>
                <Ionicons name="pencil" size={15} color={colors.textMuted} />
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        {trip.notes ? (
          <View style={styles.notesWrap}>
            <Text style={styles.sectionLabel}>Notes</Text>
            <Text style={styles.notes}>{trip.notes}</Text>
          </View>
        ) : null}
      </ScrollView>
      {aiEnabled && (
        <TouchableOpacity
          style={[styles.fab, { backgroundColor: accent }]}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('VacationAssistant', { tripId: id, tripName: trip?.name })}
        >
          <AssistantIcon size={26} color="#fff" />
        </TouchableOpacity>
      )}

      <Modal visible={shareModal} transparent animationType="fade" onRequestClose={() => setShareModal(false)}>
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setShareModal(false)}>
          <TouchableOpacity style={styles.shareSheet} activeOpacity={1}>
            <View style={styles.shareHandle} />
            <Text style={styles.shareTitle}>Share this trip</Text>
            <Text style={styles.shareSub}>Anyone with this code can view and add to the trip.</Text>

            <TouchableOpacity style={styles.codeBox} activeOpacity={0.7} onPress={copyCode}>
              <Text style={styles.codeText}>{trip?.shareCode}</Text>
              <View style={styles.codeCopy}>
                <Ionicons name={copied ? 'checkmark' : 'copy-outline'} size={16} color={accent} />
                <Text style={[styles.codeCopyText, { color: accent }]}>{copied ? 'Copied' : 'Copy'}</Text>
              </View>
            </TouchableOpacity>

            <TouchableOpacity style={[styles.shareSendBtn, { backgroundColor: accent }]} activeOpacity={0.85} onPress={sendCode}>
              <MaterialCommunityIcons name="share" size={18} color="#fff" />
              <Text style={styles.shareSendText}>Send code</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.shareStopBtn} onPress={stopSharing}>
              <Text style={styles.shareStopText}>Stop sharing</Text>
            </TouchableOpacity>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: 96 },
  headerBtn: { paddingHorizontal: 5 },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
  headerTitleText: { color: '#fff', fontSize: 17, fontWeight: '600', flexShrink: 1 },
  // Left spacer mirrors the icon block's width so the title text stays centered on screen
  // while the pencil sits tight to its right.
  titleSpacer: { width: 49 },
  titleActions: { flexDirection: 'row', alignItems: 'center', gap: 10, width: 49 },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md, flexWrap: 'wrap' },
  destination: { fontSize: 14, color: colors.textMuted },
  sectionLabel: { fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginBottom: spacing.sm },
  optionsWrap: { marginBottom: spacing.md },
  optionCard: { marginBottom: spacing.sm },
  optionTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  daysGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.lg },
  dayCell: { width: 84, padding: spacing.sm, borderRadius: 12, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border, alignItems: 'center' },
  dayCellToday: { borderWidth: 2 },
  dcIndex: { fontSize: 11, fontWeight: '700' },
  dcWeekday: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  dcDayNum: { fontSize: 22, fontWeight: '700', color: colors.text },
  dcMonth: { fontSize: 12, color: colors.textMuted },
  dcMarkers: { flexDirection: 'row', gap: 2, marginTop: 4, minHeight: 14 },
  dayNav: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: spacing.md },
  dayWeekday: { fontSize: 12, color: colors.textMuted, textTransform: 'uppercase', fontWeight: '600' },
  dayLabel: { fontSize: 17, fontWeight: '700', color: colors.text },
  dayCount: { fontSize: 12, color: colors.textMuted },
  backToCal: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  backToCalText: { fontSize: 13, fontWeight: '600' },
  lodgeBanner: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: '#6A1B9A14', borderRadius: 10, padding: spacing.sm, marginBottom: spacing.sm },
  lodgeTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  lodgeNote: { flex: 1, fontSize: 13, color: colors.textMuted },
  itemCard: { marginBottom: spacing.sm },
  itemHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  itemTitle: { flex: 1, fontSize: 16, fontWeight: '600', color: colors.text },
  itemTime: { fontSize: 13, color: colors.text, marginTop: 4, fontWeight: '500' },
  itemSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  budgetCard: { marginBottom: spacing.md },
  budgetHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.sm },
  budgetTitle: { fontSize: 15, fontWeight: '700', color: colors.text, flex: 1 },
  budgetTotal: { fontSize: 14, fontWeight: '600', color: colors.text },
  uncostedWrap: { marginTop: spacing.sm },
  uncostedToggle: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6 },
  uncostedToggleText: { flex: 1, fontSize: 13, fontWeight: '600', color: '#B26A00' },
  uncostedRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5, paddingLeft: 4, borderRadius: 6 },
  uncostedRowTitle: { flex: 1, fontSize: 13, color: colors.text },
  btRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 6 },
  btLabel: { flex: 1, fontSize: 14, color: colors.text },
  btAmount: { fontSize: 14, color: colors.textMuted },
  btItemRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 5, paddingLeft: 22 },
  btItemTitle: { flex: 1, fontSize: 13, color: colors.text },
  btItemDate: { fontSize: 12, color: colors.textMuted },
  btItemCost: { fontSize: 13, color: colors.textMuted, minWidth: 60, textAlign: 'right' },
  settleLink: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm, paddingTop: spacing.sm, borderTopWidth: 1, borderTopColor: colors.border },
  settleText: { fontWeight: '700', fontSize: 13, textTransform: 'uppercase' },
  oorWrap: { marginBottom: spacing.md },
  oorLabel: { fontSize: 13, fontWeight: '700', color: '#C62828', textTransform: 'uppercase', marginBottom: 4 },
  oorSubtitle: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm },
  oorCard: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, backgroundColor: colors.surface, borderRadius: 10, padding: spacing.sm, marginBottom: 6, borderWidth: 1, borderColor: colors.border, overflow: 'hidden' },
  oorBar: { position: 'absolute', left: 0, top: 0, bottom: 0, width: 4 },
  oorInfo: { flex: 1, paddingLeft: 4 },
  oorTitle: { fontSize: 14, fontWeight: '600', color: colors.text },
  oorDate: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  notesWrap: { marginTop: spacing.sm },
  notes: { fontSize: 14, color: colors.textMuted, lineHeight: 20 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  shareSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xl,
  },
  shareHandle: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: colors.border, marginBottom: spacing.md },
  shareTitle: { fontSize: 18, fontWeight: '700', color: colors.text, textAlign: 'center' },
  shareSub: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: 4, marginBottom: spacing.md },
  codeBox: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.background,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.md,
  },
  codeText: { fontSize: 22, fontWeight: '700', letterSpacing: 3, color: colors.text },
  codeCopy: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  codeCopyText: { fontSize: 13, fontWeight: '600' },
  shareSendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 12,
    paddingVertical: spacing.md,
  },
  shareSendText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  shareStopBtn: { alignItems: 'center', paddingVertical: spacing.md, marginTop: 4 },
  shareStopText: { color: '#C62828', fontSize: 15, fontWeight: '600' },
});
