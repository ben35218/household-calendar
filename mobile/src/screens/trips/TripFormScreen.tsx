import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { tripsApi, placesApi, TripStatus, Trip, TripItem, FormAssistField } from '../../api';
import { sealNew, sealUpdate, openRecord, getHDK } from '../../lib/e2ee';

// Encrypted trip content (dates/color stay plaintext).
const TRIP_ENC = (p: Record<string, unknown>) => ({ name: p.name, destination: p.destination, notes: p.notes });
import { Button, Input, Select, Screen, SectionTitle, DateField, useHeaderCheckButton } from '../../components/ui';
import { form as fs, GroupCard, CardDivider } from '../../components/formStyles';
import FormAssist from '../../components/FormAssist';
import { useFormAssist } from '../../hooks/useFormAssist';
import PlacesAutocomplete from '../../components/PlacesAutocomplete';
import { TRIP_PURPLE } from '../../lib/tripTypes';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { TripsStackParamList } from '../../navigation/TripsNavigator';
import { classifyRecipient, composeShareSms } from '../../lib/shareInvite';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<TripsStackParamList, 'TripForm'>;
type Rt = RouteProp<TripsStackParamList, 'TripForm'>;

// An outside-share recipient, addressed by email or phone.
type ShareRecipient = { email?: string; phone?: string };
const shareKey = (r: ShareRecipient) => r.email || r.phone || '';
const shareLabel = (r: ShareRecipient) => r.email || r.phone || '';

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
  const [error, setError] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteError, setInviteError] = useState('');
  // Invites entered while creating a new trip (no id yet); applied on save.
  const [pendingEmails, setPendingEmails] = useState<ShareRecipient[]>([]);
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
  // Populate the form once from the first successful load. Sharing edits below
  // refetch this same query, and we must not clobber unsaved field edits.
  const populatedRef = useRef(false);
  useEffect(() => {
    if (!tripQ.data || populatedRef.current) return;
    let cancelled = false;
    (async () => {
    // GET /trips/:id returns { trip, items, isOwner }; older callers expect a flat trip.
    const data = tripQ.data as unknown as { trip?: Trip };
    const t = await openRecord('Trip', data.trip ?? (tripQ.data as Trip)); // decrypt content over plaintext
    if (cancelled || !t || !t.name) return;
    populatedRef.current = true;
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
        startDate: form.startDate || undefined,
        endDate: form.endDate || undefined,
      };
      if (isEdit) {
        const res = await tripsApi.update(id!, await sealUpdate('Trip', id!, payload, TRIP_ENC(payload)));
        return { id: res.data?._id as string | undefined, shareFailed: false };
      }
      const res = await tripsApi.create(await sealNew('Trip', payload, TRIP_ENC(payload)));
      // Apply any invites collected before the trip existed. The trip itself is
      // already saved, so we don't abort on failure (that would risk a duplicate
      // create on retry) — instead we flag it and surface it after navigating.
      const newId = res.data?._id as string | undefined;
      let shareFailed = false;
      if (newId && pendingEmails.length) {
        try {
          try {
            await tripsApi.setShareRecipients(newId, pendingEmails);
          } catch (e: any) {
            if (e?.response?.data?.error !== 'decrypt_required') throw e;
            // A brand-new trip has no items yet; payload holds the plaintext content.
            await tripsApi.setShareRecipients(newId, pendingEmails, { trip: payload, items: [] });
          }
        } catch {
          shareFailed = true;
        }
      }
      return { id: newId, shareFailed };
    },
    onSuccess: ({ id: newId, shareFailed }) => {
      qc.invalidateQueries({ queryKey: ['trips'] });
      if (!isEdit && newId) {
        navigation.replace('TripDetail', { id: newId });
        // The trip saved fine; only the invitations didn't go out. Say so
        // accurately and point the user to where they can resend them.
        if (shareFailed) {
          Alert.alert(
            'Trip saved — invitations not sent',
            "Your trip was created, but we couldn't send the invitations. Open “Share this trip” on the trip to try again.",
          );
        }
      } else {
        navigation.goBack();
      }
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
  const detail = tripQ.data as unknown as { trip?: Trip; items?: TripItem[]; isOwner?: boolean } | undefined;
  const isOwner = detail?.isOwner ?? true;

  // ── Sharing (owner-only) ──
  // Editing an existing trip shares live against the server; a new trip collects
  // invites locally (pendingRecipients) and applies them once it's created on
  // save. Each recipient is addressed by email or phone.
  const serverRecipients = (detail?.trip?.sharedWithOutside || []) as ShareRecipient[];
  const shareRecipients = isEdit ? serverRecipients : pendingEmails;
  const isShared = shareRecipients.length > 0 || (detail?.trip?.collaborators?.length ?? 0) > 0;

  // Set the full outside-share list. On an E2EE household the first recipient
  // flips the trip to plaintext (§9.3), so the server may ask for the decrypted
  // trip + items — we retry with them (requires the household key to be unlocked).
  const setEmails = useMutation({
    mutationFn: async (recipients: ShareRecipient[]) => {
      try {
        return (await tripsApi.setShareRecipients(id!, recipients)).data;
      } catch (e: any) {
        if (e?.response?.data?.error !== 'decrypt_required') throw e;
        if (!getHDK() || !detail?.trip) throw new Error('Unlock your account, then try sharing again.');
        const decTrip = await openRecord('Trip', detail.trip as any);
        const decItems = await Promise.all((detail.items || []).map((i) => openRecord('TripItem', i as any)));
        return (await tripsApi.setShareRecipients(id!, recipients, { trip: decTrip, items: decItems })).data;
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['trips', id] }),
    onError: (e: any) => setInviteError(e?.message || e?.response?.data?.error || 'Please try again.'),
  });

  // Text a phone recipient the invite from this device (no SMTP for phone).
  const textPhoneInvite = async (phone: string) => {
    try {
      await composeShareSms(phone, form.name ? `the trip “${form.name}”` : 'our trip');
    } catch (e: any) {
      setInviteError(e?.message || 'Saved, but the text couldn’t be started.');
    }
  };

  const addRecipient = async () => {
    const recipient = classifyRecipient(inviteEmail);
    if (!recipient) { setInviteError('Enter a valid email or phone number'); return; }
    if (shareRecipients.some((r) => shareKey(r) === shareKey(recipient))) {
      setInviteError('Already shared with that contact');
      return;
    }
    setInviteError('');
    setInviteEmail('');
    if (isEdit) {
      await setEmails.mutateAsync([...serverRecipients, recipient]);
      if ('phone' in recipient) await textPhoneInvite(recipient.phone);
    } else {
      setPendingEmails((es) => [...es, recipient]);
      // Pending invites are created on save; text the person now (the link is a
      // generic app link, so it's valid regardless of when the invite lands).
      if ('phone' in recipient) await textPhoneInvite(recipient.phone);
    }
  };

  const removeEmail = (r: ShareRecipient) => {
    const key = shareKey(r);
    if (isEdit) setEmails.mutate(serverRecipients.filter((e) => shareKey(e) !== key));
    else setPendingEmails((es) => es.filter((e) => shareKey(e) !== key));
  };

  const stopSharing = () => {
    Alert.alert('Stop sharing?', 'Everyone you invited will lose access to this trip.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Stop sharing',
        style: 'destructive',
        onPress: () => { tripsApi.unshare(id!).then(() => qc.invalidateQueries({ queryKey: ['trips', id] })); },
      },
    ]);
  };

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
        placeholder={'Describe the trip, e.g. "10-day trip to Rome in May, booked"'}
        fields={ASSIST_FIELDS}
        current={{ ...form }}
        onApply={applyPatch}
      />

      <GroupCard>
        <Input
          value={form.name}
          onChangeText={(v) => set({ name: v })}
          placeholder="Trip Name"
          containerStyle={fs.headField}
          style={[fs.headInput, assist.changed.has('name') && fs.headInputHighlight]}
        />
        <CardDivider />
        <PlacesAutocomplete
          type="city"
          value={form.destination}
          onChangeText={(v) => set({ destination: v })}
          onSelect={(p) => placesApi.getTimezone(p.place_id).then((r) => r.data.timeZoneId && set({ destinationTz: r.data.timeZoneId })).catch(() => {})}
          placeholder="Destination"
          containerStyle={fs.headField}
          inputStyle={[fs.headInput, assist.changed.has('destination') && fs.headInputHighlight]}
        />
        <CardDivider />
        <View style={fs.dtRow}>
          <Text style={fs.dtLabel}>Starts</Text>
          <View style={fs.dtFields}>
            <DateField
              clearable
              placeholder="None"
              value={form.startDate}
              onChange={(v) => set({ startDate: v })}
              highlight={assist.changed.has('startDate')}
              containerStyle={fs.dtFieldWrap}
              fieldStyle={fs.dtField}
              valueStyle={fs.dtValue}
              hideIcon
            />
          </View>
        </View>
        <CardDivider />
        <View style={fs.dtRow}>
          <Text style={fs.dtLabel}>Ends</Text>
          <View style={fs.dtFields}>
            <DateField
              clearable
              placeholder="None"
              value={form.endDate}
              onChange={(v) => set({ endDate: v })}
              highlight={assist.changed.has('endDate')}
              containerStyle={fs.dtFieldWrap}
              fieldStyle={fs.dtField}
              valueStyle={fs.dtValue}
              hideIcon
            />
          </View>
        </View>
      </GroupCard>

      <GroupCard>
        <Select
          inlineLabel="Status"
          value={form.status}
          options={STATUS_OPTIONS}
          onChange={(v) => set({ status: (v as TripStatus) ?? 'considering' })}
          highlight={assist.changed.has('status')}
          containerStyle={fs.dtFieldWrap}
          fieldStyle={fs.rowField}
          valueStyle={fs.dtValue}
          chevronIcon="chevron-expand"
        />
      </GroupCard>

      {isOwner ? (
        <>
          <SectionTitle>Share this trip</SectionTitle>
          <GroupCard style={styles.shareCard}>
            <View style={styles.emailAddRow}>
              <Input
                placeholder="Add email or phone…"
                value={inviteEmail}
                onChangeText={(v) => { setInviteEmail(v); setInviteError(''); }}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                returnKeyType="send"
                onSubmitEditing={addRecipient}
                containerStyle={styles.emailInput}
                style={styles.emailInputField}
              />
              {setEmails.isPending ? (
                <ActivityIndicator size="small" color={accent} style={styles.emailAddIcon} />
              ) : (
                <TouchableOpacity
                  onPress={addRecipient}
                  disabled={!inviteEmail.trim()}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                  style={styles.emailAddIcon}
                >
                  <Ionicons name="add-circle" size={28} color={inviteEmail.trim() ? accent : colors.border} />
                </TouchableOpacity>
              )}
            </View>
            {inviteError ? <Text style={styles.inviteErr}>{inviteError}</Text> : null}
            {shareRecipients.length > 0 ? (
              <View style={styles.shareList}>
                {shareRecipients.map((r) => {
                  const label = shareLabel(r);
                  const collab = r.email
                    ? (detail?.trip?.collaborators || []).find((c) => c.email?.toLowerCase() === r.email)
                    : undefined;
                  const who = collab ? ([collab.firstName, collab.lastName].filter(Boolean).join(' ') || label) : label;
                  return (
                    <View key={shareKey(r)} style={styles.shareRow}>
                      <View style={styles.shareRowInfo}>
                        <Text style={styles.shareRowName} numberOfLines={1}>{who}</Text>
                        <Text style={styles.shareRowStatus}>{collab ? 'Joined' : 'Invited'}</Text>
                      </View>
                      <TouchableOpacity onPress={() => removeEmail(r)} hitSlop={8}>
                        <Ionicons name="close-circle-outline" size={22} color={colors.error} />
                      </TouchableOpacity>
                    </View>
                  );
                })}
              </View>
            ) : null}
          </GroupCard>
          {isEdit && isShared ? (
            <TouchableOpacity style={styles.shareStopBtn} onPress={stopSharing}>
              <Text style={styles.shareStopText}>Stop sharing</Text>
            </TouchableOpacity>
          ) : null}
        </>
      ) : null}

      <SectionTitle>Color</SectionTitle>
      <GroupCard style={styles.swatchCard}>
        <View style={styles.swatchRow}>
          {COLORS.map((c) => (
            <TouchableOpacity
              key={c}
              style={[styles.swatch, { backgroundColor: c }, form.color === c && styles.swatchActive]}
              onPress={() => set({ color: c })}
            />
          ))}
        </View>
      </GroupCard>

      <SectionTitle>Notes</SectionTitle>
      <Input
        value={form.notes}
        onChangeText={(v) => set({ notes: v })}
        multiline
        placeholder="Add any notes…"
        style={fs.notes}
        highlight={assist.changed.has('notes')}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isEdit ? (
        <View style={fs.footer}>
          {isOwner ? (
            <Button title="Delete Trip" variant="danger" loading={del.isPending} onPress={onDelete} />
          ) : (
            <Button title="Leave this shared trip" variant="danger" loading={leave.isPending} onPress={onLeave} />
          )}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  swatchCard: { padding: 14 },
  swatchRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  swatch: { width: 36, height: 36, borderRadius: 18 },
  swatchActive: { borderWidth: 3, borderColor: colors.text },
  error: { color: colors.error, marginVertical: spacing.sm },
  shareCard: { padding: 14, gap: spacing.sm },
  emailAddRow: { position: 'relative', justifyContent: 'center' },
  emailInput: { marginBottom: 0 },
  emailInputField: { paddingRight: 46 },
  emailAddIcon: { position: 'absolute', right: 10, alignItems: 'center', justifyContent: 'center' },
  inviteErr: { color: colors.error, fontSize: 13, marginTop: 4 },
  shareList: { marginTop: spacing.xs, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  shareRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 10, gap: spacing.sm },
  shareRowInfo: { flex: 1 },
  shareRowName: { fontSize: 15, fontWeight: '600', color: colors.text },
  shareRowStatus: { fontSize: 12, color: colors.textMuted, marginTop: 1 },
  shareStopBtn: { alignItems: 'center', paddingVertical: spacing.md, marginTop: 4 },
  shareStopText: { color: '#C62828', fontSize: 15, fontWeight: '600' },
});
