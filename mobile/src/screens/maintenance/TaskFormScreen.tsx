import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { tasksApi, categoriesApi, itemsApi, settingsApi, FormAssistField } from '../../api';
import { sealNew, sealUpdate, openRecord } from '../../lib/e2ee';

// Encrypted task content (refs/dates/recurrence stay plaintext for the server).
const TASK_ENC = (p: Record<string, unknown>) => ({
  title: p.title, description: p.description,
});
import { Input, Select, Screen, SectionTitle, DateField, useHeaderCheckButton } from '../../components/ui';
import { form as fs, GroupCard, CardDivider } from '../../components/formStyles';
import { useCalendarColors } from '../../lib/calendarPrefs';
import FormAssist from '../../components/FormAssist';
import { useFormAssist } from '../../hooks/useFormAssist';
import {
  recurrenceToRule,
  ruleToRecurrence,
  ALERT_DAY_OPTIONS,
  AUDIENCE_OPTIONS,
} from '../../lib/recurrence';
import { RepeatRule, EMPTY_REPEAT, FREQ_OPTIONS, isCustomRule, repeatSummary } from '../../lib/eventRepeat';
import { useRepeatDraft, clearRepeatDraft } from '../../lib/repeatDraft';
import { MaintenanceStackParamList } from '../../navigation/MaintenanceNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<MaintenanceStackParamList, 'TaskForm'>;
type Rt = RouteProp<MaintenanceStackParamList, 'TaskForm'>;

// Simple Repeat options + a Custom row that opens the shared Repeat screen. A
// custom rule keeps the select on CUSTOM_REPEAT, labelled with its summary.
const REPEAT_OPTIONS = [{ label: 'Never', value: '' }, ...FREQ_OPTIONS];
const CUSTOM_REPEAT = 'custom';

interface TaskForm {
  title: string;
  categoryId: string | null;
  subcategoryId: string | null;
  itemId: string | null;
  description: string;
  nextDueDate: string;
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
  nextDueDate: '',
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
  // Recurrence is edited on the shared calendar Repeat screen; we hold its rule
  // here and convert to/from the task recurrence shape on load/save.
  const [repeatRule, setRepeatRule] = useState<RepeatRule>({ ...EMPTY_REPEAT, freq: 'monthly', interval: 3 });
  const [error, setError] = useState('');
  const assist = useFormAssist();

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit Task' : 'Add Task' });
  }, [navigation, isEdit]);

  // Edits made on the pushed Repeat screen sync back live via the draft store.
  const repeatDraft = useRepeatDraft();
  useEffect(() => {
    if (repeatDraft) setRepeatRule(repeatDraft);
  }, [repeatDraft]);
  useEffect(() => () => clearRepeatDraft(), []);

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
      nextDueDate: t.nextDueDate ? t.nextDueDate.slice(0, 10) : '',
      reminderDaysBefore: t.reminderDaysBefore ?? 0,
      alert2DaysBefore: t.alert2DaysBefore ?? null,
      alertAudience: t.alertAudience ?? 'everyone',
    });
    setRepeatRule(recurrenceToRule(t.recurrence));
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
      { name: 'nextDueDate', type: 'date', label: 'Next Due Date' },
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
      if ((form as any)[k] !== v) changedKeys.push(k);
      (next as any)[k] = v;
    }
    setForm((f) => ({ ...f, ...next }));
    assist.mark(changedKeys);
  };

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        title: form.title,
        description: form.description,
        reminderDaysBefore: form.reminderDaysBefore,
        alert2DaysBefore: form.reminderDaysBefore == null ? null : form.alert2DaysBefore,
        alertAudience: form.alertAudience,
        recurrence: ruleToRecurrence(repeatRule),
      };
      if (form.categoryId) payload.categoryId = form.categoryId;
      if (form.subcategoryId) payload.subcategoryId = form.subcategoryId;
      if (form.itemId) payload.itemId = form.itemId;
      if (form.nextDueDate) payload.nextDueDate = form.nextDueDate;
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

  // Repeat select: a custom rule ("every 2 weeks on Monday") selects the Custom
  // row, labelled with the rule's summary; tapping it reopens the Repeat screen.
  const customRepeatActive = isCustomRule(repeatRule);
  const repeatItems = [
    ...REPEAT_OPTIONS,
    { label: customRepeatActive ? repeatSummary(repeatRule) : 'Custom…', value: CUSTOM_REPEAT },
  ];
  const repeatValue = customRepeatActive ? CUSTOM_REPEAT : repeatRule.freq;
  const openRepeatScreen = () =>
    navigation.navigate('EventRepeat', {
      rule: repeatRule,
      date: form.nextDueDate || new Date().toISOString().slice(0, 10),
    });

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
        placeholder={'Describe the task, e.g. "replace the furnace filter every 3 months"'}
        fields={assistFields}
        current={{ ...form }}
        onApply={applyPatch}
      />

      <GroupCard>
        <Input
          value={form.title}
          onChangeText={(v) => set({ title: v })}
          placeholder="Task Title"
          containerStyle={fs.headField}
          style={[fs.headInput, assist.changed.has('title') && fs.headInputHighlight]}
        />
        <CardDivider />
        <Input
          value={form.description}
          onChangeText={(v) => set({ description: v })}
          multiline
          placeholder="Add a description…"
          containerStyle={fs.headField}
          style={[fs.headInput, fs.notes, assist.changed.has('description') && fs.headInputHighlight]}
        />
      </GroupCard>

      <GroupCard>
        <Select
          inlineLabel="Category"
          clearable
          placeholder="None"
          value={form.categoryId ?? undefined}
          options={(categoriesQ.data ?? []).map((c) => ({ label: c.name, value: c._id }))}
          onChange={(v) => set({ categoryId: (v as string) ?? null, subcategoryId: null })}
          highlight={assist.changed.has('categoryId')}
          containerStyle={fs.dtFieldWrap}
          fieldStyle={fs.rowField}
          valueStyle={fs.dtValue}
          chevronIcon="chevron-expand"
        />
        <CardDivider />
        <Select
          inlineLabel="Subcategory"
          clearable
          placeholder="None"
          disabled={!form.categoryId || !(subcategoriesQ.data?.length)}
          value={form.subcategoryId ?? undefined}
          options={(subcategoriesQ.data ?? []).map((c) => ({ label: c.name, value: c._id }))}
          onChange={(v) => set({ subcategoryId: (v as string) ?? null })}
          highlight={assist.changed.has('subcategoryId')}
          containerStyle={fs.dtFieldWrap}
          fieldStyle={fs.rowField}
          valueStyle={fs.dtValue}
          chevronIcon="chevron-expand"
        />
        <CardDivider />
        <Select
          inlineLabel="Linked Item"
          clearable
          placeholder="None"
          value={form.itemId ?? undefined}
          options={(itemsQ.data ?? []).map((i) => ({ label: i.name, value: i._id }))}
          onChange={(v) => set({ itemId: (v as string) ?? null })}
          highlight={assist.changed.has('itemId')}
          containerStyle={fs.dtFieldWrap}
          fieldStyle={fs.rowField}
          valueStyle={fs.dtValue}
          chevronIcon="chevron-expand"
        />
      </GroupCard>

      <SectionTitle>Recurrence</SectionTitle>
      <GroupCard>
        <Select
          inlineLabel="Repeat"
          value={repeatValue}
          options={repeatItems}
          onChange={(v) => {
            if (v === CUSTOM_REPEAT) {
              openRepeatScreen();
            } else if (v) {
              // A simple frequency: reset the pattern so the summary reads e.g.
              // "Weekly" (the Repeat screen seeds a concrete pattern if reopened).
              setRepeatRule({ ...EMPTY_REPEAT, freq: v as RepeatRule['freq'], interval: 1 });
            } else {
              setRepeatRule({ ...EMPTY_REPEAT });
            }
          }}
          containerStyle={fs.dtFieldWrap}
          fieldStyle={fs.rowField}
          valueStyle={fs.dtValue}
          chevronIcon="chevron-expand"
        />
      </GroupCard>

      <GroupCard>
        <DateField
          inlineLabel="Next Due Date"
          clearable
          placeholder="None"
          value={form.nextDueDate}
          onChange={(v) => set({ nextDueDate: v })}
          highlight={assist.changed.has('nextDueDate')}
          containerStyle={fs.dtFieldWrap}
          fieldStyle={fs.rowField}
          valueStyle={fs.dtValue}
          hideIcon
        />
      </GroupCard>

      <SectionTitle>Alerts</SectionTitle>
      <GroupCard>
        <Select
          inlineLabel="Alert"
          value={form.reminderDaysBefore ?? undefined}
          options={ALERT_DAY_OPTIONS.map((o) => ({ label: o.label, value: o.value ?? -1 }))}
          onChange={(v) => set({ reminderDaysBefore: v === -1 ? null : (v as number) })}
          containerStyle={fs.dtFieldWrap}
          fieldStyle={fs.rowField}
          valueStyle={fs.dtValue}
          chevronIcon="chevron-expand"
        />
        {form.reminderDaysBefore != null ? (
          <>
            <CardDivider />
            <Select
              inlineLabel="Second alert"
              value={form.alert2DaysBefore ?? undefined}
              options={ALERT_DAY_OPTIONS.map((o) => ({ label: o.label, value: o.value ?? -1 }))}
              onChange={(v) => set({ alert2DaysBefore: v === -1 ? null : (v as number) })}
              containerStyle={fs.dtFieldWrap}
              fieldStyle={fs.rowField}
              valueStyle={fs.dtValue}
              chevronIcon="chevron-expand"
            />
          </>
        ) : null}
        {memberCount > 1 && form.reminderDaysBefore != null ? (
          <>
            <CardDivider />
            <Select
              inlineLabel="Alert who?"
              value={form.alertAudience}
              options={AUDIENCE_OPTIONS}
              onChange={(v) => set({ alertAudience: (v as string) ?? 'everyone' })}
              containerStyle={fs.dtFieldWrap}
              fieldStyle={fs.rowField}
              valueStyle={fs.dtValue}
              chevronIcon="chevron-expand"
            />
          </>
        ) : null}
      </GroupCard>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  error: { color: colors.error, marginVertical: spacing.sm },
});
