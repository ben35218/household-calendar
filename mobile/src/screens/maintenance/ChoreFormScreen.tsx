import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { choresApi, peopleApi, settingsApi, FormAssistField } from '../../api';
import { sealNew, sealUpdate, openRecord } from '../../lib/e2ee';

// Encrypted chore content (assignedTo/icon/dates stay plaintext).
const CHORE_ENC = (p: Record<string, unknown>) => ({ title: p.title, instructions: p.instructions });
import { useAuth } from '../../store/auth';
import { Input, Select, Screen, SectionTitle, DateField, useHeaderCheckButton } from '../../components/ui';
import { form as fs, GroupCard, CardDivider } from '../../components/formStyles';
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
  mdiName,
} from '../../lib/recurrence';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { MaintenanceStackParamList } from '../../navigation/MaintenanceNavigator';
import { colors, radius, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<MaintenanceStackParamList, 'ChoreForm'>;
type Rt = RouteProp<MaintenanceStackParamList, 'ChoreForm'>;

// Ported from ChoreFormView's CHORE_ICONS (mdi- prefix stripped for RN).
const CHORE_ICONS = [
  'broom', 'washing-machine', 'dishwasher', 'trash-can', 'recycle', 'shower',
  'toilet', 'flower', 'leaf', 'grass', 'wrench', 'window-closed',
  'food-fork-drink', 'cart', 'car', 'dog', 'bed', 'sofa', 'fridge',
  'lightbulb', 'water', 'bucket', 'spray', 'vacuum', 'microwave', 'fire',
  'mailbox-outline', 'pill', 'garage',
];

interface ChoreFormState {
  title: string;
  instructions: string;
  icon: string;
  assignedTo: string | null;
  nextDueDate: string;
  reminderDaysBefore: number | null;
  alert2DaysBefore: number | null;
  alertAudience: string;
}

const EMPTY: ChoreFormState = {
  title: '',
  instructions: '',
  icon: 'mdi-broom',
  assignedTo: null,
  nextDueDate: '',
  reminderDaysBefore: 0,
  alert2DaysBefore: null,
  alertAudience: 'everyone',
};

export default function ChoreFormScreen() {
  const navigation = useNavigation<Nav>();
  const accent = useCalendarColors().colors.chores;
  const { id } = useRoute<Rt>().params || {};
  const isEdit = !!id;
  const qc = useQueryClient();
  const { user } = useAuth();

  const [form, setForm] = useState<ChoreFormState>(EMPTY);
  const [rec, setRec] = useState<RecurrenceForm>(makeRecurrenceForm({ intervalValue: 1, intervalUnit: 'weeks' }));
  const [monthlyMode, setMonthlyMode] = useState<MonthlyMode>('day');
  const [error, setError] = useState('');
  const assist = useFormAssist();

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit Chore' : 'Add Chore' });
  }, [navigation, isEdit]);

  const set = (patch: Partial<ChoreFormState>) => {
    setForm((f) => ({ ...f, ...patch }));
    assist.clear(Object.keys(patch));
  };

  const peopleQ = useQuery({ queryKey: ['people'], queryFn: async () => (await peopleApi.list()).data });
  const settingsQ = useQuery({ queryKey: ['settings'], queryFn: async () => (await settingsApi.get()).data });
  const memberCount = settingsQ.data?.householdMemberCount ?? 1;

  const myId = String(user?._id ?? '');
  const familyOptions = (peopleQ.data ?? [])
    .filter((p) => p.type === 'family')
    .map((p) => ({
      value: p._id,
      label: p.accountId && String(p.accountId) === myId ? `${p.name} (You)` : p.name,
    }));

  const assistFields: FormAssistField[] = [
    { name: 'title', type: 'text', label: 'Chore title' },
    { name: 'instructions', type: 'text', label: 'Instructions' },
    { name: 'assignedTo', type: 'select', label: 'Assigned to', options: familyOptions },
    { name: 'nextDueDate', type: 'date', label: 'Next due date' },
  ];

  const applyPatch = (patch: Record<string, unknown>) => {
    const next: Partial<ChoreFormState> = {};
    const changedKeys: string[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in EMPTY)) continue;
      if ((form as any)[k] !== v) changedKeys.push(k);
      (next as any)[k] = v;
    }
    setForm((f) => ({ ...f, ...next }));
    assist.mark(changedKeys);
  };

  const choreQ = useQuery({
    queryKey: ['chores', id],
    queryFn: async () => (await choresApi.get(id!)).data,
    enabled: isEdit,
  });

  useEffect(() => {
    if (!choreQ.data) return;
    let cancelled = false;
    (async () => {
    const c = await openRecord('Chore', choreQ.data); // decrypt content over plaintext
    if (cancelled) return;
    const assignedTo =
      typeof c.assignedTo === 'object' && c.assignedTo ? c.assignedTo._id ?? null : (c.assignedTo as string) ?? null;
    setForm({
      title: c.title ?? '',
      instructions: c.instructions ?? c.description ?? '',
      icon: c.icon || 'mdi-broom',
      assignedTo,
      nextDueDate: c.nextDueDate ? c.nextDueDate.slice(0, 10) : '',
      reminderDaysBefore: c.reminderDaysBefore ?? 0,
      alert2DaysBefore: c.alert2DaysBefore ?? null,
      alertAudience: c.alertAudience ?? 'everyone',
    });
    const { form: rf, monthlyMode: mm } = recurrenceToForm(c.recurrence, { intervalValue: 1, intervalUnit: 'weeks' });
    setRec(rf);
    setMonthlyMode(mm);
    })();
    return () => { cancelled = true; };
  }, [choreQ.data]);

  const save = useMutation({
    mutationFn: async () => {
      const payload: Record<string, unknown> = {
        title: form.title,
        instructions: form.instructions,
        icon: form.icon,
        assignedTo: form.assignedTo || null,
        reminderDaysBefore: form.reminderDaysBefore,
        alert2DaysBefore: form.reminderDaysBefore == null ? null : form.alert2DaysBefore,
        alertAudience: form.alertAudience,
        recurrence: buildRecurrencePayload(rec, monthlyMode),
      };
      if (form.nextDueDate) payload.nextDueDate = form.nextDueDate;
      return isEdit
        ? choresApi.update(id!, await sealUpdate('Chore', id!, payload, CHORE_ENC(payload)))
        : choresApi.create(await sealNew('Chore', payload, CHORE_ENC(payload)));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['chores'] });
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

  if (isEdit && choreQ.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Screen>
      <FormAssist
        formType="household chore"
        placeholder={'Describe the chore, e.g. "take out the recycling every Sunday, assign to Alex"'}
        fields={assistFields}
        current={{ ...form }}
        onApply={applyPatch}
      />

      <GroupCard>
        <Input
          value={form.title}
          onChangeText={(v) => set({ title: v })}
          placeholder="Chore Title"
          containerStyle={fs.headField}
          style={[fs.headInput, assist.changed.has('title') && fs.headInputHighlight]}
        />
      </GroupCard>

      <SectionTitle>Instructions</SectionTitle>
      <Input
        value={form.instructions}
        onChangeText={(v) => set({ instructions: v })}
        multiline
        placeholder="Add instructions…"
        style={fs.notes}
        highlight={assist.changed.has('instructions')}
      />

      <GroupCard>
        <Select
          inlineLabel="Assigned to"
          clearable
          placeholder="Unassigned"
          value={form.assignedTo ?? undefined}
          options={familyOptions}
          onChange={(v) => set({ assignedTo: (v as string) ?? null })}
          highlight={assist.changed.has('assignedTo')}
          containerStyle={fs.dtFieldWrap}
          fieldStyle={fs.rowField}
          valueStyle={fs.dtValue}
          chevronIcon="chevron-expand"
        />
      </GroupCard>

      <SectionTitle>Icon</SectionTitle>
      <GroupCard>
        <View style={styles.iconGrid}>
          {CHORE_ICONS.map((name) => {
            const selected = mdiName(form.icon) === name;
            return (
              <TouchableOpacity
                key={name}
                style={[styles.iconOption, selected && { backgroundColor: accent, borderColor: accent }]}
                onPress={() => set({ icon: `mdi-${name}` })}
              >
                <MaterialCommunityIcons
                  name={name as any}
                  size={22}
                  color={selected ? '#fff' : colors.textMuted}
                />
              </TouchableOpacity>
            );
          })}
        </View>
      </GroupCard>

      <RecurrenceFields
        form={rec}
        monthlyMode={monthlyMode}
        onChange={(patch) => setRec((r) => ({ ...r, ...patch }))}
        onChangeMonthlyMode={setMonthlyMode}
      />

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
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, padding: 14 },
  iconOption: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  error: { color: colors.error, marginVertical: spacing.sm },
});
