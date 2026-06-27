import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { tripsApi, TripItemType } from '../../api';
import { Button, Input, Screen, SwitchRow, SectionTitle, Card, DateField, TimeField } from '../../components/ui';
import { TRIP_TYPES, tripTypeMeta, TRIP_PURPLE } from '../../lib/tripTypes';
import { zonedWallclockToUtc, zonedParts } from '../../lib/tz';
import { TripsStackParamList } from '../../navigation/TripsNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<TripsStackParamList, 'TripItemForm'>;
type Rt = RouteProp<TripsStackParamList, 'TripItemForm'>;

export default function TripItemFormScreen() {
  const navigation = useNavigation<Nav>();
  const { tripId, itemId, date } = useRoute<Rt>().params;
  const isEdit = !!itemId;
  const qc = useQueryClient();

  const [form, setForm] = useState({
    type: 'activity' as TripItemType,
    title: '',
    startDate: date || new Date().toISOString().slice(0, 10),
    startTime: '09:00',
    endDate: '',
    endTime: '',
    location: '',
    cost: '',
    currency: '',
    confirmation: '',
    confirmed: false,
    notes: '',
  });
  const [error, setError] = useState('');

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  const tripQ = useQuery({ queryKey: ['trips', tripId], queryFn: async () => (await tripsApi.get(tripId)).data });
  const tz = tripQ.data?.destinationTz || '';

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit Booking' : 'Add Booking' });
  }, [navigation, isEdit]);

  // Hydrate for edit from the trip's items.
  useEffect(() => {
    if (!isEdit || !tripQ.data) return;
    const it = tripQ.data.items?.find((x) => x._id === itemId);
    if (!it) return;
    const sp = zonedParts(it.start, tz);
    const ep = it.end ? zonedParts(it.end, tz) : null;
    setForm({
      type: it.type,
      title: it.title ?? '',
      startDate: sp.dateStr,
      startTime: sp.timeStr,
      endDate: ep?.dateStr ?? '',
      endTime: ep?.timeStr ?? '',
      location: it.location ?? '',
      cost: it.cost != null ? String(it.cost) : '',
      currency: it.currency ?? '',
      confirmation: it.confirmation ?? '',
      confirmed: !!it.confirmed,
      notes: it.notes ?? '',
    });
  }, [tripQ.data, isEdit, itemId, tz]);

  const save = useMutation({
    mutationFn: () => {
      const start = zonedWallclockToUtc(form.startDate, form.startTime, tz);
      const end = form.endDate ? zonedWallclockToUtc(form.endDate, form.endTime || '00:00', tz) : undefined;
      const payload: Record<string, unknown> = {
        type: form.type,
        title: form.title.trim(),
        start: start?.toISOString(),
        end: end ? end.toISOString() : undefined,
        location: form.location || undefined,
        cost: form.cost ? Number(form.cost) : undefined,
        currency: form.currency || undefined,
        confirmation: form.confirmation || undefined,
        confirmed: form.confirmed,
        sharing: 'private',
        notes: form.notes || undefined,
      };
      return isEdit ? tripsApi.updateItem(tripId, itemId!, payload) : tripsApi.addItem(tripId, payload);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trips', tripId] });
      navigation.goBack();
    },
    onError: (e: any) => setError(e.response?.data?.error || 'Save failed'),
  });

  const remove = useMutation({
    mutationFn: () => tripsApi.removeItem(tripId, itemId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['trips', tripId] });
      navigation.goBack();
    },
  });

  const onSave = () => {
    if (!form.title.trim()) {
      setError('Title is required');
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
      <SectionTitle>Type</SectionTitle>
      <View style={styles.typeGrid}>
        {TRIP_TYPES.map((t) => {
          const active = form.type === t.value;
          return (
            <TouchableOpacity
              key={t.value}
              style={[styles.typeChip, active && { backgroundColor: t.color, borderColor: t.color }]}
              onPress={() => set({ type: t.value })}
            >
              <MaterialCommunityIcons name={t.icon as any} size={18} color={active ? '#fff' : t.color} />
              <Text style={[styles.typeLabel, active && { color: '#fff' }]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
      </View>

      <Input label="Title *" value={form.title} onChangeText={(v) => set({ title: v })} placeholder={tripTypeMeta(form.type).label} />

      <View style={styles.cols}>
        <View style={styles.col}>
          <DateField label="Start date" clearable value={form.startDate} onChange={(v) => set({ startDate: v })} />
        </View>
        <View style={styles.col}>
          <TimeField label="Start time" clearable value={form.startTime} onChange={(v) => set({ startTime: v })} />
        </View>
      </View>
      <View style={styles.cols}>
        <View style={styles.col}>
          <DateField label="End date" clearable value={form.endDate} onChange={(v) => set({ endDate: v })} />
        </View>
        <View style={styles.col}>
          <TimeField label="End time" clearable value={form.endTime} onChange={(v) => set({ endTime: v })} />
        </View>
      </View>

      <Input label="Location" value={form.location} onChangeText={(v) => set({ location: v })} />

      <View style={styles.cols}>
        <View style={styles.col}>
          <Input label="Cost" keyboardType="numeric" value={form.cost} onChangeText={(v) => set({ cost: v })} />
        </View>
        <View style={styles.col}>
          <Input label="Currency" value={form.currency} onChangeText={(v) => set({ currency: v })} placeholder="USD" autoCapitalize="characters" />
        </View>
      </View>
      <Input label="Confirmation #" value={form.confirmation} onChangeText={(v) => set({ confirmation: v })} />
      <SwitchRow label="Booked / confirmed" value={form.confirmed} onValueChange={(v) => set({ confirmed: v })} />
      <Input label="Notes" value={form.notes} onChangeText={(v) => set({ notes: v })} multiline />

      {tz ? <Text style={styles.tzNote}>Times are local to {tz}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        {isEdit ? (
          <Button
            title="Delete"
            variant="danger"
            onPress={() =>
              Alert.alert('Delete booking?', '', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => remove.mutate() },
              ])
            }
          />
        ) : null}
        <View style={{ flex: 1 }}>
          <Button title={isEdit ? 'Save' : 'Add Booking'} loading={save.isPending} onPress={onSave} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  typeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderWidth: 1, borderColor: colors.border, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  typeLabel: { fontSize: 13, fontWeight: '600', color: colors.text },
  cols: { flexDirection: 'row', gap: spacing.sm },
  col: { flex: 1 },
  tzNote: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm },
  error: { color: colors.error, marginVertical: spacing.sm },
  footer: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.xl, alignItems: 'center' },
});
