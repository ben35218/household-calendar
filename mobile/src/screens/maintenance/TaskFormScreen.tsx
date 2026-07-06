import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { tasksApi, categoriesApi, itemsApi, settingsApi, FormAssistField } from '../../api';
import { sealNew, sealUpdate, openRecord } from '../../lib/e2ee';

// Encrypted task content (refs/dates/recurrence stay plaintext for the server).
const TASK_ENC = (p: Record<string, unknown>) => ({
  title: p.title, description: p.description, instructions: p.instructions,
  estimatedCost: p.estimatedCost, estimatedDurationMins: p.estimatedDurationMins,
});
import { Input, Select, Screen, SwitchRow, SectionTitle, DateField, useHeaderCheckButton } from '../../components/ui';
import { useCalendarColors } from '../../lib/calendarPrefs';
import FormAssist from '../../components/FormAssist';
import { useFormAssist } from '../../hooks/useFormAssist';
import RecurrenceFields from '../../components/RecurrenceFields';
import {
  RecurrenceForm,
  MonthlyMode,
  makeRecurrenceForm,
  recurrenceToForm,
  buildRecurrencePayload,
  ALERT_DAY_OPTIONS,
  AUDIENCE_OPTIONS,
} from '../../lib/recurrence';
import { MaintenanceStackParamList } from '../../navigation/MaintenanceNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<MaintenanceStackParamList, 'TaskForm'>;
type Rt = RouteProp<MaintenanceStackParamList, 'TaskForm'>;

const PRIORITY_OPTIONS = [
  { label: 'Low', value: 'low' },
  { label: 'Medium', value: 'medium' },
  { label: 'High', value: 'high' },
];

interface TaskForm {
  title: string;
  categoryId: string | null;
  subcategoryId: string | null;
  itemId: string | null;
  description: string;
  instructions: string;
  priority: string;
  estimatedDurationMins: string;
  estimatedCost: string;
  nextDueDate: string;
  weatherSensitive: boolean;
  reminderDaysBefore: number | null;
  alert2DaysBefore: number | null;
  alertAudience: string;
}

const EMPTY: TaskForm = {
  title: '',
  categoryId: null,
  subcategoryId: null,
  itemId: null,
  description: '',
  instructions: '',
  priority: 'medium',
  estimatedDurationMins: '',
  estimatedCost: '',
  nextDueDate: '',
  weatherSensitive: false,
  reminderDaysBefore: 0,
  alert2DaysBefore: null,
  alertAudience: 'everyone',
};

export default function TaskFormScreen() {
  const navigation = useNavigation<Nav>();
  const { id } = useRoute<Rt>().params || {};
  const isEdit = !!id;
  const qc = useQueryClient();
  const accent = useCalendarColors().colors.maintenance;

  const [form, setForm] = useState<TaskForm>(EMPTY);
  const [rec, setRec] = useState<RecurrenceForm>(makeRecurrenceForm({ intervalValue: 3, intervalUnit: 'months' }));
  const [monthlyMode, setMonthlyMode] = useState<MonthlyMode>('day');
  const [error, setError] = useState('');
  const assist = useFormAssist();

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit Task' : 'Add Task' });
  }, [navigation, isEdit]);

  // Manual edits clear the "AI changed this" highlight for the touched fields.
  const set = (patch: Partial<TaskForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    assist.clear(Object.keys(patch));
  };

  const categoriesQ = useQuery({
    queryKey: ['categories', 'top'],
    queryFn: async () => (await categoriesApi.list({ topLevel: true })).data,
  });
  const itemsQ = useQuery({ queryKey: ['items', 'list'], queryFn: async () => (await itemsApi.list()).data });
  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: async () => (await settingsApi.get()).data });
  const subcategoriesQ = useQuery({
    queryKey: ['categories', 'sub', form.categoryId],
    queryFn: async () => (await categoriesApi.list({ parent: form.categoryId })).data,
    enabled: !!form.categoryId,
  });

  const memberCount = settingsQ.data?.householdMemberCount ?? 1;

  const taskQ = useQuery({
    queryKey: ['tasks', id],
    queryFn: async () => (await tasksApi.get(id!)).data,
    enabled: isEdit,
  });

  // Hydrate the form once the existing task loads.
  useEffect(() => {
    if (!taskQ.data) return;
    let cancelled = false;
    (async () => {
    const t = await openRecord('MaintenanceTask', taskQ.data); // decrypt content over plaintext
    if (cancelled) return;
    const catId = t.categoryId && typeof t.categoryId === 'object' ? t.categoryId._id : (t.categoryId as string) || null;
    const subId = t.subcategoryId && typeof t.subcategoryId === 'object' ? t.subcategoryId._id : (t.subcategoryId as string) || null;
    const itemId = t.itemId && typeof t.itemId === 'object' ? t.itemId._id : (t.itemId as string) || null;
    setForm({
      title: t.title ?? '',
      categoryId: catId,
      subcategoryId: subId,
      itemId,
      description: t.description ?? '',
      instructions: t.instructions ?? '',
      priority: t.priority ?? 'medium',
      estimatedDurationMins: t.estimatedDurationMins != null ? String(t.estimatedDurationMins) : '',
      estimatedCost: t.estimatedCost != null ? String(t.estimatedCost) : '',
      nextDueDate: t.nextDueDate ? t.nextDueDate.slice(0, 10) : '',
      weatherSensitive: t.weatherSensitive ?? false,
      reminderDaysBefore: t.reminderDaysBefore ?? 0,
      alert2DaysBefore: t.alert2DaysBefore ?? null,
      alertAudience: t.alertAudience ?? 'everyone',
    });
    const { form: rf, monthlyMode: mm } = recurrenceToForm(t.recurrence, { intervalValue: 3, intervalUnit: 'months' });
    setRec(rf);
    setMonthlyMode(mm);
    })();
    return () => { cancelled = true; };
  }, [taskQ.data]);

  // Schema the AI form assistant fills. Names match the form-state keys so the
  // returned patch can be merged directly.
  const assistFields: FormAssistField[] = useMemo(
    () => [
      { name: 'title', type: 'text', label: 'Task Title' },
      { name: 'categoryId', type: 'select', label: 'Category', options: (categoriesQ.data ?? []).map((c) => ({ label: c.name, value: c._id })) },
      { name: 'subcategoryId', type: 'select', label: 'Subcategory', options: (subcategoriesQ.data ?? []).map((c) => ({ label: c.name, value: c._id })) },
      { name: 'itemId', type: 'select', label: 'Linked Item', options: (itemsQ.data ?? []).map((i) => ({ label: i.name, value: i._id })) },
      { name: 'description', type: 'text', label: 'Description' },
      { name: 'instructions', type: 'text', label: 'How-to Instructions' },
      { name: 'priority', type: 'select', label: 'Priority', options: PRIORITY_OPTIONS },
      { name: 'estimatedDurationMins', type: 'number', label: 'Estimated Duration (minutes)' },
      { name: 'estimatedCost', type: 'number', label: 'Estimated Cost (dollars)' },
      { name: 'nextDueDate', type: 'date', label: 'Next Due Date' },
      { name: 'weatherSensitive', type: 'boolean', label: 'Weather-sensitive (show on outdoor forecast)' },
    ],
    [categoriesQ.data, subcategoriesQ.data, itemsQ.data]
  );

  // Merge an AI patch into the form, coercing numeric fields to their string
  // representation and marking the fields that actually changed for highlight.
  const applyPatch = (patch: Record<string, unknown>) => {
    const next: Partial<TaskForm> = {};
    const changedKeys: string[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in EMPTY)) continue;
      const val = k === 'estimatedDurationMins' || k === 'estimatedCost' ? (v == null ? '' : String(v)) : v;
      if ((form as any)[k] !== val) changedKeys.push(k);
      (next as any)[k] = val;
    }
    setForm((f) => ({ ...f, ...next }));
    assist.mark(changedKeys);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        title: form.title,
        description: form.description,
        instructions: form.instructions,
        priority: form.priority,
        weatherSensitive: form.weatherSensitive,
        reminderDaysBefore: form.reminderDaysBefore,
        alert2DaysBefore: form.reminderDaysBefore == null ? null : form.alert2DaysBefore,
        alertAudience: form.alertAudience,
        recurrence: buildRecurrencePayload(rec, monthlyMode),
      };
      if (form.categoryId) payload.categoryId = form.categoryId;
      if (form.subcategoryId) payload.subcategoryId = form.subcategoryId;
      if (form.itemId) payload.itemId = form.itemId;
      if (form.nextDueDate) payload.nextDueDate = form.nextDueDate;
      if (form.estimatedDurationMins) payload.estimatedDurationMins = Number(form.estimatedDurationMins);
      if (form.estimatedCost) payload.estimatedCost = Number(form.estimatedCost);
      return isEdit
        ? tasksApi.update(id!, await sealUpdate('MaintenanceTask', id!, payload, TASK_ENC(payload)))
        : tasksApi.create(await sealNew('MaintenanceTask', payload, TASK_ENC(payload)));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['tasks'] });
      navigation.goBack();
    },
    onError: (e: any) => setError(e.response?.data?.error || 'Save failed'),
  });

  const onSave = () => {
    if (!form.title.trim()) {
      setError('Title is required');
      return;
    }
    setError('');
    save.mutate();
  };

  useHeaderCheckButton(navigation, { onPress: onSave, loading: save.isPending, color: accent });

  if (isEdit && taskQ.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Screen>
      <FormAssist
        formType="home maintenance task"
        title="Maintenance Assistant"
        placeholder={'Describe the task, e.g. "replace the furnace filter every 3 months, high priority"'}
        fields={assistFields}
        current={{ ...form }}
        onApply={applyPatch}
      />

      <Input label="Task Title *" value={form.title} onChangeText={(v) => set({ title: v })} highlight={assist.changed.has('title')} />

      <Select
        label="Category"
        clearable
        value={form.categoryId ?? undefined}
        options={(categoriesQ.data ?? []).map((c) => ({ label: c.name, value: c._id }))}
        onChange={(v) => set({ categoryId: (v as string) ?? null, subcategoryId: null })}
        highlight={assist.changed.has('categoryId')}
      />
      <Select
        label="Subcategory"
        clearable
        disabled={!form.categoryId || !(subcategoriesQ.data?.length)}
        value={form.subcategoryId ?? undefined}
        options={(subcategoriesQ.data ?? []).map((c) => ({ label: c.name, value: c._id }))}
        onChange={(v) => set({ subcategoryId: (v as string) ?? null })}
        highlight={assist.changed.has('subcategoryId')}
      />
      <Select
        label="Linked Item"
        clearable
        value={form.itemId ?? undefined}
        options={(itemsQ.data ?? []).map((i) => ({ label: i.name, value: i._id }))}
        onChange={(v) => set({ itemId: (v as string) ?? null })}
        highlight={assist.changed.has('itemId')}
      />

      <Input label="Description" value={form.description} onChangeText={(v) => set({ description: v })} multiline highlight={assist.changed.has('description')} />
      <Input label="How-to Instructions" value={form.instructions} onChangeText={(v) => set({ instructions: v })} multiline highlight={assist.changed.has('instructions')} />

      <View style={styles.cols}>
        <View style={styles.col}>
          <Select
            label="Priority"
            value={form.priority}
            options={PRIORITY_OPTIONS}
            onChange={(v) => set({ priority: (v as string) ?? 'medium' })}
            highlight={assist.changed.has('priority')}
          />
        </View>
        <View style={styles.col}>
          <Input
            label="Est. Duration (min)"
            keyboardType="numeric"
            value={form.estimatedDurationMins}
            onChangeText={(v) => set({ estimatedDurationMins: v })}
            highlight={assist.changed.has('estimatedDurationMins')}
          />
        </View>
      </View>
      <Input
        label="Est. Cost ($)"
        keyboardType="numeric"
        value={form.estimatedCost}
        onChangeText={(v) => set({ estimatedCost: v })}
        highlight={assist.changed.has('estimatedCost')}
      />

      <RecurrenceFields
        form={rec}
        monthlyMode={monthlyMode}
        onChange={(patch) => setRec((r) => ({ ...r, ...patch }))}
        onChangeMonthlyMode={setMonthlyMode}
      />

      <DateField
        label="Next Due Date"
        clearable
        value={form.nextDueDate}
        onChange={(v) => set({ nextDueDate: v })}
        highlight={assist.changed.has('nextDueDate')}
      />

      <SectionTitle>Weather</SectionTitle>
      <SwitchRow
        label="Weather-sensitive (show on outdoor forecast)"
        value={form.weatherSensitive}
        onValueChange={(v) => set({ weatherSensitive: v })}
        highlight={assist.changed.has('weatherSensitive')}
      />

      <SectionTitle>Alerts</SectionTitle>
      <Select
        label="Alert"
        value={form.reminderDaysBefore ?? undefined}
        options={ALERT_DAY_OPTIONS.map((o) => ({ label: o.label, value: o.value ?? -1 }))}
        onChange={(v) => set({ reminderDaysBefore: v === -1 ? null : (v as number) })}
      />
      {form.reminderDaysBefore != null ? (
        <Select
          label="Second alert"
          value={form.alert2DaysBefore ?? undefined}
          options={ALERT_DAY_OPTIONS.map((o) => ({ label: o.label, value: o.value ?? -1 }))}
          onChange={(v) => set({ alert2DaysBefore: v === -1 ? null : (v as number) })}
        />
      ) : null}
      {memberCount > 1 && form.reminderDaysBefore != null ? (
        <Select
          label="Alert who?"
          value={form.alertAudience}
          options={AUDIENCE_OPTIONS}
          onChange={(v) => set({ alertAudience: (v as string) ?? 'everyone' })}
        />
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  cols: { flexDirection: 'row', gap: spacing.md },
  col: { flex: 1 },
  error: { color: colors.error, marginVertical: spacing.sm },
});
