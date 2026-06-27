import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { calendarApi } from '../../api';
import { Button, Input, Select, Screen, SwitchRow, SectionTitle, DateField, TimeField } from '../../components/ui';
import { EVENT_CALENDAR_TYPES } from '../../lib/calendar';
import { CalendarStackParamList } from '../../navigation/CalendarNavigator';
import { colors, spacing } from '../../theme';

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

const REPEAT_OPTIONS = [
  { label: 'Does not repeat', value: '' },
  { label: 'Daily', value: 'daily' },
  { label: 'Weekly', value: 'weekly' },
  { label: 'Monthly', value: 'monthly' },
  { label: 'Yearly', value: 'yearly' },
];

export default function EventFormScreen() {
  const navigation = useNavigation<Nav>();
  const { eventId, date } = useRoute<Rt>().params || {};
  const isEdit = !!eventId;
  const qc = useQueryClient();

  const [form, setForm] = useState({
    title: '',
    calendarType: 'activities',
    date: date || new Date().toISOString().slice(0, 10),
    endDate: '',
    allDay: true,
    startTime: '09:00',
    endTime: '10:00',
    description: '',
    location: '',
    reminderMinutes: null as number | null,
    recurrFreq: '',
  });
  const [error, setError] = useState('');

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit Event' : 'New Event' });
  }, [navigation, isEdit]);

  const eventQ = useQuery({
    queryKey: ['calendar', 'event', eventId],
    queryFn: async () => (await calendarApi.getEvent(eventId!)).data,
    enabled: isEdit,
  });
  useEffect(() => {
    if (!eventQ.data) return;
    const e = eventQ.data;
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
      reminderMinutes: e.reminderMinutes ?? null,
      recurrFreq: e.recurrence?.freq ?? '',
    });
  }, [eventQ.data]);

  const save = useMutation({
    mutationFn: () => {
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
      const payload: Record<string, unknown> = {
        title: form.title.trim(),
        calendarType: form.calendarType,
        allDay,
        startDate,
        endDate,
        description: form.description || undefined,
        location: form.location || undefined,
        reminderMinutes: form.reminderMinutes ?? undefined,
        recurrence: form.recurrFreq ? { freq: form.recurrFreq } : undefined,
      };
      return isEdit ? calendarApi.updateEvent(eventId!, payload) : calendarApi.createEvent(payload);
    },
    onSuccess: () => {
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

  const onSave = () => {
    if (!form.title.trim()) {
      setError('Title is required');
      return;
    }
    setError('');
    save.mutate();
  };

  if (isEdit && eventQ.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Screen>
      <Input label="Title *" value={form.title} onChangeText={(v) => set({ title: v })} />
      <Select label="Calendar" value={form.calendarType} options={EVENT_CALENDAR_TYPES} onChange={(v) => set({ calendarType: (v as string) ?? 'activities' })} />

      <View style={styles.cols}>
        <View style={styles.col}>
          <DateField label="Start date" value={form.date} onChange={(v) => set({ date: v })} />
        </View>
        <View style={styles.col}>
          <DateField label="End date" clearable value={form.endDate} onChange={(v) => set({ endDate: v })} />
        </View>
      </View>

      <SwitchRow label="All day" value={form.allDay} onValueChange={(v) => set({ allDay: v })} />
      {!form.allDay ? (
        <View style={styles.cols}>
          <View style={styles.col}>
            <TimeField label="Start time" value={form.startTime} onChange={(v) => set({ startTime: v })} />
          </View>
          <View style={styles.col}>
            <TimeField label="End time" clearable value={form.endTime} onChange={(v) => set({ endTime: v })} />
          </View>
        </View>
      ) : null}

      <Input label="Location" value={form.location} onChangeText={(v) => set({ location: v })} />
      <Input label="Description" value={form.description} onChangeText={(v) => set({ description: v })} multiline />

      <SectionTitle>Reminders</SectionTitle>
      <Select
        label="Alert"
        value={form.reminderMinutes ?? undefined}
        options={ALERT_OPTIONS}
        onChange={(v) => set({ reminderMinutes: v === -1 ? null : (v as number) })}
      />
      <Select label="Repeat" value={form.recurrFreq} options={REPEAT_OPTIONS} onChange={(v) => set({ recurrFreq: (v as string) ?? '' })} />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        {isEdit ? (
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
        ) : null}
        <View style={{ flex: 1 }}>
          <Button title={isEdit ? 'Save' : 'Create Event'} loading={save.isPending} onPress={onSave} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  cols: { flexDirection: 'row', gap: spacing.sm },
  col: { flex: 1 },
  error: { color: colors.error, marginVertical: spacing.sm },
  footer: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.xl, alignItems: 'center' },
});
