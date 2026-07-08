import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert, Linking, Share } from 'react-native';
import { cacheDirectory, downloadAsync } from 'expo-file-system/legacy';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { tripsApi, placesApi, TripItemType, TripItemAttachment, FormAssistField } from '../../api';
import { sealNew, sealUpdate, openRecord, getHDK, newObjectId } from '../../lib/e2ee';
import { encryptFileForUpload, decryptDownloadedFile } from '../../lib/attachments';
import { pickDocument } from '../../lib/media';
import { uploadFile } from '../../lib/upload';
import { API_URL } from '../../config';
import { getCachedToken } from '../../lib/secureToken';

// Encrypted trip-item content (cost/sharing/confirmation/dates stay plaintext).
const TRIP_ITEM_ENC = (p: Record<string, unknown>) => ({
  title: p.title, location: p.location, url: p.url, phone: p.phone, notes: p.notes, details: p.details,
});
import { Button, Input, Screen, SwitchRow, SectionTitle, DateField, TimeField, Select, Divider, useHeaderCheckButton } from '../../components/ui';
import FormAssist from '../../components/FormAssist';
import { useFormAssist } from '../../hooks/useFormAssist';
import PlacesAutocomplete from '../../components/PlacesAutocomplete';
import { TRIP_TYPES, tripTypeMeta } from '../../lib/tripTypes';
import { useCalendarColors } from '../../lib/calendarPrefs';
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

const DURATION_OPTIONS = [
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '45 minutes', value: 45 },
  { label: '1 hour', value: 60 },
  { label: '1.5 hours', value: 90 },
  { label: '2 hours', value: 120 },
  { label: '2.5 hours', value: 150 },
  { label: '3 hours', value: 180 },
  { label: '4 hours', value: 240 },
  { label: '6 hours', value: 360 },
  { label: '8 hours', value: 480 },
];

// Schema the AI form assistant fills. Names match the form-state keys; the model
// picks the relevant subset based on the booking type in the request.
const ASSIST_FIELDS: FormAssistField[] = [
  { name: 'type', type: 'select', label: 'Booking type', options: TRIP_TYPES.map((t) => ({ label: t.label, value: t.value })) },
  { name: 'title', type: 'text', label: 'Title' },
  { name: 'startDate', type: 'date', label: 'Start date' },
  { name: 'startTime', type: 'time', label: 'Start time' },
  { name: 'endDate', type: 'date', label: 'End date' },
  { name: 'endTime', type: 'time', label: 'End time' },
  { name: 'location', type: 'text', label: 'Location / address' },
  { name: 'depName', type: 'text', label: 'Departure airport / station' },
  { name: 'depDate', type: 'date', label: 'Departure date' },
  { name: 'depTime', type: 'time', label: 'Departure time' },
  { name: 'arrName', type: 'text', label: 'Arrival airport / station' },
  { name: 'arrDate', type: 'date', label: 'Arrival date' },
  { name: 'arrTime', type: 'time', label: 'Arrival time' },
  { name: 'airline', type: 'text', label: 'Airline' },
  { name: 'flightNumber', type: 'text', label: 'Flight number' },
  { name: 'seat', type: 'text', label: 'Seat' },
  { name: 'mode', type: 'text', label: 'Transit mode (train / bus / ferry)' },
  { name: 'cost', type: 'number', label: 'Cost' },
  { name: 'currency', type: 'select', label: 'Currency', options: CURRENCIES.map((c) => ({ label: c, value: c })) },
  { name: 'confirmation', type: 'text', label: 'Confirmation number' },
  { name: 'confirmed', type: 'boolean', label: 'Booked / confirmed' },
  { name: 'url', type: 'text', label: 'URL' },
  { name: 'phone', type: 'text', label: 'Phone' },
  { name: 'notes', type: 'text', label: 'Notes' },
];

function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function timeDiffMinutes(start: string, end: string): number | null {
  if (!start || !end) return null;
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  const diff = (eh * 60 + em) - (sh * 60 + sm);
  return diff > 0 ? diff : null;
}

type ShareRow = { householdId: string; name: string; included: boolean; amount: number | null };

// Faithful port of client/src/views/TripItemFormView.vue: standard + journey
// (dual-timezone) bookings and the multi-family cost-sharing modes. (Place
// autocomplete + timezone auto-fill are wired in the cross-cutting Places wave;
// here the leg timezone is chosen explicitly.)
export default function TripItemFormScreen() {
  const navigation = useNavigation<Nav>();
  const accent = useCalendarColors().colors.vacations;
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
  const [endMode, setEndMode] = useState<'time' | 'duration'>('time');
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
      const val = k === 'cost' ? (v == null ? '' : String(v)) : v == null ? '' : v;
      if ((form as any)[k] !== val) changedKeys.push(k);
      (next as any)[k] = val;
    }
    setForm((f) => ({ ...f, ...next }));
    assist.mark(changedKeys);
  };

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
    const found = tripQ.data.items?.find((x) => x._id === itemId);
    if (!found) return;
    let cancelled = false;
    (async () => {
    const it = await openRecord('TripItem', found); // decrypt content over plaintext
    if (cancelled) return;
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
    const existing = it.shares ?? (it.participants ?? []).map((hid: string) => ({ householdId: hid, amount: null }));
    if (existing.length) buildShareRows(existing);
    })();
    return () => { cancelled = true; };
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
    mutationFn: async () => {
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
      return isEdit
        ? tripsApi.updateItem(tripId, itemId!, await sealUpdate('TripItem', itemId!, payload, TRIP_ITEM_ENC(payload)))
        : tripsApi.addItem(tripId, await sealNew('TripItem', payload, TRIP_ITEM_ENC(payload)));
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

  // ── Attachments (confirmation files; E2EE on private bookings) ─────────────
  // GET /trips/:id responds { trip, items, isOwner }; the mobile Trip type
  // flattens this, so reach into the raw payload for both.
  const rawTrip = (tripQ.data as any)?.trip;
  const rawItem = isEdit ? (tripQ.data as any)?.items?.find((x: any) => x._id === itemId) : undefined;
  const tripShared = !!(rawTrip?.shareCode || (rawTrip?.collaborators?.length ?? 0) > 0);
  const attachments: TripItemAttachment[] = rawItem?.attachments ?? [];
  const attachmentsUrl = `/trips/${tripId}/items/${itemId}/attachments`;

  const addAttachment = useMutation({
    mutationFn: async () => {
      const file = await pickDocument();
      if (!file) return null;
      // E2EE (Phase 4c): private booking on an unshared trip + unlocked HDK →
      // encrypt the bytes on-device and upload ciphertext + the wrapped file
      // key. Shared bookings stay plaintext so other families can open them
      // (the server refuses encrypted uploads there, §9.3).
      if (getHDK() && !tripShared && form.sharing === 'private') {
        const attId = await newObjectId();
        const sealed = await encryptFileForUpload('TripItemAttachment', attId, file.uri);
        if (sealed) {
          return uploadFile(attachmentsUrl, { uri: sealed.uri, name: `${attId}.bin`, type: 'application/octet-stream' }, 'file', {
            encrypted: true,
            _id: attId,
            wrappedFileKey: sealed.wrappedFileKey,
            keyVersion: sealed.keyVersion,
            fileType: file.type || 'application/pdf',
            title: file.name,
          });
        }
      }
      return uploadFile(attachmentsUrl, file, 'file');
    },
    onSuccess: (r) => { if (r) qc.invalidateQueries({ queryKey: ['trips', tripId] }); },
    onError: (e: any) => Alert.alert('Upload failed', e.response?.data?.error || 'Could not upload that file.'),
  });

  // Open: encrypted attachments download as ciphertext, decrypt on-device to a
  // temp file, and share/open; plaintext ones open via the tokened URL.
  const openAttachment = useMutation({
    mutationFn: async (att: TripItemAttachment) => {
      const url = `${API_URL}${attachmentsUrl}/${att._id}/download`;
      if (!att.encrypted) { await Linking.openURL(`${url}?token=${getCachedToken()}`); return; }
      if (!getHDK() || !att.wrappedFileKey) throw new Error('Unlock your account to open this encrypted attachment.');
      const dl = await downloadAsync(url, `${cacheDirectory}dl-att-${att._id}.bin`, {
        headers: { Authorization: `Bearer ${getCachedToken()}` },
      });
      const name = att.filename && att.filename.includes('.')
        ? att.filename
        : `attachment${(att.fileType || '').includes('pdf') ? '.pdf' : ''}`;
      const plainUri = await decryptDownloadedFile('TripItemAttachment', att._id, att.keyVersion, att.wrappedFileKey, dl.uri, name);
      if (!plainUri) throw new Error('Could not decrypt this attachment.');
      await Share.share({ url: plainUri });
    },
    onError: (e: any) => Alert.alert('Could not open attachment', e?.message || 'Please try again.'),
  });

  const deleteAttachment = useMutation({
    mutationFn: (attId: string) => tripsApi.removeAttachment(tripId, itemId!, attId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trips', tripId] }),
    onError: (e: any) => Alert.alert('Could not remove attachment', e.response?.data?.error || 'Please try again.'),
  });

  const onSave = () => {
    if (!form.title.trim()) return setError('Title is required');
    if (isJourney ? !form.depDate : !form.startDate) return setError('A date is required');
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

  const costLabel = PRIVATE_BILL.includes(form.sharing) && multiFamily ? 'Your cost' : 'Cost';

  return (
    <Screen>
      <FormAssist
        formType="trip booking"
        title="Booking Assistant"
        placeholder={'Describe the booking, e.g. "flight AC123 to Paris June 5 at 6pm, seat 14C, $650 confirmed"'}
        fields={ASSIST_FIELDS}
        current={{ ...form }}
        onApply={applyPatch}
      />

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

      <Input label="Title *" value={form.title} onChangeText={(v) => set({ title: v })} placeholder={tripTypeMeta(form.type).label} highlight={assist.changed.has('title')} />

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
              highlight={assist.changed.has('depName')}
            />
            <View style={styles.cols}>
              <View style={styles.col}><DateField label="Date" value={form.depDate} onChange={(v) => set({ depDate: v })} highlight={assist.changed.has('depDate')} /></View>
              <View style={styles.col}><TimeField label="Time" value={form.depTime} onChange={(v) => set({ depTime: v })} highlight={assist.changed.has('depTime')} /></View>
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
              highlight={assist.changed.has('arrName')}
            />
            <View style={styles.cols}>
              <View style={styles.col}><DateField label="Date" value={form.arrDate} onChange={(v) => set({ arrDate: v })} highlight={assist.changed.has('arrDate')} /></View>
              <View style={styles.col}><TimeField label="Time" value={form.arrTime} onChange={(v) => set({ arrTime: v })} highlight={assist.changed.has('arrTime')} /></View>
            </View>
            <Select label="Arrival timezone" value={form.arrivalTz} options={TZ_OPTIONS.map((t) => ({ label: t || 'Use destination tz', value: t }))} onChange={(v) => set({ arrivalTz: (v as string) || '' })} />
          </View>
          {form.type === 'flight' ? (
            <View style={styles.cols}>
              <View style={styles.col}><Input label="Airline" value={form.airline} onChangeText={(v) => set({ airline: v })} highlight={assist.changed.has('airline')} /></View>
              <View style={styles.col}><Input label="Flight #" value={form.flightNumber} onChangeText={(v) => set({ flightNumber: v })} highlight={assist.changed.has('flightNumber')} /></View>
              <View style={styles.col}><Input label="Seat" value={form.seat} onChangeText={(v) => set({ seat: v })} highlight={assist.changed.has('seat')} /></View>
            </View>
          ) : (
            <Input label="Mode (train / bus / ferry / ship)" value={form.mode} onChangeText={(v) => set({ mode: v })} highlight={assist.changed.has('mode')} />
          )}
        </>
      ) : (
        <>
          <View style={styles.cols}>
            <View style={styles.col}><DateField label="Start date" value={form.startDate} onChange={(v) => set({ startDate: v })} highlight={assist.changed.has('startDate')} /></View>
            <View style={styles.col}><TimeField label="Start time" clearable value={form.startTime} onChange={(v) => set({ startTime: v })} highlight={assist.changed.has('startTime')} /></View>
          </View>
          {endMode === 'time' ? (
            <View style={styles.cols}>
              <View style={styles.col}>
                <DateField label="End date" clearable value={form.endDate} onChange={(v) => set({ endDate: v })} defaultValue={form.startDate} highlight={assist.changed.has('endDate')} />
              </View>
              <View style={styles.col}>
                <TimeField
                  label="End time"
                  clearable
                  value={form.endTime}
                  onChange={(v) => set({ endTime: v })}
                  defaultValue={addMinutesToTime(form.startTime || '09:00', 60)}
                  highlight={assist.changed.has('endTime')}
                />
              </View>
            </View>
          ) : (
            <Select<number>
              label="Duration"
              value={timeDiffMinutes(form.startTime, form.endTime) ?? undefined}
              options={DURATION_OPTIONS}
              clearable
              onChange={(v) => {
                if (v == null) { set({ endDate: '', endTime: '' }); return; }
                set({ endDate: form.startDate, endTime: addMinutesToTime(form.startTime || '09:00', v) });
              }}
            />
          )}
          <View style={styles.endModeToggle}>
            <TouchableOpacity
              style={[styles.endModeBtn, endMode === 'time' && styles.endModeBtnActive]}
              onPress={() => setEndMode('time')}
            >
              <Text style={[styles.endModeBtnText, endMode === 'time' && styles.endModeBtnTextActive]}>End time</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.endModeBtn, endMode === 'duration' && styles.endModeBtnActive]}
              onPress={() => setEndMode('duration')}
            >
              <Text style={[styles.endModeBtnText, endMode === 'duration' && styles.endModeBtnTextActive]}>Duration</Text>
            </TouchableOpacity>
          </View>
          <PlacesAutocomplete label="Location" value={form.location} onChangeText={(v) => set({ location: v })} highlight={assist.changed.has('location')} />
        </>
      )}

      <Divider />

      {multiFamily ? (
        <Select label="Sharing" value={form.sharing} options={SHARING_OPTIONS.map((o) => ({ label: o.label, value: o.value }))} onChange={(v) => toggleSharing((v as string) || 'private')} />
      ) : null}

      <View style={styles.cols}>
        <View style={styles.col}><Input label="Confirmation #" value={form.confirmation} onChangeText={(v) => set({ confirmation: v })} highlight={assist.changed.has('confirmation')} /></View>
        <View style={styles.col}><Input label={costLabel} keyboardType="decimal-pad" value={form.cost} onChangeText={(v) => set({ cost: v })} highlight={assist.changed.has('cost')} /></View>
        <View style={styles.col}>
          <Select label="Currency" value={form.currency} options={CURRENCIES.map((c) => ({ label: c, value: c }))} onChange={(v) => set({ currency: (v as string) || '' })} clearable highlight={assist.changed.has('currency')} />
        </View>
      </View>

      {multiFamily && form.sharing !== 'private' ? (
        <View style={styles.shareBox}>
          <View style={styles.shareHead}>
            <Text style={styles.shareTitle}>
              {form.sharing === 'shared_shared' ? "Families & each one's share" : 'Families sharing this booking'}
            </Text>
            {form.sharing === 'shared_shared' ? (
              <TouchableOpacity onPress={splitEqually}><Text style={[styles.splitBtn, { color: accent }]}>Split equally</Text></TouchableOpacity>
            ) : null}
          </View>
          {shareRows.map((row) => (
            <View key={row.householdId} style={styles.shareRow}>
              <TouchableOpacity onPress={() => setShareRows((rows) => rows.map((r) => (r.householdId === row.householdId ? { ...r, included: !r.included } : r)))}>
                <Ionicons name={row.included ? 'checkbox' : 'square-outline'} size={22} color={row.included ? accent : colors.textMuted} />
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

      <SwitchRow label={form.confirmed ? 'Booked' : 'Not booked yet'} value={form.confirmed} onValueChange={(v) => set({ confirmed: v })} highlight={assist.changed.has('confirmed')} />
      <Input label="URL (optional)" value={form.url} onChangeText={(v) => set({ url: v })} autoCapitalize="none" highlight={assist.changed.has('url')} />
      <Input label="Phone (optional)" value={form.phone} onChangeText={(v) => set({ phone: v })} keyboardType="phone-pad" highlight={assist.changed.has('phone')} />
      <Input label="Notes" value={form.notes} onChangeText={(v) => set({ notes: v })} multiline highlight={assist.changed.has('notes')} />

      {tz ? <Text style={styles.tzNote}>Standard bookings are local to {tz}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isEdit ? (
        <>
          <SectionTitle>Attachments</SectionTitle>
          {attachments.map((att) => (
            <View key={att._id} style={styles.attachRow}>
              <TouchableOpacity
                style={styles.attachMain}
                onPress={() => openAttachment.mutate(att)}
                disabled={openAttachment.isPending}
              >
                <Ionicons
                  name={(att.fileType || '').startsWith('image/') ? 'image-outline' : 'document-outline'}
                  size={18}
                  color={accent}
                />
                <Text style={styles.attachName} numberOfLines={1}>{att.filename || 'Attachment'}</Text>
                {att.encrypted ? <Ionicons name="lock-closed" size={13} color={colors.textMuted} /> : null}
              </TouchableOpacity>
              <TouchableOpacity
                onPress={() =>
                  Alert.alert('Remove attachment?', '', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Remove', style: 'destructive', onPress: () => deleteAttachment.mutate(att._id) },
                  ])
                }
              >
                <Ionicons name="trash-outline" size={18} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          ))}
          <Button
            title={addAttachment.isPending ? 'Uploading…' : 'Attach confirmation (PDF or image)'}
            variant="ghost"
            color={accent}
            onPress={() => addAttachment.mutate()}
            disabled={addAttachment.isPending}
          />
        </>
      ) : null}

      {isEdit ? (
        <View style={styles.footer}>
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
        </View>
      ) : null}
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
  splitBtn: { fontWeight: '600', fontSize: 13 },
  shareRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 4 },
  shareName: { flex: 1, fontSize: 14, color: colors.text },
  shareAmt: { width: 110 },
  shareSum: { fontSize: 12, color: colors.textMuted, marginTop: 6, marginBottom: spacing.sm },
  tzNote: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm },
  attachRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8 },
  attachMain: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  attachName: { flex: 1, fontSize: 14, color: colors.text },
  error: { color: colors.error, marginVertical: spacing.sm },
  footer: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.xl, alignItems: 'center' },
  endModeToggle: { flexDirection: 'row', backgroundColor: '#2A2A2A', borderRadius: 8, padding: 2, marginBottom: spacing.sm },
  endModeBtn: { flex: 1, paddingVertical: 6, alignItems: 'center', borderRadius: 6 },
  endModeBtnActive: { backgroundColor: colors.primary },
  endModeBtnText: { fontSize: 13, color: colors.textMuted },
  endModeBtnTextActive: { color: '#fff', fontWeight: '600' as const },
});
