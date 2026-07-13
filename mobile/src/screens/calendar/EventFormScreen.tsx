import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TouchableOpacity, Modal, Pressable } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { calendarApi, invitationsApi, placesApi, settingsApi, FormAssistField } from '../../api';
import { Button, Input, Select, Screen, SwitchRow, SectionTitle, DateField, TimeField, useHeaderCheckButton } from '../../components/ui';
import FormAssist from '../../components/FormAssist';
import { form as formStyles } from '../../components/formStyles';
import { useFormAssist } from '../../hooks/useFormAssist';
import PlacesAutocomplete from '../../components/PlacesAutocomplete';
import { EVENT_CALENDAR_TYPES, ymd } from '../../lib/calendar';
import { useCalendarColors, useCustomCalendars, useDeletedDefaultCalendars } from '../../lib/calendarPrefs';
import { sealNew, sealUpdate, openRecord } from '../../lib/e2ee';
import { getFeedEventById, FEED_EVENT_ID_PREFIX } from '../../lib/calendarFeeds';
import { formatDuration } from '../../lib/format';
import WheelPicker, { WHEEL_ITEM_H, WHEEL_VISIBLE } from '../../components/WheelPicker';
import {
  getQueuedInvitees, clearQueuedInvitees, useQueuedInvitees,
  getDraftGuestListVisible, setDraftGuestListVisible,
} from '../../lib/inviteeDraft';
import { inviteeKey, sendInvitations } from '../../lib/invitees';
import { useTravelDraft, clearTravelDraft } from '../../lib/travelDraft';
import { RepeatRule, WeekdayKind, isCustomRule, repeatSummary } from '../../lib/eventRepeat';
import { useRepeatDraft, clearRepeatDraft } from '../../lib/repeatDraft';
import { CalendarStackParamList } from '../../navigation/CalendarNavigator';
import { colors, spacing, radius } from '../../theme';

type Nav = NativeStackNavigationProp<CalendarStackParamList, 'EventForm'>;
type Rt = RouteProp<CalendarStackParamList, 'EventForm'>;

const ALERT_OPTIONS = [
  { label: 'None', value: -1 },
  { label: 'At time of event', value: 0 },
  { label: '15 min before', value: 15 },
  { label: '30 min before', value: 30 },
  { label: '1 hour before', value: 60 },
  { label: '1 day before', value: 1440 },
];

// Sentinel picker value: opens the custom dual-wheel sheet instead of setting a time.
const CUSTOM_ALERT = -2;

function addMinutesToTime(time: string, minutes: number): string {
  const [h, m] = time.split(':').map(Number);
  const total = h * 60 + m + minutes;
  return `${String(Math.floor(total / 60) % 24).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

const CUSTOM_UNITS = [
  { label: 'minutes', value: 1 },
  { label: 'hours', value: 60 },
  { label: 'days', value: 1440 },
];

// Amount wheel range per unit (iOS timer-style: finer units, shorter ranges).
const AMOUNT_MAX: Record<number, number> = { 1: 59, 60: 23, 1440: 31 };

// Decompose stored "minutes before the event" into the largest clean unit, to
// seed the wheels from the field's current value. No usable value → 30 minutes.
function decomposeAlert(minutes: number | null): { amount: number; unit: number } {
  if (!minutes || minutes <= 0) return { amount: 30, unit: 1 };
  const unit = minutes % 1440 === 0 ? 1440 : minutes % 60 === 0 ? 60 : 1;
  return { amount: Math.min(minutes / unit, AMOUNT_MAX[unit]), unit };
}

// The alert picker's "Custom…" choice: a dual amount + unit wheel in a bottom
// sheet (the Repeat screen's "Every" sheet with a second wheel for the unit).
// Done emits plain "minutes before the event".
function CustomAlertSheet({
  visible,
  initialMinutes,
  onSave,
  onClose,
}: {
  visible: boolean;
  initialMinutes: number | null;
  onSave: (minutes: number) => void;
  onClose: () => void;
}) {
  const [amount, setAmount] = useState(30);
  const [unit, setUnit] = useState(1);

  // Reseed from the field's current value each time the sheet opens.
  useEffect(() => {
    if (!visible) return;
    const d = decomposeAlert(initialMinutes);
    setAmount(d.amount);
    setUnit(d.unit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible]);

  // Switching to a coarser unit can leave the amount past its wheel's range.
  const pickUnit = (u: number) => {
    setUnit(u);
    setAmount((a) => Math.min(a, AMOUNT_MAX[u]));
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.wheelRow}>
            {/* Selection band spans both wheels, like the native spinner's. */}
            <View pointerEvents="none" style={styles.wheelBand} />
            <WheelPicker
              // Remount per open (fresh position) and per unit (clamped range).
              key={`amount-${String(visible)}-${unit}`}
              width={72}
              items={Array.from({ length: AMOUNT_MAX[unit] }, (_, i) => ({ label: String(i + 1), value: i + 1 }))}
              value={amount}
              onChange={setAmount}
            />
            <WheelPicker
              key={`unit-${String(visible)}`}
              width={120}
              items={CUSTOM_UNITS}
              value={unit}
              onChange={pickUnit}
            />
          </View>
          <Button
            title="Done"
            onPress={() => {
              onSave(amount * unit);
              onClose();
            }}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// "a@x.com, b@y.com +2 more" — the Invitees card's one-line preview.
function inviteePreview(emails: string[]): string {
  if (!emails.length) return 'No one invited yet';
  const shown = emails.slice(0, 2).join(', ');
  return emails.length > 2 ? `${shown} +${emails.length - 2} more` : shown;
}

const REPEAT_OPTIONS = [
  { label: 'Never', value: '' },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Yearly', value: 'yearly' },
];

// Sentinel picker value for the Repeat select's "Custom…" row. While a custom
// rule is active the select's value IS this sentinel, so the row shows the
// rule's summary ("Every 2 weeks on Monday") and tapping it reopens the Repeat
// screen to edit.
const CUSTOM_REPEAT = 'custom';

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
  {
    name: 'recurrInterval',
    type: 'number',
    label: 'Repeat every N',
    description:
      'Only for custom repeats like "every 2 weeks" or "every 3 months": set recurrFreq to the unit (weekly/monthly/…) and this to N. Omit for simple repeats.',
  },
  { name: 'recurrUntil', type: 'date', label: 'End repeat', description: 'Last date the event repeats. Only when the event repeats.' },
];

// RSVP labels for the Guests card on the guest (read-only invitee) view.
const GUEST_STATUS_LABEL: Record<string, string> = {
  pending: 'Invited',
  accepted: 'Going',
  declined: 'Declined',
  left: 'Left',
};

export default function EventFormScreen() {
  const navigation = useNavigation<Nav>();
  const { eventId, date, prefill } = useRoute<Rt>().params || {};
  const isEdit = !!eventId;
  const qc = useQueryClient();
  // The save check is tinted with the selected calendar's colour (respects
  // user overrides).
  const cal = useCalendarColors().colors;
  // Built-in event calendars plus the user's own (Calendars → Add Calendar).
  const { calendars: customCalendars } = useCustomCalendars();
  const { deletedIds: deletedDefaults } = useDeletedDefaultCalendars();

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
    // Travel time is off until enabled on the Travel Time screen. travelManual
    // = the user picked a fixed duration there (no auto recompute).
    travelEnabled: false,
    travelManual: false,
    travelMinutes: null as number | null,
    travelDistanceKm: null as string | null,
    reminderMinutes: null as number | null,
    alert2Minutes: null as number | null,
    recurrFreq: '',
    recurrInterval: 1,
    recurrDaysOfWeek: [] as number[],
    recurrDaysOfMonth: [] as number[],
    recurrMonths: [] as number[],
    recurrWeekOfMonth: null as number | null,
    recurrWeekdayKind: null as WeekdayKind | null,
    recurrUntil: '',
  });
  const [error, setError] = useState('');
  const [travelLoading, setTravelLoading] = useState(false);
  const [travelError, setTravelError] = useState('');
  // Set when the assistant asked for a "time to leave" alert before the drive
  // time was known; resolved to reminderMinutes once travel time computes.
  const [pendingLeaveAlert, setPendingLeaveAlert] = useState(false);
  const assist = useFormAssist();

  // The Calendar picker: built-ins minus any the user deleted from the
  // Calendars view (the event's current calendar always stays offered, so old
  // events keep rendering theirs), plus custom calendars where this user can
  // actually put events (View Only calendars are excluded).
  const calendarOptions = useMemo(() => {
    const builtIns = EVENT_CALENDAR_TYPES.filter(
      (o) => !deletedDefaults.includes(o.value) || o.value === form.calendarType
    );
    const customs = customCalendars
      // Subscribed (feed) and holiday calendars are read-only — never an event
      // destination.
      .filter((c) => !c.feedUrl && !c.holiday && (c.access === 'full' || c.id === form.calendarType))
      .map((c) => ({ label: c.name, value: c.id }));
    const opts = [...builtIns, ...customs];
    return opts.length ? opts : EVENT_CALENDAR_TYPES;
  }, [customCalendars, deletedDefaults, form.calendarType]);
  // The assistant's Calendar select must offer the same set.
  const assistFields = useMemo<FormAssistField[]>(
    () => ASSIST_FIELDS.map((f) => (f.name === 'calendarType' ? { ...f, options: calendarOptions } : f)),
    [calendarOptions]
  );

  // Manual edits clear the "AI changed this" highlight for the touched fields.
  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    assist.clear(Object.keys(patch));
  };

  // A new event defaults to Activities; if the user deleted that calendar,
  // snap to the first calendar the picker actually offers.
  useEffect(() => {
    if (isEdit) return;
    if (!calendarOptions.some((o) => o.value === form.calendarType)) {
      setForm((f) => ({ ...f, calendarType: (calendarOptions[0]?.value as string) ?? 'activities' }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, calendarOptions, form.calendarType]);

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
        // Travel time must be on for the drive time to compute at all.
        next.travelEnabled = true;
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

  // Recompute (debounced) whenever the location or starting point changes —
  // only while travel time is enabled and not set to a manual duration.
  useEffect(() => {
    if (!form.travelEnabled || form.travelManual) return;
    if (!form.location.trim()) return;
    const t = setTimeout(fetchTravelTime, 700);
    return () => clearTimeout(t);
  }, [form.location, form.fromAddress, form.travelEnabled, form.travelManual]);

  // Apply edits made on the pushed Travel Time screen as they happen.
  const travelDraft = useTravelDraft();
  useEffect(() => {
    if (!travelDraft) return;
    setForm((f) => ({
      ...f,
      travelEnabled: travelDraft.enabled,
      fromAddress: travelDraft.fromAddress,
      travelManual: travelDraft.manualMinutes != null,
      travelMinutes: !travelDraft.enabled ? null : travelDraft.manualMinutes ?? f.travelMinutes,
      travelDistanceKm: travelDraft.enabled && travelDraft.manualMinutes == null ? f.travelDistanceKm : null,
    }));
  }, [travelDraft]);
  useEffect(() => () => clearTravelDraft(), []);

  // Apply edits made on the pushed Repeat screen as they happen.
  const repeatDraft = useRepeatDraft();
  useEffect(() => {
    if (!repeatDraft) return;
    setForm((f) => ({
      ...f,
      recurrFreq: repeatDraft.freq,
      recurrInterval: repeatDraft.interval,
      recurrDaysOfWeek: repeatDraft.daysOfWeek,
      recurrDaysOfMonth: repeatDraft.daysOfMonth,
      recurrMonths: repeatDraft.months,
      recurrWeekOfMonth: repeatDraft.weekOfMonth,
      recurrWeekdayKind: repeatDraft.weekdayKind,
    }));
  }, [repeatDraft]);
  useEffect(() => () => clearRepeatDraft(), []);

  // Which alert field the custom dual-wheel sheet is editing (null = closed).
  const [customFor, setCustomFor] = useState<'reminderMinutes' | 'alert2Minutes' | null>(null);

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
        // No computable departure time (e.g. no start time yet) — omit "Time to leave".
        if (buf === 0 && !leaveByTime) continue;
        const label = buf === 0 ? `Time to leave (${leaveByTime})` : `${buf} min before leaving`;
        leaveItems.push({ value: form.travelMinutes + buf, label });
      }
    }
    // Dedupe by value (a leave option may collide with a base "X min before").
    const used = new Set(leaveItems.map((i) => i.value));
    const base = ALERT_OPTIONS.filter((o) => !used.has(o.value));
    // "None" stays first; departure-relative options follow it so they're
    // visible without scrolling (the option modal caps at 70% screen height).
    const items = [base[0], ...leaveItems, ...base.slice(1)];
    // A saved custom value has no canned option — synthesize a label for it so
    // the field doesn't show the placeholder. When a drive time is known and
    // the value reaches past it, describe it relative to departure instead.
    for (const v of [form.reminderMinutes, form.alert2Minutes]) {
      if (v == null || v <= 0 || items.some((i) => i.value === v)) continue;
      const label =
        form.travelMinutes && !form.allDay && v >= form.travelMinutes
          ? `${formatDuration(v - form.travelMinutes)} before leaving`
          : `${formatDuration(v)} before`;
      items.push({ value: v, label });
    }
    items.push({ label: 'Custom…', value: CUSTOM_ALERT });
    return items;
  }, [form.travelMinutes, form.allDay, leaveByTime, form.reminderMinutes, form.alert2Minutes]);

  // Repeat options + the select's value. A custom rule ("every 2 weeks on
  // Monday") selects the Custom row and labels it with the rule's summary.
  const repeatRule: RepeatRule = useMemo(
    () => ({
      freq: form.recurrFreq as RepeatRule['freq'],
      interval: form.recurrInterval,
      daysOfWeek: form.recurrDaysOfWeek,
      daysOfMonth: form.recurrDaysOfMonth,
      months: form.recurrMonths,
      weekOfMonth: form.recurrWeekOfMonth,
      weekdayKind: form.recurrWeekdayKind,
    }),
    [
      form.recurrFreq, form.recurrInterval, form.recurrDaysOfWeek,
      form.recurrDaysOfMonth, form.recurrMonths, form.recurrWeekOfMonth, form.recurrWeekdayKind,
    ],
  );
  const customRepeatActive = isCustomRule(repeatRule);
  const repeatItems = useMemo(
    () => [
      ...REPEAT_OPTIONS,
      { label: customRepeatActive ? repeatSummary(repeatRule) : 'Custom…', value: CUSTOM_REPEAT },
    ],
    [customRepeatActive, repeatRule],
  );
  const repeatValue = customRepeatActive ? CUSTOM_REPEAT : form.recurrFreq;

  // Feed occurrences are synthetic (feed:<cal>:<start>:<uid>): no server row
  // exists, so resolve them from the last local expansion. They carry
  // readOnly: true, so the read-only view renders without any further queries.
  const isFeedEvent = !!eventId?.startsWith(FEED_EVENT_ID_PREFIX);
  const eventQ = useQuery({
    queryKey: ['calendar', 'event', eventId],
    queryFn: async () => {
      if (isFeedEvent) {
        const e = getFeedEventById(eventId!);
        if (!e) throw new Error('Feed event not found');
        return e;
      }
      return (await calendarApi.getEvent(eventId!)).data;
    },
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
        travelEnabled: e.travelMinutes != null,
        // Auto-computed times always store a distance; a bare minutes value
        // means a manually picked duration.
        travelManual: e.travelMinutes != null && e.travelDistanceKm == null,
        travelMinutes: e.travelMinutes ?? null,
        travelDistanceKm: e.travelDistanceKm ?? null,
        reminderMinutes: e.reminderMinutes ?? null,
        alert2Minutes: e.alert2Minutes ?? null,
        recurrFreq: e.recurrence?.freq ?? '',
        recurrInterval: e.recurrence?.interval ?? 1,
        recurrDaysOfWeek: e.recurrence?.daysOfWeek ?? [],
        recurrDaysOfMonth: e.recurrence?.daysOfMonth ?? [],
        recurrMonths: e.recurrence?.months ?? [],
        recurrWeekOfMonth: e.recurrence?.weekOfMonth ?? null,
        recurrWeekdayKind: e.recurrence?.weekdayKind ?? null,
        recurrUntil: e.recurrence?.until ? String(e.recurrence.until).slice(0, 10) : '',
      });
      // Seed the Invitees screen's guest-list switch (missing on events that
      // predate the setting — treated as visible).
      setDraftGuestListVisible(e.guestListVisible !== false);
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
        // null (not undefined) so turning travel time off clears the stored
        // values on update — the route skips undefined fields.
        travelMinutes: form.travelEnabled ? form.travelMinutes ?? null : null,
        travelDistanceKm: form.travelEnabled ? form.travelDistanceKm ?? null : null,
        reminderMinutes: form.reminderMinutes ?? undefined,
        alert2Minutes:
          form.reminderMinutes !== null && form.alert2Minutes !== null ? form.alert2Minutes : undefined,
        recurrence: form.recurrFreq
          ? {
              freq: form.recurrFreq,
              interval: form.recurrInterval > 1 ? form.recurrInterval : undefined,
              daysOfWeek:
                form.recurrFreq === 'weekly' && form.recurrDaysOfWeek.length ? form.recurrDaysOfWeek : undefined,
              daysOfMonth:
                form.recurrFreq === 'monthly' && form.recurrDaysOfMonth.length ? form.recurrDaysOfMonth : undefined,
              months: form.recurrFreq === 'yearly' && form.recurrMonths.length ? form.recurrMonths : undefined,
              // The ordinal rule rides with monthly "on the…" or yearly months.
              weekOfMonth:
                (form.recurrFreq === 'monthly' && !form.recurrDaysOfMonth.length) ||
                (form.recurrFreq === 'yearly' && form.recurrMonths.length)
                  ? form.recurrWeekOfMonth ?? undefined
                  : undefined,
              weekdayKind:
                (form.recurrFreq === 'monthly' && !form.recurrDaysOfMonth.length) ||
                (form.recurrFreq === 'yearly' && form.recurrMonths.length)
                  ? form.recurrWeekdayKind ?? undefined
                  : undefined,
              // End of the chosen local day, so the last occurrence is included.
              until: form.recurrUntil ? new Date(`${form.recurrUntil}T23:59:59`).toISOString() : undefined,
            }
          : undefined,
      };
      // E2EE dual-write: send ciphertext alongside plaintext (no-op without an HDK).
      if (isEdit) {
        return calendarApi.updateEvent(eventId!, await sealUpdate('CalendarEvent', eventId!, payload));
      }
      // guestListVisible is a plaintext scope field the server enforces. It is
      // set on the Invitees screen: sent here on create only (edits PUT it from
      // that screen directly) and kept OUT of the sealed content subset, so a
      // later plaintext-only toggle can't be undone by a stale enc merge.
      const create = { ...payload, guestListVisible: getDraftGuestListVisible() };
      return calendarApi.createEvent(await sealNew('CalendarEvent', create, payload));
    },
    onSuccess: async (res) => {
      // A new event sends the invitees queued on its Invitees screen — a draft
      // has no event id, so this is the first moment invitations CAN go out.
      // Emails post in parallel; each phone entry opens the Messages composer
      // in turn (send failures are dropped — the form is already closing).
      if (!isEdit) {
        const queued = getQueuedInvitees();
        if (queued.length) {
          await sendInvitations(res.data._id, queued, buildSnapshot());
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
  // An event read as an outside collaborator on its shared calendar (§9.5):
  // the same read-only view, but there is nothing to leave — access is managed
  // via the calendar invitation, not per event.
  const collabReadOnly = !!eventQ.data?.readOnly;
  const readOnlyView = !!guestInvitationId || collabReadOnly;
  useEffect(() => {
    if (readOnlyView) navigation.setOptions({ title: 'Event' });
  }, [navigation, readOnlyView]);

  // The guest's own invitation, to show who invited them.
  const myInvitesQ = useQuery({
    queryKey: ['invitations'],
    queryFn: async () => (await invitationsApi.list()).data,
    enabled: !!guestInvitationId,
  });
  const inviter = myInvitesQ.data?.find((i) => i._id === guestInvitationId);

  // Who else is invited — only returned if the organizer's event allows it
  // (guestListVisible); the server answers visible:false otherwise.
  const guestListQ = useQuery({
    queryKey: ['invitations', 'guests', guestInvitationId],
    queryFn: async () => (await invitationsApi.guests(guestInvitationId!)).data,
    enabled: !!guestInvitationId,
  });

  // The organizer's invitee list, previewed on the Invitees card (managed on
  // the EventInvitees screen; never fetched for a guest copy).
  const inviteesQ = useQuery({
    queryKey: ['invitations', 'sent', eventId],
    queryFn: async () => (await invitationsApi.sentForEvent(eventId!)).data,
    enabled: isEdit && !!eventQ.data && !readOnlyView,
  });

  // A NEW event's invitees queue in the draft store until save can send them.
  // Start each new form with a clean queue (an abandoned draft leaves one behind).
  const queuedInvitees = useQueuedInvitees();
  useEffect(() => {
    if (!isEdit) clearQueuedInvitees();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const inviteeEmails = isEdit
    ? (inviteesQ.data ?? []).map((i) => i.toEmail ?? i.toPhone ?? '')
    : queuedInvitees.map(inviteeKey);

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
    color: cal[form.calendarType] || customCalendars.find((c) => c.id === form.calendarType)?.color || colors.primary,
    // Guests and calendar collaborators have nothing to save — read-only view below.
    enabled: !readOnlyView,
  });

  if (isEdit && eventQ.isLoading) {
    return (
      <View style={formStyles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // ── Read-only view (guest invitee or calendar collaborator): event details,
  // no form. Guests get Leave as their only action; collaborators get none —
  // their access is managed on the calendar invitation. ──
  if (readOnlyView) {
    const fmtDay = (d: string) =>
      new Date(d + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
    const fmtTime = (t: string) =>
      new Date(`2000-01-01T${t}:00`).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true });
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

        {guestListQ.data?.visible && guestListQ.data.guests.length ? (
          <>
            <SectionTitle>Guests</SectionTitle>
            <View style={styles.guestCard}>
              <View style={styles.guestRow}>
                <Ionicons name="person-circle-outline" size={18} color={colors.textMuted} />
                <Text style={styles.guestListName} numberOfLines={1}>
                  {guestListQ.data.organizer?.name || guestListQ.data.organizer?.email}
                </Text>
                <Text style={styles.guestListStatus}>Organizer</Text>
              </View>
              {guestListQ.data.guests.map((g) => (
                <View key={g._id} style={styles.guestRow}>
                  <Ionicons name="person-outline" size={18} color={colors.textMuted} />
                  <Text style={styles.guestListName} numberOfLines={1}>
                    {g._id === guestInvitationId ? 'You' : g.toEmail || g.toPhone}
                  </Text>
                  <Text style={styles.guestListStatus}>{GUEST_STATUS_LABEL[g.status]}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {form.description ? (
          <>
            <SectionTitle>Notes</SectionTitle>
            <Text style={styles.guestNotes}>{form.description}</Text>
          </>
        ) : null}

        <Text style={styles.guestHint}>
          {collabReadOnly
            ? `You have view-only access to “${
                customCalendars.find((c) => c.id === form.calendarType)?.name ?? 'this calendar'
              }”, so its events can’t be edited.`
            : 'You’re a guest on this event, so it can’t be edited. Only the organizer can change it.'}
        </Text>

        {error ? <Text style={formStyles.error}>{error}</Text> : null}

        {guestInvitationId ? (
          <View style={formStyles.footer}>
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
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen>
      <FormAssist
        formType="calendar event"
        placeholder={'Describe the event, e.g. "dentist next Tuesday at 2pm, remind me when it\'s time to leave"'}
        fields={assistFields}
        current={form}
        onApply={applyPatch}
        includeContacts
      />

      {/* Title + Location grouped in one card (Apple Calendar-style): no labels,
          placeholder text only, rows separated by a hairline. */}
      <View style={formStyles.groupCard}>
        <Input
          value={form.title}
          onChangeText={(v) => set({ title: v })}
          placeholder="Title"
          containerStyle={formStyles.headField}
          style={[formStyles.headInput, assist.changed.has('title') && formStyles.headInputHighlight]}
        />
        <View style={formStyles.cardDivider} />
        <PlacesAutocomplete
          value={form.location}
          onChangeText={(v) => set({ location: v })}
          placeholder="Location or Video Call"
          containerStyle={formStyles.headField}
          inputStyle={[formStyles.headInput, assist.changed.has('location') && formStyles.headInputHighlight]}
        />
      </View>

      {/* All day / Starts / Ends / Travel Time grouped card */}
      <View style={formStyles.groupCard}>
        <View style={formStyles.groupPad}>
          <SwitchRow label="All day" value={form.allDay} onValueChange={(v) => set({ allDay: v })} highlight={assist.changed.has('allDay')} />
        </View>
        <View style={formStyles.cardDivider} />
        <View style={formStyles.dtRow}>
          <Text style={formStyles.dtLabel}>Starts</Text>
          <View style={formStyles.dtFields}>
            <DateField
              value={form.date}
              onChange={(v) => set(form.endDate && form.endDate < v ? { date: v, endDate: v } : { date: v })}
              highlight={assist.changed.has('date')}
              containerStyle={formStyles.dtFieldWrap}
              fieldStyle={formStyles.dtField}
              valueStyle={formStyles.dtValue}
              hideIcon
            />
            {!form.allDay ? (
              <TimeField
                value={form.startTime}
                onChange={(v) => set({ startTime: v })}
                highlight={assist.changed.has('startTime')}
                containerStyle={formStyles.dtFieldWrap}
                fieldStyle={formStyles.dtField}
                valueStyle={formStyles.dtValue}
                hideIcon
              />
            ) : null}
          </View>
        </View>
        <View style={formStyles.cardDivider} />
        <View style={formStyles.dtRow}>
          <Text style={formStyles.dtLabel}>Ends</Text>
          <View style={formStyles.dtFields}>
            {/* Defaults to the start date; form.endDate stays unset (= same day)
                until a different date is picked. */}
            <DateField
              value={form.endDate || form.date}
              onChange={(v) => set({ endDate: v === form.date ? '' : v })}
              highlight={assist.changed.has('endDate')}
              containerStyle={formStyles.dtFieldWrap}
              fieldStyle={formStyles.dtField}
              valueStyle={formStyles.dtValue}
              hideIcon
            />
            {!form.allDay ? (
              <TimeField
                value={form.endTime}
                onChange={(v) => set({ endTime: v })}
                defaultValue={addMinutesToTime(form.startTime || '09:00', 60)}
                highlight={assist.changed.has('endTime')}
                containerStyle={formStyles.dtFieldWrap}
                fieldStyle={formStyles.dtField}
                valueStyle={formStyles.dtValue}
                hideIcon
              />
            ) : null}
          </View>
        </View>
        <View style={formStyles.cardDivider} />
        <TouchableOpacity
          style={formStyles.dtRow}
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate('EventTravelTime', {
              enabled: form.travelEnabled,
              fromAddress: form.fromAddress,
              manualMinutes: form.travelManual ? form.travelMinutes : null,
            })
          }
        >
          <Text style={formStyles.dtLabel}>Travel Time</Text>
          {travelLoading ? (
            <ActivityIndicator size="small" color={colors.textMuted} />
          ) : (
            <Text style={[formStyles.groupValue, !form.travelMinutes && formStyles.groupValueMuted]} numberOfLines={1}>
              {form.travelEnabled && form.travelMinutes
                ? `${formatDuration(form.travelMinutes)}${leaveByTime ? ` · Leave by ${leaveByTime}` : ''}`
                : 'None'}
            </Text>
          )}
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={formStyles.rowChevron} />
        </TouchableOpacity>
      </View>
      {form.travelEnabled && travelError ? <Text style={formStyles.error}>{travelError}</Text> : null}

      {/* Repeat / End Repeat grouped card */}
      <View style={formStyles.groupCard}>
        <Select
          inlineLabel="Repeat"
          value={repeatValue}
          options={repeatItems}
          onChange={(v) => {
            if (v === CUSTOM_REPEAT) {
              navigation.navigate('EventRepeat', { rule: repeatRule, date: form.date });
            } else {
              set({
                recurrFreq: (v as string) ?? '',
                recurrInterval: 1,
                recurrDaysOfWeek: [],
                recurrDaysOfMonth: [],
                recurrMonths: [],
                recurrWeekOfMonth: null,
                recurrWeekdayKind: null,
                ...(v ? {} : { recurrUntil: '' }),
              });
            }
          }}
          highlight={assist.changed.has('recurrFreq')}
          containerStyle={formStyles.dtFieldWrap}
          fieldStyle={formStyles.rowField}
          valueStyle={formStyles.dtValue}
          chevronIcon="chevron-expand"
        />
        {form.recurrFreq ? (
          <>
            <View style={formStyles.cardDivider} />
            <DateField
              inlineLabel="End Repeat"
              clearable
              placeholder="Never"
              value={form.recurrUntil}
              onChange={(v) => set({ recurrUntil: v })}
              defaultValue={form.date}
              highlight={assist.changed.has('recurrUntil')}
              containerStyle={formStyles.dtFieldWrap}
              fieldStyle={formStyles.rowField}
              valueStyle={formStyles.dtValue}
              hideIcon
            />
          </>
        ) : null}
      </View>

      {/* Calendar / Invitees grouped card. The Invitees row opens the
          EventInvitees screen; previews who is currently invited. */}
      <View style={formStyles.groupCard}>
        <Select
          inlineLabel="Calendar"
          value={form.calendarType}
          options={calendarOptions}
          onChange={(v) => set({ calendarType: (v as string) ?? 'activities' })}
          highlight={assist.changed.has('calendarType')}
          containerStyle={formStyles.dtFieldWrap}
          fieldStyle={formStyles.rowField}
          valueStyle={formStyles.dtValue}
          chevronIcon="chevron-expand"
        />
        <View style={formStyles.cardDivider} />
        <TouchableOpacity
          style={formStyles.dtRow}
          activeOpacity={0.7}
          onPress={() =>
            navigation.navigate('EventInvitees', {
              eventId: isEdit ? eventId : undefined,
              snapshot: buildSnapshot(),
            })
          }
        >
          <Text style={formStyles.dtLabel}>Invitees</Text>
          <Text style={[formStyles.groupValue, !inviteeEmails.length && formStyles.groupValueMuted]} numberOfLines={1}>
            {inviteeEmails.length ? `${inviteeEmails.length} invited · ${inviteePreview(inviteeEmails)}` : 'None'}
          </Text>
          <Ionicons name="chevron-forward" size={18} color={colors.textMuted} style={formStyles.rowChevron} />
        </TouchableOpacity>
      </View>

      {/* Phone has no visible field: it stays in the form state / assist schema /
          save payload so the AI assistant can still set and use it. */}

      {/* Alert / Second Alert grouped card */}
      <View style={formStyles.groupCard}>
        <Select
          inlineLabel="Alert"
          value={form.reminderMinutes ?? undefined}
          options={alertItems}
          placeholder="None"
          onChange={(v) => {
            if (v === CUSTOM_ALERT) setCustomFor('reminderMinutes');
            else set({ reminderMinutes: v === -1 ? null : (v as number) });
          }}
          highlight={assist.changed.has('reminderMinutes')}
          containerStyle={formStyles.dtFieldWrap}
          fieldStyle={formStyles.rowField}
          valueStyle={formStyles.dtValue}
          chevronIcon="chevron-expand"
        />
        {form.reminderMinutes !== null ? (
          <>
            <View style={formStyles.cardDivider} />
            <Select
              inlineLabel="Second Alert"
              value={form.alert2Minutes ?? undefined}
              options={alertItems}
              placeholder="None"
              onChange={(v) => {
                if (v === CUSTOM_ALERT) setCustomFor('alert2Minutes');
                else set({ alert2Minutes: v === -1 ? null : (v as number) });
              }}
              containerStyle={formStyles.dtFieldWrap}
              fieldStyle={formStyles.rowField}
              valueStyle={formStyles.dtValue}
              chevronIcon="chevron-expand"
            />
          </>
        ) : null}
      </View>

      {/* Attachment card — placeholder row only: calendar events have no
          attachment storage on the backend yet (trips/maintenance items do). */}
      <View style={formStyles.groupCard}>
        <View style={formStyles.dtRow}>
          <Text style={[formStyles.groupValue, formStyles.groupValueMuted]}>Add attachment...</Text>
        </View>
      </View>

      <CustomAlertSheet
        visible={customFor !== null}
        initialMinutes={customFor ? form[customFor] : null}
        onSave={(minutes) => {
          if (customFor) set({ [customFor]: minutes } as Partial<typeof form>);
        }}
        onClose={() => setCustomFor(null)}
      />

      <SectionTitle>Notes</SectionTitle>
      <Input
        value={form.description}
        onChangeText={(v) => set({ description: v })}
        multiline
        placeholder="Add any notes…"
        style={formStyles.notes}
        highlight={assist.changed.has('description')}
      />

      {error ? <Text style={formStyles.error}>{error}</Text> : null}

      {isEdit ? (
        <View style={formStyles.footer}>
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

// Grouped-card form styles live in components/formStyles (shared by all
// add/edit forms); only screen-specific styles remain here.
const styles = StyleSheet.create({
  // Guest (read-only invitee) view
  guestTitle: { fontSize: 24, fontWeight: '700', color: colors.text },
  guestInviter: { fontSize: 13, color: colors.textMuted, marginTop: 4 },
  guestCard: {
    backgroundColor: colors.surface, borderRadius: 12,
    padding: spacing.md, gap: spacing.sm, marginTop: spacing.md,
  },
  guestRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  guestMeta: { fontSize: 15, color: colors.text, flexShrink: 1 },
  guestListName: { fontSize: 15, color: colors.text, flex: 1 },
  guestListStatus: { fontSize: 13, color: colors.textMuted },
  guestNotes: { fontSize: 14, color: colors.text, lineHeight: 20 },
  guestHint: { fontSize: 13, color: colors.textMuted, marginTop: spacing.lg },
  // Custom alert dual wheel — bottom sheet matching the Repeat screen's "Every"
  sheetBackdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg, borderTopRightRadius: radius.lg,
    padding: spacing.md, gap: spacing.sm,
  },
  wheelRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    gap: spacing.md, height: WHEEL_ITEM_H * WHEEL_VISIBLE,
  },
  wheelBand: {
    position: 'absolute', left: 0, right: 0,
    top: ((WHEEL_VISIBLE - 1) / 2) * WHEEL_ITEM_H, height: WHEEL_ITEM_H,
    borderRadius: radius.sm, backgroundColor: colors.border + '55',
  },
});
