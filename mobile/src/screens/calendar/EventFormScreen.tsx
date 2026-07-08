import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { calendarApi, invitationsApi, placesApi, settingsApi, FormAssistField } from '../../api';
import { Button, Input, Select, Screen, SwitchRow, SectionTitle, DateField, TimeField, useHeaderCheckButton } from '../../components/ui';
import FormAssist from '../../components/FormAssist';
import { useFormAssist } from '../../hooks/useFormAssist';
import PlacesAutocomplete from '../../components/PlacesAutocomplete';
import { EVENT_CALENDAR_TYPES, ymd } from '../../lib/calendar';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { sealNew, sealUpdate, openRecord } from '../../lib/e2ee';
import { getQueuedInvitees, clearQueuedInvitees, useQueuedInvitees } from '../../lib/inviteeDraft';
import { CalendarStackParamList } from '../../navigation/CalendarNavigator';
import { colors, spacing, radius } from '../../theme';

type Nav = NativeStackNavigationProp<CalendarStackParamList, 'EventForm'>;
type Rt = RouteProp<CalendarStackParamList, 'EventForm'>;

const ALERT_OPTIONS = [
  { label: 'No alert', value: -1 },
  { label: 'At time of event', value: 0 },
  { label: '15 min before', value: 15 },
  { label: '30 min before', value: 30 },
  { label: '1 hour before', value: 60 },
  { label: '1 day before', value: 1440 },
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

// "90" -> "1 hr 30 min", "60" -> "1 hr", "45" -> "45 min".
function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h} hr`);
  if (m) parts.push(`${m} min`);
  return parts.join(' ');
}

// "a@x.com, b@y.com +2 more" — the Invitees card's one-line preview.
function inviteePreview(emails: string[]): string {
  if (!emails.length) return 'No one invited yet';
  const shown = emails.slice(0, 2).join(', ');
  return emails.length > 2 ? `${shown} +${emails.length - 2} more` : shown;
}

const REPEAT_OPTIONS = [
  { label: 'Does not repeat', value: '' },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Yearly', value: 'yearly' },
];

// Schema the AI form assistant fills. Names match the form-state keys.
const ASSIST_FIELDS: FormAssistField[] = [
  { name: 'title', type: 'text', label: 'Title' },
  { name: 'calendarType', type: 'select', label: 'Calendar', options: EVENT_CALENDAR_TYPES },
  { name: 'date', type: 'date', label: 'Start date' },
  { name: 'endDate', type: 'date', label: 'End date', description: 'Only for multi-day events on a different day than the start' },
  { name: 'allDay', type: 'boolean', label: 'All day', description: 'True for all-day events. Set false when a specific time is given.' },
  { name: 'startTime', type: 'time', label: 'Start time' },
  { name: 'endTime', type: 'time', label: 'End time' },
  { name: 'location', type: 'text', label: 'Location / address' },
  { name: 'phone', type: 'text', label: 'Phone number' },
  { name: 'description', type: 'text', label: 'Notes' },
  { name: 'reminderMinutes', type: 'select', label: 'Alert before event', options: ALERT_OPTIONS },
  {
    name: 'leaveTimeAlert',
    type: 'boolean',
    label: 'Alert when it is time to leave',
    description:
      'Set true when the user wants the alert timed to when they should leave (based on drive time to the location), instead of a fixed number of minutes before the event. When true, do not also set reminderMinutes.',
  },
  { name: 'recurrFreq', type: 'select', label: 'Repeat', options: REPEAT_OPTIONS },
];

export default function EventFormScreen() {
  const navigation = useNavigation<Nav>();
  const { eventId, date, prefill } = useRoute<Rt>().params || {};
  const isEdit = !!eventId;
  const qc = useQueryClient();
  // The save check is tinted with the selected calendar's colour (respects
  // user overrides).
  const cal = useCalendarColors().colors;

  const [form, setForm] = useState({
    title: '',
    calendarType: 'activities',
    date: date || ymd(new Date()),
    endDate: '',
    allDay: true,
    startTime: '09:00',
    endTime: '10:00',
    description: '',
    location: '',
    phone: '',
    fromAddress: '',
    travelMinutes: null as number | null,
    travelDistanceKm: null as string | null,
    reminderMinutes: null as number | null,
    alert2Minutes: null as number | null,
    recurrFreq: '',
  });
  const [error, setError] = useState('');
  const [travelLoading, setTravelLoading] = useState(false);
  const [travelError, setTravelError] = useState('');
  // Set when the assistant asked for a "time to leave" alert before the drive
  // time was known; resolved to reminderMinutes once travel time computes.
  const [pendingLeaveAlert, setPendingLeaveAlert] = useState(false);
  const assist = useFormAssist();

  // Manual edits clear the "AI changed this" highlight for the touched fields.
  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    assist.clear(Object.keys(patch));
  };

  // Merge an AI patch into the form and mark the fields that actually changed.
  const applyPatch = (patch: Record<string, unknown>) => {
    const next: Partial<typeof form> = {};
    const changedKeys: string[] = [];
    // Intent flag — resolved to a concrete reminderMinutes below/asynchronously.
    const wantsLeaveAlert = patch.leaveTimeAlert === true;
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in form)) continue; // skips non-form keys like leaveTimeAlert
      const val = k === 'reminderMinutes' && v === -1 ? null : v;
      if ((form as any)[k] !== val) changedKeys.push(k);
      (next as any)[k] = val;
    }
    // If the assistant set a start time on a timed event but gave no end time,
    // default the end to 30 minutes later (otherwise it keeps the stale default).
    const effectiveAllDay = 'allDay' in next ? next.allDay : form.allDay;
    if (!effectiveAllDay && typeof next.startTime === 'string' && next.startTime && patch.endTime == null) {
      const defaultEnd = addMinutesToTime(next.startTime, 30);
      if (form.endTime !== defaultEnd) changedKeys.push('endTime');
      next.endTime = defaultEnd;
    }

    // A leave-time alert takes precedence over any fixed reminder. Apply it now
    // if the drive time is already known; otherwise defer until it computes.
    if (wantsLeaveAlert) {
      if (form.travelMinutes && !form.allDay) {
        next.reminderMinutes = form.travelMinutes;
        if (!changedKeys.includes('reminderMinutes')) changedKeys.push('reminderMinutes');
        setPendingLeaveAlert(false);
      } else {
        setPendingLeaveAlert(true);
      }
    }
    setForm((f) => ({ ...f, ...next }));
    assist.mark(changedKeys);
  };

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit Event' : 'New Event' });
  }, [navigation, isEdit]);

  // Pre-fill a new event from the calendar assistant's draft ("Edit in form").
  // Uses the same patch path as FormAssist so the filled fields get highlighted.
  const prefilled = useRef(false);
  useEffect(() => {
    if (isEdit || prefilled.current || !prefill) return;
    prefilled.current = true;
    applyPatch(prefill);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill, isEdit]);

  // Default the "From" origin to the household home address once settings load.
  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: async () => (await settingsApi.get()).data });
  useEffect(() => {
    const home = settingsQ.data?.homeAddress;
    if (home) setForm((f) => (f.fromAddress ? f : { ...f, fromAddress: home }));
  }, [settingsQ.data]);

  // Compute traffic-aware drive time from the origin to the event location.
  const fetchTravelTime = async () => {
    const destination = form.location?.trim();
    const origin = form.fromAddress?.trim();
    if (!destination) return;
    setForm((f) => ({ ...f, travelMinutes: null, travelDistanceKm: null }));
    setTravelError('');
    setTravelLoading(true);
    try {
      const { data } = await placesApi.getTravelTime(destination, origin);
      const d = data as { minutes?: number; distanceKm?: string };
      setForm((f) => ({ ...f, travelMinutes: d.minutes ?? null, travelDistanceKm: d.distanceKm ?? null }));
    } catch (e: any) {
      setTravelError(e.response?.data?.error || "Couldn't calculate drive time");
    } finally {
      setTravelLoading(false);
    }
  };

  // Recompute (debounced) whenever the location or starting point changes.
  useEffect(() => {
    if (!form.location.trim()) return;
    const t = setTimeout(fetchTravelTime, 700);
    return () => clearTimeout(t);
  }, [form.location, form.fromAddress]);

  // The assistant may ask for a "time to leave" alert before the drive time is
  // known; apply it as soon as travel time computes (on a timed event).
  useEffect(() => {
    if (!pendingLeaveAlert || form.allDay || !form.travelMinutes) return;
    setForm((f) => ({ ...f, reminderMinutes: f.travelMinutes }));
    assist.add(['reminderMinutes']);
    setPendingLeaveAlert(false);
  }, [pendingLeaveAlert, form.travelMinutes, form.allDay]);

  // The clock time the user needs to leave by = start time − drive time.
  const leaveByTime = useMemo(() => {
    const { travelMinutes, allDay, startTime } = form;
    if (!travelMinutes || allDay || !startTime) return null;
    const [h, m] = startTime.split(':').map(Number);
    const total = h * 60 + m - travelMinutes;
    if (total < 0) return null;
    const lh = Math.floor(total / 60);
    const lm = total % 60;
    const ampm = lh >= 12 ? 'PM' : 'AM';
    return `${lh % 12 || 12}:${String(lm).padStart(2, '0')} ${ampm}`;
  }, [form.travelMinutes, form.allDay, form.startTime]);

  // Alert options. When a drive time is available on a timed event, prepend a
  // set of departure-relative choices so the user can be alerted when it's time
  // to leave — or a chosen number of minutes before that. `reminderMinutes` is
  // stored as "minutes before the event", so leaving early = travelMinutes + buffer.
  const alertItems = useMemo(() => {
    const leaveItems: { value: number; label: string }[] = [];
    if (form.travelMinutes && !form.allDay) {
      const buffers = [0, 5, 10, 15, 30]; // minutes before departure
      for (const buf of buffers) {
        const label =
          buf === 0
            ? leaveByTime
              ? `When it's time to leave (${leaveByTime})`
              : "When it's time to leave"
            : `${buf} min before leaving`;
        leaveItems.push({ value: form.travelMinutes + buf, label });
      }
    }
    // Dedupe by value (a leave option may collide with a base "X min before").
    const used = new Set(leaveItems.map((i) => i.value));
    const base = ALERT_OPTIONS.filter((o) => !used.has(o.value));
    return [...base, ...leaveItems];
  }, [form.travelMinutes, form.allDay, leaveByTime]);

  const eventQ = useQuery({
    queryKey: ['calendar', 'event', eventId],
    queryFn: async () => (await calendarApi.getEvent(eventId!)).data,
    enabled: isEdit,
  });
  useEffect(() => {
    if (!eventQ.data) return;
    let cancelled = false;
    (async () => {
      // E2EE dual-write: prefer decrypted content, falling back to plaintext.
      const e = await openRecord('CalendarEvent', eventQ.data);
      if (cancelled) return;
      const start = new Date(e.startDate);
      const pad = (n: number) => String(n).padStart(2, '0');
      set({
        title: e.title ?? '',
        calendarType: e.calendarType ?? 'activities',
        date: e.startDate.slice(0, 10),
        endDate: e.endDate ? e.endDate.slice(0, 10) : '',
        allDay: e.allDay ?? true,
        startTime: e.allDay ? '09:00' : `${pad(start.getHours())}:${pad(start.getMinutes())}`,
        endTime: e.endDate && !e.allDay ? `${pad(new Date(e.endDate).getHours())}:${pad(new Date(e.endDate).getMinutes())}` : '10:00',
        description: e.description ?? '',
        location: e.location ?? '',
        phone: e.phone ?? '',
        travelMinutes: e.travelMinutes ?? null,
        travelDistanceKm: e.travelDistanceKm ?? null,
        reminderMinutes: e.reminderMinutes ?? null,
        alert2Minutes: e.alert2Minutes ?? null,
        recurrFreq: e.recurrence?.freq ?? '',
      });
    })();
    return () => { cancelled = true; };
  }, [eventQ.data]);

  // Form date/time state → the ISO instants the API stores (all-day at noon UTC).
  const buildStartEnd = () => {
    const allDay = form.allDay;
    const startDate = allDay
      ? `${form.date}T12:00:00.000Z`
      : new Date(`${form.date}T${form.startTime}:00`).toISOString();
    const endPart = form.endDate || form.date;
    const endDate = allDay
      ? form.endDate
        ? `${form.endDate}T12:00:00.000Z`
        : undefined
      : form.endTime
      ? new Date(`${endPart}T${form.endTime}:00`).toISOString()
      : undefined;
    return { startDate, endDate };
  };

  // The decrypted event content an invitation carries (email + .ics + the
  // recipient's copy) — the server can't read an E2EE event's own fields.
  const buildSnapshot = () => {
    const { startDate, endDate } = buildStartEnd();
    return {
      title: form.title.trim(),
      description: form.description || undefined,
      location: form.location || undefined,
      phone: form.phone || undefined,
      startDate,
      endDate,
      allDay: form.allDay,
      calendarType: form.calendarType,
    };
  };

  const save = useMutation({
    mutationFn: async () => {
      const allDay = form.allDay;
      const { startDate, endDate } = buildStartEnd();
      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        calendarType: form.calendarType,
        allDay,
        startDate,
        endDate,
        description: form.description || undefined,
        location: form.location || undefined,
        phone: form.phone || undefined,
        travelMinutes: form.travelMinutes ?? undefined,
        travelDistanceKm: form.travelDistanceKm ?? undefined,
        reminderMinutes: form.reminderMinutes ?? undefined,
        alert2Minutes:
          form.reminderMinutes !== null && form.alert2Minutes !== null ? form.alert2Minutes : undefined,
        recurrence: form.recurrFreq ? { freq: form.recurrFreq } : undefined,
      };
      // E2EE dual-write: send ciphertext alongside plaintext (no-op without an HDK).
      return isEdit
        ? calendarApi.updateEvent(eventId!, await sealUpdate('CalendarEvent', eventId!, payload))
        : calendarApi.createEvent(await sealNew('CalendarEvent', payload));
    },
    onSuccess: async (res) => {
      // A new event sends the invitees queued on its Invitees screen — a draft
      // has no event id, so this is the first moment invitations CAN go out.
      if (!isEdit) {
        const queued = getQueuedInvitees();
        if (queued.length) {
          const snapshot = buildSnapshot();
          await Promise.allSettled(
            queued.map((email) => invitationsApi.send({ eventId: res.data._id, email, event: snapshot })),
          );
          clearQueuedInvitees();
        }
      }
      qc.invalidateQueries({ queryKey: ['calendar'] });
      navigation.goBack();
    },
    onError: (e: any) => setError(e.response?.data?.error || 'Save failed'),
  });

  const del = useMutation({
    mutationFn: () => calendarApi.deleteEvent(eventId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] });
      navigation.goBack();
    },
  });

  // An event copy accepted from a cross-household invitation. The recipient is
  // a guest, not the organizer: the whole event is READ-ONLY for them (the
  // server rejects edits with 403) and "Leave event" is their only action.
  // Household-owned events are unaffected — every member edits those as usual.
  const guestInvitationId = eventQ.data?.invitationId;
  useEffect(() => {
    if (guestInvitationId) navigation.setOptions({ title: 'Event' });
  }, [navigation, guestInvitationId]);

  // The guest's own invitation, to show who invited them.
  const myInvitesQ = useQuery({
    queryKey: ['invitations'],
    queryFn: async () => (await invitationsApi.list()).data,
    enabled: !!guestInvitationId,
  });
  const inviter = myInvitesQ.data?.find((i) => i._id === guestInvitationId);

  // The organizer's invitee list, previewed on the Invitees card (managed on
  // the EventInvitees screen; never fetched for a guest copy).
  const inviteesQ = useQuery({
    queryKey: ['invitations', 'sent', eventId],
    queryFn: async () => (await invitationsApi.sentForEvent(eventId!)).data,
    enabled: isEdit && !!eventQ.data && !guestInvitationId,
  });

  // A NEW event's invitees queue in the draft store until save can send them.
  // Start each new form with a clean queue (an abandoned draft leaves one behind).
  const queuedInvitees = useQueuedInvitees();
  useEffect(() => {
    if (!isEdit) clearQueuedInvitees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const inviteeEmails = isEdit ? (inviteesQ.data ?? []).map((i) => i.toEmail) : queuedInvitees;

  // Guest leaves the event: their copy is deleted and the invitation retired.
  const leave = useMutation({
    mutationFn: () => invitationsApi.leave(guestInvitationId!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['calendar'] });
      qc.invalidateQueries({ queryKey: ['invitations'] });
      navigation.goBack();
    },
    onError: (e: any) => setError(e.response?.data?.error || 'Could not leave the event'),
  });

  const onSave = () => {
    if (!form.title.trim()) {
      setError('Title is required');
      return;
    }
    setError('');
    save.mutate();
  };

  useHeaderCheckButton(navigation, {
    onPress: onSave,
    loading: save.isPending,
    color: cal[form.calendarType] || colors.primary,
    // Guests have nothing to save — read-only view below.
    enabled: !guestInvitationId,
  });

  if (isEdit && eventQ.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // ── Guest (invitee) view: event details, no form, Leave as the only action ──
  if (guestInvitationId) {
    const fmtDay = (d: string) =>
      new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const fmtTime = (t: string) =>
      new Date(`2000-01-01T${t}:00`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
    const when = form.allDay
      ? form.endDate && form.endDate !== form.date
        ? `${fmtDay(form.date)} – ${fmtDay(form.endDate)}`
        : fmtDay(form.date)
      : `${fmtDay(form.date)}, ${fmtTime(form.startTime)}${form.endTime ? ` – ${fmtTime(form.endTime)}` : ''}`;
    const inviterName = inviter?.fromName || inviter?.fromEmail;

    return (
      <Screen>
        <Text style={styles.guestTitle}>{form.title}</Text>
        {inviterName ? <Text style={styles.guestInviter}>Invited by {inviterName}</Text> : null}

        <View style={styles.guestCard}>
          <View style={styles.guestRow}>
            <Ionicons name="time-outline" size={18} color={colors.textMuted} />
            <Text style={styles.guestMeta}>{when}</Text>
          </View>
          {form.location ? (
            <View style={styles.guestRow}>
              <Ionicons name="location-outline" size={18} color={colors.textMuted} />
              <Text style={styles.guestMeta}>{form.location}</Text>
            </View>
          ) : null}
          {form.phone ? (
            <View style={styles.guestRow}>
              <Ionicons name="call-outline" size={18} color={colors.textMuted} />
              <Text style={styles.guestMeta}>{form.phone}</Text>
            </View>
          ) : null}
        </View>

        {form.description ? (
          <>
            <SectionTitle>Notes</SectionTitle>
            <Text style={styles.guestNotes}>{form.description}</Text>
          </>
        ) : null}

        <Text style={styles.guestHint}>
          You’re a guest on this event, so it can’t be edited. Only the organizer can change it.
        </Text>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <View style={styles.footer}>
          <Button
            title="Leave event"
            variant="danger"
            loading={leave.isPending}
            onPress={() =>
              Alert.alert('Leave event?', 'This removes the event from your calendar.', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Leave', style: 'destructive', onPress: () => leave.mutate() },
              ])
            }
          />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <FormAssist
        formType="calendar event"
        title="Calendar Assistant"
        placeholder={'Describe the event, e.g. "dentist next Tuesday at 2pm, remind me when it\'s time to leave"'}
        fields={ASSIST_FIELDS}
        current={form}
        onApply={applyPatch}
        includeContacts
      />

      <Input label="Title *" value={form.title} onChangeText={(v) => set({ title: v })} highlight={assist.changed.has('title')} />
      <Select label="Calendar" value={form.calendarType} options={EVENT_CALENDAR_TYPES} onChange={(v) => set({ calendarType: (v as string) ?? 'activities' })} highlight={assist.changed.has('calendarType')} />

      {/* Invitees — a field-styled row (matches the selects) opening the
          EventInvitees screen; previews who is currently invited. */}
      <View style={styles.inviteesWrap}>
        <Text style={styles.inviteesLabel}>Invitees</Text>
        <TouchableOpacity
          style={styles.inviteesField}
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate('EventInvitees', {
              eventId: isEdit ? eventId : undefined,
              snapshot: buildSnapshot(),
            })
          }
        >
          <Ionicons name="people-outline" size={18} color={colors.textMuted} />
          <Text style={styles.inviteesValue} numberOfLines={1}>
            {inviteeEmails.length ? `${inviteeEmails.length} invited · ${inviteePreview(inviteeEmails)}` : 'None'}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
        </TouchableOpacity>
      </View>

      <SwitchRow label="All day" value={form.allDay} onValueChange={(v) => set({ allDay: v })} highlight={assist.changed.has('allDay')} boxed />

      <View style={styles.cols}>
        <View style={styles.col}>
          <DateField label="Start" value={form.date} onChange={(v) => set({ date: v })} highlight={assist.changed.has('date')} />
        </View>
        <View style={styles.col}>
          <DateField label="End" clearable value={form.endDate} onChange={(v) => set({ endDate: v })} defaultValue={form.date} highlight={assist.changed.has('endDate')} />
        </View>
      </View>

      {!form.allDay ? (
        <View>
          <View style={styles.cols}>
            <View style={styles.col}>
              <TimeField value={form.startTime} onChange={(v) => set({ startTime: v })} highlight={assist.changed.has('startTime')} />
            </View>
            <View style={styles.col}>
              <TimeField
                clearable
                value={form.endTime}
                onChange={(v) => set({ endTime: v })}
                defaultValue={addMinutesToTime(form.startTime || '09:00', 60)}
                highlight={assist.changed.has('endTime')}
              />
            </View>
          </View>
          {timeDiffMinutes(form.startTime, form.endTime) ? (
            <Text style={styles.durationHint}>{formatDuration(timeDiffMinutes(form.startTime, form.endTime)!)}</Text>
          ) : null}
        </View>
      ) : null}

      <PlacesAutocomplete label="Location" value={form.location} onChangeText={(v) => set({ location: v })} highlight={assist.changed.has('location')} />

      {form.location.trim() ? (
        <>
          <PlacesAutocomplete
            label="From (starting location)"
            value={form.fromAddress}
            onChangeText={(v) => set({ fromAddress: v })}
            type="address"
          />
          {travelLoading ? (
            <View style={styles.travelRow}>
              <ActivityIndicator size="small" color={colors.textMuted} />
              <Text style={styles.travelText}>Calculating drive time…</Text>
            </View>
          ) : form.travelMinutes ? (
            <View style={styles.travelRow}>
              <Ionicons name="car-outline" size={14} color={colors.textMuted} />
              <Text style={styles.travelText}>
                ~{form.travelMinutes} min drive
                {form.travelDistanceKm ? ` · ${form.travelDistanceKm} km` : ''}
                {leaveByTime ? ` · Leave by ${leaveByTime}` : ''}
              </Text>
            </View>
          ) : travelError ? (
            <Text style={styles.error}>{travelError}</Text>
          ) : (
            <Text style={styles.travelHint}>Enter a starting location to calculate drive time</Text>
          )}
        </>
      ) : null}

      <Input
        label="Phone"
        value={form.phone}
        onChangeText={(v) => set({ phone: v })}
        keyboardType="phone-pad"
        highlight={assist.changed.has('phone')}
      />

      <SectionTitle>Reminders</SectionTitle>
      <Select
        label="Alert"
        value={form.reminderMinutes ?? undefined}
        options={alertItems}
        onChange={(v) => set({ reminderMinutes: v === -1 ? null : (v as number) })}
        highlight={assist.changed.has('reminderMinutes')}
      />
      {form.reminderMinutes !== null ? (
        <Select
          label="Second alert"
          value={form.alert2Minutes ?? undefined}
          options={alertItems}
          onChange={(v) => set({ alert2Minutes: v === -1 ? null : (v as number) })}
        />
      ) : null}
      <Select label="Repeat" value={form.recurrFreq} options={REPEAT_OPTIONS} onChange={(v) => set({ recurrFreq: (v as string) ?? '' })} highlight={assist.changed.has('recurrFreq')} />

      <SectionTitle>Notes</SectionTitle>
      <Input
        value={form.description}
        onChangeText={(v) => set({ description: v })}
        multiline
        placeholder="Add any notes…"
        style={styles.notes}
        highlight={assist.changed.has('description')}
      />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isEdit ? (
        <View style={styles.footer}>
          <Button
            title="Delete"
            variant="danger"
            onPress={() =>
              Alert.alert('Delete event?', '', [
                { text: 'Cancel', style: 'cancel' },
                { text: 'Delete', style: 'destructive', onPress: () => del.mutate() },
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
  cols: { flexDirection: 'row', gap: spacing.sm },
  col: { flex: 1 },
  error: { color: colors.error, marginVertical: spacing.sm },
  travelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: -spacing.sm, marginBottom: spacing.md },
  travelText: { fontSize: 13, color: colors.textMuted },
  travelHint: { fontSize: 13, color: colors.textMuted, marginTop: -spacing.sm, marginBottom: spacing.md },
  notes: { height: 90, textAlignVertical: 'top' },
  footer: { marginTop: spacing.md, marginBottom: spacing.xl },
  // Invitees field-row (mirrors ui.tsx's input/select box styling)
  inviteesWrap: { marginBottom: spacing.md },
  inviteesLabel: { fontSize: 13, color: colors.textMuted, marginBottom: 6, fontWeight: '500' },
  inviteesField: {
    backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.md, paddingHorizontal: 14, paddingVertical: 12,
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
  },
  inviteesValue: { flex: 1, fontSize: 16, color: colors.text },
  // Guest (read-only invitee) view
  guestTitle: { fontSize: 24, fontWeight: '700', color: colors.text },
  guestInviter: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  guestCard: {
    backgroundColor: colors.surface, borderRadius: 12,
    padding: spacing.md, gap: spacing.sm, marginTop: spacing.md,
  },
  guestRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  guestMeta: { fontSize: 15, color: colors.text, flexShrink: 1 },
  guestNotes: { fontSize: 14, color: colors.text, lineHeight: 20 },
  guestHint: { fontSize: 13, color: colors.textMuted, marginTop: spacing.lg },
  durationHint: { fontSize: 13, color: colors.textMuted, marginTop: -spacing.xs, marginBottom: spacing.md },
});
