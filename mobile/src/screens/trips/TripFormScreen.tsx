import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { tripsApi, placesApi, CandidateRange, TripStatus } from '../../api';
import { Button, Input, Select, Screen, SectionTitle, DateField } from '../../components/ui';
import PlacesAutocomplete from '../../components/PlacesAutocomplete';
import { TRIP_PURPLE } from '../../lib/tripTypes';
import { TripsStackParamList } from '../../navigation/TripsNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<TripsStackParamList, 'TripForm'>;
type Rt = RouteProp<TripsStackParamList, 'TripForm'>;

const STATUS_OPTIONS = [
  { label: 'Considering', value: 'considering' },
  { label: 'Booked', value: 'booked' },
  { label: 'Past', value: 'completed' },
];

const COLORS = ['#5E35B1', '#1565C0', '#2E7D32', '#C62828', '#EF6C00', '#00838F', '#6A1B9A'];

export default function TripFormScreen() {
  const navigation = useNavigation<Nav>();
  const { id } = useRoute<Rt>().params || {};
  const isEdit = !!id;
  const qc = useQueryClient();

  const [form, setForm] = useState({
    name: '',
    destination: '',
    destinationTz: '',
    status: 'considering' as TripStatus,
    startDate: '',
    endDate: '',
    color: TRIP_PURPLE,
    notes: '',
  });
  const [ranges, setRanges] = useState<CandidateRange[]>([]);
  const [error, setError] = useState('');

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit Trip' : 'New Trip' });
  }, [navigation, isEdit]);

  const tripQ = useQuery({
    queryKey: ['trips', id],
    queryFn: async () => (await tripsApi.get(id!)).data,
    enabled: isEdit,
  });
  useEffect(() => {
    if (!tripQ.data) return;
    const t = tripQ.data;
    setForm({
      name: t.name ?? '',
      destination: t.destination ?? '',
      destinationTz: t.destinationTz ?? '',
      status: t.status,
      startDate: t.startDate ? t.startDate.slice(0, 10) : '',
      endDate: t.endDate ? t.endDate.slice(0, 10) : '',
      color: t.color || TRIP_PURPLE,
      notes: t.notes ?? '',
    });
    setRanges(t.candidateRanges ?? []);
  }, [tripQ.data]);

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        destination: form.destination || undefined,
        destinationTz: form.destinationTz || undefined,
        status: form.status,
        color: form.color,
        notes: form.notes,
      };
      if (form.status === 'considering') {
        payload.candidateRanges = ranges.filter((r) => r.start && r.end);
      } else {
        payload.startDate = form.startDate || undefined;
        payload.endDate = form.endDate || undefined;
      }
      return isEdit ? tripsApi.update(id!, payload) : tripsApi.create(payload);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      const newId = res.data?._id;
      if (!isEdit && newId) navigation.replace('TripDetail', { id: newId });
      else navigation.goBack();
    },
    onError: (e: any) => setError(e.response?.data?.error || 'Save failed'),
  });

  const onSave = () => {
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    setError('');
    save.mutate();
  };

  if (isEdit && tripQ.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={TRIP_PURPLE} />
      </View>
    );
  }

  return (
    <Screen>
      <Input label="Trip Name *" value={form.name} onChangeText={(v) => set({ name: v })} placeholder="e.g. Rome 2026" />
      <PlacesAutocomplete
        label="Destination"
        value={form.destination}
        onChangeText={(v) => set({ destination: v })}
        onSelect={(p) => placesApi.getTimezone(p.place_id).then((r) => r.data.timeZoneId && set({ destinationTz: r.data.timeZoneId })).catch(() => {})}
      />
      <Input label="Destination timezone (IANA)" value={form.destinationTz} onChangeText={(v) => set({ destinationTz: v })} placeholder="e.g. Europe/Rome" autoCapitalize="none" />
      <Select label="Status" value={form.status} options={STATUS_OPTIONS} onChange={(v) => set({ status: (v as TripStatus) ?? 'considering' })} />

      {form.status === 'considering' ? (
        <>
          <SectionTitle>Date options</SectionTitle>
          {ranges.map((r, i) => (
            <View key={i} style={styles.rangeRow}>
              <View style={{ flex: 1 }}>
                <DateField placeholder="Start date" value={r.start} onChange={(v) => setRanges((rs) => rs.map((x, j) => (j === i ? { ...x, start: v } : x)))} />
              </View>
              <View style={{ flex: 1 }}>
                <DateField placeholder="End date" value={r.end} onChange={(v) => setRanges((rs) => rs.map((x, j) => (j === i ? { ...x, end: v } : x)))} />
              </View>
              <TouchableOpacity onPress={() => setRanges((rs) => rs.filter((_, j) => j !== i))} style={styles.removeBtn}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          ))}
          <Button title="+ Add date option" variant="ghost" onPress={() => setRanges((rs) => [...rs, { start: '', end: '' }])} />
        </>
      ) : (
        <View style={styles.cols}>
          <View style={styles.col}>
            <DateField label="Start date" clearable value={form.startDate} onChange={(v) => set({ startDate: v })} />
          </View>
          <View style={styles.col}>
            <DateField label="End date" clearable value={form.endDate} onChange={(v) => set({ endDate: v })} />
          </View>
        </View>
      )}

      <SectionTitle>Color</SectionTitle>
      <View style={styles.swatchRow}>
        {COLORS.map((c) => (
          <TouchableOpacity
            key={c}
            style={[styles.swatch, { backgroundColor: c }, form.color === c && styles.swatchActive]}
            onPress={() => set({ color: c })}
          />
        ))}
      </View>

      <View style={{ height: spacing.md }} />
      <Input label="Notes" value={form.notes} onChangeText={(v) => set({ notes: v })} multiline />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} />
        <View style={{ flex: 1 }}>
          <Button title={isEdit ? 'Save Changes' : 'Create Trip'} loading={save.isPending} onPress={onSave} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  rangeRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  removeBtn: { paddingTop: 12 },
  cols: { flexDirection: 'row', gap: spacing.sm },
  col: { flex: 1 },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatch: { width: 36, height: 36, borderRadius: 18 },
  swatchActive: { borderWidth: 3, borderColor: colors.text },
  error: { color: colors.error, marginVertical: spacing.sm },
  footer: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.xl, alignItems: 'center' },
});
