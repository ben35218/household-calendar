import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { tripsApi, placesApi, CandidateRange, TripStatus, Trip, FormAssistField } from '../../api';
import { sealNew, sealUpdate, openRecord } from '../../lib/e2ee';

// Encrypted trip content (dates/candidateRanges/color stay plaintext).
const TRIP_ENC = (p: Record<string, unknown>) => ({ name: p.name, destination: p.destination, notes: p.notes });
import { Button, Input, Select, Screen, SectionTitle, DateField, useHeaderCheckButton } from '../../components/ui';
import FormAssist from '../../components/FormAssist';
import { useFormAssist } from '../../hooks/useFormAssist';
import PlacesAutocomplete from '../../components/PlacesAutocomplete';
import { TRIP_PURPLE } from '../../lib/tripTypes';
import { useCalendarColors } from '../../lib/calendarPrefs';
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

// Schema the AI form assistant fills. Names match the form-state keys.
const ASSIST_FIELDS: FormAssistField[] = [
  { name: 'name', type: 'text', label: 'Trip name' },
  { name: 'destination', type: 'text', label: 'Destination (city)' },
  { name: 'status', type: 'select', label: 'Status', options: STATUS_OPTIONS },
  { name: 'startDate', type: 'date', label: 'Start date' },
  { name: 'endDate', type: 'date', label: 'End date' },
  { name: 'notes', type: 'text', label: 'Notes' },
];

export default function TripFormScreen() {
  const navigation = useNavigation<Nav>();
  const { id } = useRoute<Rt>().params || {};
  const isEdit = !!id;
  const qc = useQueryClient();
  const accent = useCalendarColors().colors.vacations;

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
  const assist = useFormAssist();

  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    assist.clear(Object.keys(patch));
  };

  const applyPatch = (patch: Record<string, unknown>) => {
    const next: Partial<typeof form> = {};
    const changedKeys: string[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in form)) continue;
      const val = v == null ? '' : v;
      if ((form as any)[k] !== val) changedKeys.push(k);
      (next as any)[k] = val;
    }
    setForm((f) => ({ ...f, ...next }));
    assist.mark(changedKeys);
  };

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
    let cancelled = false;
    (async () => {
    // GET /trips/:id returns { trip, items, isOwner }; older callers expect a flat trip.
    const data = tripQ.data as unknown as { trip?: Trip };
    const t = await openRecord('Trip', data.trip ?? (tripQ.data as Trip)); // decrypt content over plaintext
    if (cancelled || !t || !t.name) return;
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
    })();
    return () => { cancelled = true; };
  }, [tripQ.data]);

  const save = useMutation({
    mutationFn: async () => {
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
      return isEdit
        ? tripsApi.update(id!, await sealUpdate('Trip', id!, payload, TRIP_ENC(payload)))
        : tripsApi.create(await sealNew('Trip', payload, TRIP_ENC(payload)));
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      const newId = res.data?._id;
      if (!isEdit && newId) navigation.replace('TripDetail', { id: newId });
      else navigation.goBack();
    },
    onError: (e: any) => setError(e.response?.data?.error || 'Save failed'),
  });

  const del = useMutation({
    mutationFn: () => tripsApi.remove(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      navigation.navigate('Vacations');
    },
    onError: (e: any) => setError(e.response?.data?.error || 'Delete failed'),
  });

  const onDelete = () => {
    Alert.alert('Delete trip?', `Delete "${form.name || 'this trip'}"? This can't be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => del.mutate() },
    ]);
  };

  // GET /trips/:id reports whether the caller's household owns the trip. Only the
  // owner may delete it; a guest collaborator removes themselves via leave-share
  // instead (mirrors the web TripDetailView). Default true so a brand-new trip or
  // an older API response shows the owner path — the server enforces either way.
  const isOwner = (tripQ.data as unknown as { isOwner?: boolean } | undefined)?.isOwner ?? true;

  const leave = useMutation({
    mutationFn: () => tripsApi.leaveShare(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      navigation.navigate('Vacations');
    },
    onError: (e: any) => setError(e.response?.data?.error || 'Could not leave trip'),
  });

  const onLeave = () => {
    Alert.alert(
      'Leave this trip?',
      'You’ll be removed as a collaborator. The trip stays with its owner, and you can rejoin later with the invite code.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Leave', style: 'destructive', onPress: () => leave.mutate() },
      ],
    );
  };

  const onSave = () => {
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    setError('');
    save.mutate();
  };

  useHeaderCheckButton(navigation, { onPress: onSave, loading: save.isPending, color: accent });

  if (isEdit && tripQ.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={accent} />
      </View>
    );
  }

  return (
    <Screen>
      <FormAssist
        formType="trip / vacation"
        title="Trip Assistant"
        placeholder={'Describe the trip, e.g. "10-day trip to Rome in May, booked"'}
        fields={ASSIST_FIELDS}
        current={{ ...form }}
        onApply={applyPatch}
      />

      <Input label="Trip Name *" value={form.name} onChangeText={(v) => set({ name: v })} placeholder="e.g. Rome 2026" highlight={assist.changed.has('name')} />
      <PlacesAutocomplete
        label="Destination"
        type="city"
        value={form.destination}
        onChangeText={(v) => set({ destination: v })}
        onSelect={(p) => placesApi.getTimezone(p.place_id).then((r) => r.data.timeZoneId && set({ destinationTz: r.data.timeZoneId })).catch(() => {})}
        highlight={assist.changed.has('destination')}
      />
      <Input label="Destination timezone (IANA)" value={form.destinationTz} onChangeText={(v) => set({ destinationTz: v })} placeholder="e.g. Europe/Rome" autoCapitalize="none" />
      <Select label="Status" value={form.status} options={STATUS_OPTIONS} onChange={(v) => set({ status: (v as TripStatus) ?? 'considering' })} highlight={assist.changed.has('status')} />

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
            <DateField label="Start date" clearable value={form.startDate} onChange={(v) => set({ startDate: v })} highlight={assist.changed.has('startDate')} />
          </View>
          <View style={styles.col}>
            <DateField label="End date" clearable value={form.endDate} onChange={(v) => set({ endDate: v })} highlight={assist.changed.has('endDate')} />
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
      <Input label="Notes" value={form.notes} onChangeText={(v) => set({ notes: v })} multiline highlight={assist.changed.has('notes')} />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isEdit ? (
        isOwner ? (
          <TouchableOpacity onPress={onDelete} disabled={del.isPending} style={styles.deleteBtn}>
            <Text style={styles.deleteText}>{del.isPending ? 'Deleting…' : 'Delete Trip'}</Text>
          </TouchableOpacity>
        ) : (
          <TouchableOpacity onPress={onLeave} disabled={leave.isPending} style={styles.deleteBtn}>
            <Text style={styles.deleteText}>{leave.isPending ? 'Leaving…' : 'Leave this shared trip'}</Text>
          </TouchableOpacity>
        )
      ) : null}
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
  deleteBtn: { alignItems: 'center', paddingVertical: spacing.md, marginTop: spacing.md, marginBottom: spacing.xl },
  deleteText: { color: colors.error, fontWeight: '600', fontSize: 16 },
});
