import React, { useLayoutEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { tripsApi, Trip } from '../../api';
import { Card, Badge, Input, Button } from '../../components/ui';
import { tripStatusLabel, tripStatusColor, TRIP_PURPLE } from '../../lib/tripTypes';
import { formatCalendarDate } from '../../lib/recurrence';
import { TripsStackParamList } from '../../navigation/TripsNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<TripsStackParamList, 'Vacations'>;

const todayStr = new Date().toISOString().slice(0, 10);

function endStr(t: Trip) {
  const d = t.endDate || t.startDate;
  return d ? new Date(d).toISOString().slice(0, 10) : null;
}

function dateSummary(t: Trip) {
  if (t.status === 'considering') {
    const n = t.candidateRanges?.length ?? 0;
    if (!n) return 'No dates chosen yet';
    if (n === 1) return `${formatCalendarDate(t.candidateRanges![0].start)} – ${formatCalendarDate(t.candidateRanges![0].end)}`;
    return `${n} date options`;
  }
  if (t.startDate) {
    const end = t.endDate && t.endDate !== t.startDate ? ` – ${formatCalendarDate(t.endDate)}` : '';
    return `${formatCalendarDate(t.startDate)}${end}`;
  }
  return 'No dates set';
}

export default function VacationsScreen() {
  const navigation = useNavigation<Nav>();
  const [joinOpen, setJoinOpen] = useState(false);
  const [joinCode, setJoinCode] = useState('');

  const tripsQ = useQuery({ queryKey: ['trips'], queryFn: async () => (await tripsApi.list()).data });

  const join = useMutation({
    mutationFn: () => tripsApi.joinShare(joinCode.trim().toUpperCase()),
    onSuccess: (res) => {
      setJoinOpen(false);
      setJoinCode('');
      navigation.navigate('TripDetail', { id: res.data.tripId });
    },
    onError: (e: any) => Alert.alert('Could not join', e.response?.data?.error || 'Invalid code'),
  });

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => setJoinOpen(true)} style={styles.headerBtn}>
            <Ionicons name="enter-outline" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('TripForm', {})} style={styles.headerBtn}>
            <Ionicons name="add" size={24} color="#fff" />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation]);

  const groups = useMemo(() => {
    const trips = tripsQ.data ?? [];
    const considering = trips.filter((t) => t.status === 'considering');
    const booked = trips.filter((t) => t.status === 'booked');
    const upcoming = booked.filter((t) => !endStr(t) || endStr(t)! >= todayStr);
    const past = trips.filter((t) => t.status === 'completed' || (t.status === 'booked' && endStr(t) && endStr(t)! < todayStr));
    const byStart = (a: Trip, b: Trip) => new Date(a.startDate || 0).getTime() - new Date(b.startDate || 0).getTime();
    return [
      { label: 'Considering', items: considering },
      { label: 'Upcoming', items: upcoming.sort(byStart) },
      { label: 'Past', items: past.sort((a, b) => byStart(b, a)) },
    ].filter((g) => g.items.length > 0);
  }, [tripsQ.data]);

  if (tripsQ.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={TRIP_PURPLE} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={tripsQ.isRefetching} onRefresh={tripsQ.refetch} />}
      >
        {groups.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="briefcase-outline" size={48} color={colors.textMuted} />
            <Text style={styles.emptyText}>No trips yet. Plan your next getaway.</Text>
          </View>
        ) : (
          groups.map((g) => (
            <View key={g.label} style={styles.group}>
              <Text style={styles.groupTitle}>{g.label}</Text>
              {g.items.map((t) => (
                <TouchableOpacity key={t._id} activeOpacity={0.8} onPress={() => navigation.navigate('TripDetail', { id: t._id })}>
                  <Card style={styles.tripCard}>
                    <View style={[styles.bar, { backgroundColor: t.color || TRIP_PURPLE }]} />
                    <View style={{ flex: 1, paddingLeft: spacing.md }}>
                      <View style={styles.titleRow}>
                        <Text style={styles.name}>{t.name}</Text>
                        <Badge label={tripStatusLabel(t.status)} color={tripStatusColor(t.status)} />
                      </View>
                      {t.destination ? <Text style={styles.sub}>{t.destination}</Text> : null}
                      <Text style={styles.sub}>{dateSummary(t)}</Text>
                    </View>
                  </Card>
                </TouchableOpacity>
              ))}
            </View>
          ))
        )}
      </ScrollView>

      {joinOpen ? (
        <View style={styles.joinOverlay}>
          <Card style={styles.joinCard}>
            <Text style={styles.joinTitle}>Join a shared trip</Text>
            <Input label="Invite code" value={joinCode} onChangeText={setJoinCode} autoCapitalize="characters" />
            <View style={styles.joinBtns}>
              <Button title="Cancel" variant="ghost" onPress={() => setJoinOpen(false)} />
              <View style={{ flex: 1 }}>
                <Button title="Join" loading={join.isPending} disabled={!joinCode.trim()} onPress={() => join.mutate()} />
              </View>
            </View>
          </Card>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { padding: spacing.md },
  headerActions: { flexDirection: 'row' },
  headerBtn: { paddingHorizontal: 6 },
  group: { marginBottom: spacing.lg },
  groupTitle: { fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginBottom: spacing.sm },
  tripCard: { flexDirection: 'row', padding: 0, paddingVertical: spacing.md, paddingRight: spacing.md, overflow: 'hidden', marginBottom: spacing.sm },
  bar: { width: 5, alignSelf: 'stretch' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, flexWrap: 'wrap' },
  name: { fontSize: 17, fontWeight: '700', color: colors.text },
  sub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  empty: { alignItems: 'center', marginTop: spacing.xl, gap: spacing.sm },
  emptyText: { color: colors.textMuted, fontSize: 15 },
  joinOverlay: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'center', padding: spacing.lg },
  joinCard: { gap: spacing.sm },
  joinTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  joinBtns: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center' },
});
