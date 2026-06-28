import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { tripsApi, placesApi, TripItemType } from '../../api';
import { Button, Input, Screen, SwitchRow, SectionTitle, DateField, TimeField, Select, Divider } from '../../components/ui';
import PlacesAutocomplete from '../../components/PlacesAutocomplete';
import { TRIP_TYPES, tripTypeMeta, TRIP_PURPLE } from '../../lib/tripTypes';
import { zonedWallclockToUtc, zonedParts } from '../../lib/tz';
import { TripsStackParamList } from '../../navigation/TripsNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<TripsStackParamList, 'TripItemForm'>;
type Rt = RouteProp<TripsStackParamList, 'TripItemForm'>;

const CURRENCIES = ['CAD', 'USD', 'EUR', 'GBP', 'JPY', 'AUD', 'CHF', 'CNY', 'MXN', 'INR'];
const TZ_OPTIONS = [
  '', 'America/Toronto', 'America/New_York', 'America/Chicago', 'America/Denver',
  'America/Los_Angeles', 'America/Vancouver', 'Europe/London', 'Europe/Paris',
  'Europe/Madrid', 'Asia/Tokyo', 'Asia/Dubai', 'Australia/Sydney',
];

const SHARING_OPTIONS = [
  { value: 'private', label: 'Just my family' },
  { value: 'shared_separate', label: 'Shared — separate bookings' },
  { value: 'shared_one_separate', label: 'Shared — one booking, separate bills' },
  { value: 'shared_shared', label: 'Shared — one booking, one shared bill' },
];
const PRIVATE_BILL = ['shared_separate', 'shared_one_separate'];

type ShareRow = { householdId: string; name: string; included: boolean; amount: number | null };

// Faithful port of client/src/views/TripItemFormView.vue: standard + journey
// (dual-timezone) bookings and the multi-family cost-sharing modes. (Place
// autocomplete + timezone auto-fill are wired in the cross-cutting Places wave;
// here the leg timezone is chosen explicitly.)
export default function TripItemFormScreen() {
  const navigation = useNavigation<Nav>();
  const { tripId, itemId, date } = useRoute<Rt>().params;
  const isEdit = !!itemId;
  const qc = useQueryClient();

  const today = date || new Date().toISOString().slice(0, 10);
  const [form, setForm] = useState({
    type: 'activity' as TripItemType,
    title: '',
    startDate: today, startTime: '09:00', endDate: '', endTime: '',
    // journey
    depName: '', departureTz: '', depDate: today, depTime: '09:00',
    arrName: '', arrivalTz: '', arrDate: today, arrTime: '12:00',
    airline: '', flightNumber: '', seat: '', mode: '',
    // common
    location: '', cost: '', currency: '', confirmation: '', confirmed: false,
    url: '', phone: '', notes: '',
    sharing: 'private', paidByHouseholdId: '',
  });
  const [shareRows, setShareRows] = useState<ShareRow[]>([]);
  const [error, setError] = useState('');

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));
  const isJourney = form.type === 'flight' || form.type === 'transit';

  const tripQ = useQuery({ queryKey: ['trips', tripId], queryFn: async () => (await tripsApi.get(tripId)).data });
  const familiesQ = useQuery({ queryKey: ['trips', tripId, 'families'], queryFn: async () => (await tripsApi.families(tripId)).data });
  const tz = tripQ.data?.destinationTz || '';
  const families = familiesQ.data ?? [];
  const multiFamily = families.length > 1;

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit Booking' : 'Add Booking' });
  }, [navigation, isEdit]);

  function buildShareRows(existing: { householdId: string; amount?: number | null }[] = [], myId?: string) {
    const byId = Object.fromEntries(existing.map((s) => [String(s.householdId), s.amount ?? null]));
    setShareRows(
      families.map((f) => ({
        householdId: String(f.householdId),
        name: f.name,
        included: existing.length ? Object.prototype.hasOwnProperty.call(byId, String(f.householdId)) : String(f.householdId) === String(myId),
        amount: byId[String(f.householdId)] ?? null,
      }))
    );
  }

  // Hydrate for edit.
  useEffect(() => {
    if (!isEdit || !tripQ.data) return;
    const it = tripQ.data.items?.find((x) => x._id === itemId);
    if (!it) return;
    const d = (it.details as any) || {};
    const journey = it.type === 'flight' || it.type === 'transit';
    if (journey && (d.departureTz || d.arrivalTz)) {
      const dep = zonedParts(it.start, d.departureTz);
      const arr = it.end ? zonedParts(it.end, d.arrivalTz) : null;
      setForm((f) => ({
        ...f, type: it.type, title: it.title ?? '',
        depName: d.departureName ?? '', departureTz: d.departureTz ?? '', depDate: dep.dateStr, depTime: dep.timeStr,
        arrName: d.arrivalName ?? '', arrivalTz: d.arrivalTz ?? '', arrDate: arr?.dateStr ?? '', arrTime: arr?.timeStr ?? '12:00',
        airline: d.airline ?? '', flightNumber: d.flightNumber ?? '', seat: d.seat ?? '', mode: d.mode ?? '',
        cost: it.cost != null ? String(it.cost) : '', currency: it.currency ?? '', confirmation: it.confirmation ?? '',
        url: it.url ?? '', phone: it.phone ?? '', notes: it.notes ?? '',
        sharing: it.sharing || 'private', paidByHouseholdId: it.paidByHouseholdId ?? '',
        confirmed: it.sharing === 'shared_separate' ? !!it.myData?.confirmed : !!it.confirmed,
      }));
    } else {
      const sp = zonedParts(it.start, tz);
      const ep = it.end ? zonedParts(it.end, tz) : null;
      setForm((f) => ({
        ...f, type: it.type, title: it.title ?? '',
        startDate: sp.dateStr, startTime: sp.timeStr, endDate: ep?.dateStr ?? '', endTime: ep?.timeStr ?? '',
        location: it.location ?? '', airline: d.airline ?? '', flightNumber: d.flightNumber ?? '', seat: d.seat ?? '', mode: d.mode ?? '',
        cost: (it.myData?.cost ?? it.cost) != null ? String(it.myData?.cost ?? it.cost) : '', currency: it.currency ?? '',
        confirmation: it.confirmation ?? '', url: it.url ?? '', phone: it.phone ?? '', notes: it.notes ?? '',
        sharing: it.sharing || 'private', paidByHouseholdId: it.paidByHouseholdId ?? '',
        confirmed: it.sharing === 'shared_separate' ? !!it.myData?.confirmed : !!it.confirmed,
      }));
    }
    const existing = it.shares ?? (it.participants ?? []).map((hid) => ({ householdId: hid, amount: null }));
    if (existing.length) buildShareRows(existing);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tripQ.data, familiesQ.data, isEdit, itemId, tz]);

  function toggleSharing(val: string) {
    set({ sharing: val });
    if (val !== 'private' && !shareRows.some((r) => r.included)) buildShareRows();
  }
  function splitEqually() {
    const inc = shareRows.filter((r) => r.included);
    if (!inc.length || !form.cost) return;
    const each = Math.round((Number(form.cost) / inc.length) * 100) / 100;
    setShareRows((rows) => rows.map((r) => (r.included ? { ...r, amount: each } : r)));
  }
  const includedFamilies = shareRows.filter((r) => r.included);
  const shareSum = includedFamilies.reduce((s, r) => s + (Number(r.amount) || 0), 0);

  const save = useMutation({
    mutationFn: () => {
      const mode = multiFamily ? form.sharing : 'private';
      const common: Record<string, unknown> = {
        url: form.url || undefined, phone: form.phone || undefined, notes: form.notes || undefined,
      };
      const included = shareRows.filter((r) => r.included).map((r) => r.householdId);
      if (mode === 'shared_separate') {
        Object.assign(common, {
          sharing: 'shared_separate', participants: included,
          myData: { cost: form.cost ? Number(form.cost) : null, currency: form.currency || undefined, confirmation: form.confirmation || undefined, confirmed: form.confirmed },
        });
      } else if (mode === 'shared_one_separate') {
        Object.assign(common, {
          sharing: 'shared_one_separate', participants: included,
          confirmation: form.confirmation || undefined, confirmed: form.confirmed,
          myData: { cost: form.cost ? Number(form.cost) : null, currency: form.currency || undefined },
        });
      } else if (mode === 'shared_shared') {
        Object.assign(common, {
          sharing: 'shared_shared', cost: form.cost ? Number(form.cost) : undefined, currency: form.currency || undefined,
          confirmation: form.confirmation || undefined, confirmed: form.confirmed,
          shares: shareRows.filter((r) => r.included).map((r) => ({ householdId: r.householdId, amount: r.amount ?? undefined })),
          paidByHouseholdId: form.paidByHouseholdId || undefined,
        });
      } else {
        Object.assign(common, {
          sharing: 'private', cost: form.cost ? Number(form.cost) : undefined, currency: form.currency || undefined,
          confirmation: form.confirmation || undefined, confirmed: form.confirmed,
        });
      }

      let payload: Record<string, unknown>;
      if (isJourney) {
        const start = zonedWallclockToUtc(form.depDate, form.depTime, form.departureTz || tz);
        const end = form.arrDate ? zonedWallclockToUtc(form.arrDate, form.arrTime, form.arrivalTz || tz) : undefined;
        const details: Record<string, unknown> = {};
        if (form.type === 'flight') {
          if (form.airline) details.airline = form.airline;
          if (form.flightNumber) details.flightNumber = form.flightNumber;
          if (form.seat) details.seat = form.seat;
        } else if (form.mode) details.mode = form.mode;
        if (form.depName) details.departureName = form.depName;
        if (form.departureTz) details.departureTz = form.departureTz;
        if (form.arrName) details.arrivalName = form.arrName;
        if (form.arrivalTz) details.arrivalTz = form.arrivalTz;
        payload = {
          type: form.type, title: form.title.trim(), start: start?.toISOString(), end: end ? end.toISOString() : undefined,
          location: form.depName || undefined, details: Object.keys(details).length ? details : undefined, ...common,
        };
      } else {
        const start = zonedWallclockToUtc(form.startDate, form.startTime, tz);
        const end = form.endDate ? zonedWallclockToUtc(form.endDate, form.endTime || '00:00', tz) : undefined;
        payload = {
          type: form.type, title: form.title.trim(), start: start?.toISOString(), end: end ? end.toISOString() : undefined,
          location: form.location || undefined, ...common,
        };
      }
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
    if (!form.title.trim()) return setError('Title is required');
    if (isJourney ? !form.depDate : !form.startDate) return setError('A date is required');
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

  const costLabel = PRIVATE_BILL.includes(form.sharing) && multiFamily ? 'Your cost' : 'Cost';

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

      {isJourney ? (
        <>
          <View style={styles.legCard}>
            <Text style={styles.legLabel}>DEPARTURE</Text>
            <PlacesAutocomplete
              label={form.type === 'flight' ? 'Departure airport' : 'Departure station / port'}
              value={form.depName}
              onChangeText={(v) => set({ depName: v })}
              type={form.type === 'flight' ? 'airport' : 'transit'}
              onSelect={(p) => placesApi.getTimezone(p.place_id).then((r) => set({ departureTz: r.data.timeZoneId || form.departureTz })).catch(() => {})}
            />
            <View style={styles.cols}>
              <View style={styles.col}><DateField label="Date" value={form.depDate} onChange={(v) => set({ depDate: v })} /></View>
              <View style={styles.col}><TimeField label="Time" value={form.depTime} onChange={(v) => set({ depTime: v })} /></View>
            </View>
            <Select label="Departure timezone" value={form.departureTz} options={TZ_OPTIONS.map((t) => ({ label: t || 'Use destination tz', value: t }))} onChange={(v) => set({ departureTz: (v as string) || '' })} />
          </View>
          <View style={styles.legCard}>
            <Text style={styles.legLabel}>ARRIVAL</Text>
            <PlacesAutocomplete
              label={form.type === 'flight' ? 'Arrival airport' : 'Arrival station / port'}
              value={form.arrName}
              onChangeText={(v) => set({ arrName: v })}
              type={form.type === 'flight' ? 'airport' : 'transit'}
              onSelect={(p) => placesApi.getTimezone(p.place_id).then((r) => set({ arrivalTz: r.data.timeZoneId || form.arrivalTz })).catch(() => {})}
            />
            <View style={styles.cols}>
              <View style={styles.col}><DateField label="Date" value={form.arrDate} onChange={(v) => set({ arrDate: v })} /></View>
              <View style={styles.col}><TimeField label="Time" value={form.arrTime} onChange={(v) => set({ arrTime: v })} /></View>
            </View>
            <Select label="Arrival timezone" value={form.arrivalTz} options={TZ_OPTIONS.map((t) => ({ label: t || 'Use destination tz', value: t }))} onChange={(v) => set({ arrivalTz: (v as string) || '' })} />
          </View>
          {form.type === 'flight' ? (
            <View style={styles.cols}>
              <View style={styles.col}><Input label="Airline" value={form.airline} onChangeText={(v) => set({ airline: v })} /></View>
              <View style={styles.col}><Input label="Flight #" value={form.flightNumber} onChangeText={(v) => set({ flightNumber: v })} /></View>
              <View style={styles.col}><Input label="Seat" value={form.seat} onChangeText={(v) => set({ seat: v })} /></View>
            </View>
          ) : (
            <Input label="Mode (train / bus / ferry / ship)" value={form.mode} onChangeText={(v) => set({ mode: v })} />
          )}
        </>
      ) : (
        <>
          <View style={styles.cols}>
            <View style={styles.col}><DateField label="Start date" value={form.startDate} onChange={(v) => set({ startDate: v })} /></View>
            <View style={styles.col}><TimeField label="Start time" clearable value={form.startTime} onChange={(v) => set({ startTime: v })} /></View>
          </View>
          <View style={styles.cols}>
            <View style={styles.col}><DateField label="End date" clearable value={form.endDate} onChange={(v) => set({ endDate: v })} /></View>
            <View style={styles.col}><TimeField label="End time" clearable value={form.endTime} onChange={(v) => set({ endTime: v })} /></View>
          </View>
          <PlacesAutocomplete label="Location" value={form.location} onChangeText={(v) => set({ location: v })} />
        </>
      )}

      <Divider />

      {multiFamily ? (
        <Select label="Sharing" value={form.sharing} options={SHARING_OPTIONS.map((o) => ({ label: o.label, value: o.value }))} onChange={(v) => toggleSharing((v as string) || 'private')} />
      ) : null}

      <View style={styles.cols}>
        <View style={styles.col}><Input label="Confirmation #" value={form.confirmation} onChangeText={(v) => set({ confirmation: v })} /></View>
        <View style={styles.col}><Input label={costLabel} keyboardType="decimal-pad" value={form.cost} onChangeText={(v) => set({ cost: v })} /></View>
        <View style={styles.col}>
          <Select label="Currency" value={form.currency} options={CURRENCIES.map((c) => ({ label: c, value: c }))} onChange={(v) => set({ currency: (v as string) || '' })} clearable />
        </View>
      </View>

      {multiFamily && form.sharing !== 'private' ? (
        <View style={styles.shareBox}>
          <View style={styles.shareHead}>
            <Text style={styles.shareTitle}>
              {form.sharing === 'shared_shared' ? "Families & each one's share" : 'Families sharing this booking'}
            </Text>
            {form.sharing === 'shared_shared' ? (
              <TouchableOpacity onPress={splitEqually}><Text style={styles.splitBtn}>Split equally</Text></TouchableOpacity>
            ) : null}
          </View>
          {shareRows.map((row) => (
            <View key={row.householdId} style={styles.shareRow}>
              <TouchableOpacity onPress={() => setShareRows((rows) => rows.map((r) => (r.householdId === row.householdId ? { ...r, included: !r.included } : r)))}>
                <Ionicons name={row.included ? 'checkbox' : 'square-outline'} size={22} color={row.included ? TRIP_PURPLE : colors.textMuted} />
              </TouchableOpacity>
              <Text style={styles.shareName}>{row.name}</Text>
              {form.sharing === 'shared_shared' ? (
                <View style={styles.shareAmt}>
                  <Input
                    value={row.amount != null ? String(row.amount) : ''}
                    onChangeText={(v) => setShareRows((rows) => rows.map((r) => (r.householdId === row.householdId ? { ...r, amount: v ? Number(v) : null } : r)))}
                    keyboardType="decimal-pad"
                    editable={row.included}
                  />
                </View>
              ) : null}
            </View>
          ))}
          {form.sharing === 'shared_shared' ? (
            <>
              <Text style={styles.shareSum}>Shares total {shareSum}{form.cost ? ` of ${form.cost}` : ''}</Text>
              <Select
                label="Paid by (fronted the bill)"
                value={form.paidByHouseholdId}
                options={includedFamilies.map((r) => ({ label: r.name, value: r.householdId }))}
                onChange={(v) => set({ paidByHouseholdId: (v as string) || '' })}
              />
            </>
          ) : null}
        </View>
      ) : null}

      <SwitchRow label={form.confirmed ? 'Booked' : 'Not booked yet'} value={form.confirmed} onValueChange={(v) => set({ confirmed: v })} />
      <Input label="URL (optional)" value={form.url} onChangeText={(v) => set({ url: v })} autoCapitalize="none" />
      <Input label="Phone (optional)" value={form.phone} onChangeText={(v) => set({ phone: v })} keyboardType="phone-pad" />
      <Input label="Notes" value={form.notes} onChangeText={(v) => set({ notes: v })} multiline />

      {tz ? <Text style={styles.tzNote}>Standard bookings are local to {tz}</Text> : null}
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
  legCard: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing.sm, marginBottom: spacing.sm },
  legLabel: { fontSize: 11, fontWeight: '700', letterSpacing: 0.5, color: colors.textMuted, marginBottom: spacing.sm },
  shareBox: { borderWidth: 1, borderColor: colors.border, borderRadius: 12, padding: spacing.md, marginBottom: spacing.md },
  shareHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  shareTitle: { fontSize: 13, fontWeight: '600', color: colors.text, flex: 1 },
  splitBtn: { color: TRIP_PURPLE, fontWeight: '600', fontSize: 13 },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
  shareName: { flex: 1, fontSize: 14, color: colors.text },
  shareAmt: { width: 110 },
  shareSum: { fontSize: 12, color: colors.textMuted, marginTop: 6, marginBottom: spacing.sm },
  tzNote: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm },
  error: { color: colors.error, marginVertical: spacing.sm },
  footer: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.xl, alignItems: 'center' },
});
