import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { choresApi, peopleApi, settingsApi } from '../../api';
import { useAuth } from '../../store/auth';
import { Button, Input, Select, Screen, SectionTitle, DateField } from '../../components/ui';
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
  const { id } = useRoute<Rt>().params || {};
  const isEdit = !!id;
  const qc = useQueryClient();
  const { user } = useAuth();

  const [form, setForm] = useState<ChoreFormState>(EMPTY);
  const [rec, setRec] = useState<RecurrenceForm>(makeRecurrenceForm({ intervalValue: 1, intervalUnit: 'weeks' }));
  const [monthlyMode, setMonthlyMode] = useState<MonthlyMode>('day');
  const [error, setError] = useState('');

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit Chore' : 'Add Chore' });
  }, [navigation, isEdit]);

  const set = (patch: Partial<ChoreFormState>) => setForm((f) => ({ ...f, ...patch }));

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

  const choreQ = useQuery({
    queryKey: ['chores', id],
    queryFn: async () => (await choresApi.get(id!)).data,
    enabled: isEdit,
  });

  useEffect(() => {
    if (!choreQ.data) return;
    const c = choreQ.data;
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
  }, [choreQ.data]);

  const save = useMutation({
    mutationFn: () => {
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
      return isEdit ? choresApi.update(id!, payload) : choresApi.create(payload);
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

  if (isEdit && choreQ.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <Screen>
      <Input label="Chore Title *" value={form.title} onChangeText={(v) => set({ title: v })} />
      <Input label="Instructions" value={form.instructions} onChangeText={(v) => set({ instructions: v })} multiline />

      <Select
        label="Assigned to"
        clearable
        placeholder="Unassigned"
        value={form.assignedTo ?? undefined}
        options={familyOptions}
        onChange={(v) => set({ assignedTo: (v as string) ?? null })}
      />

      <Text style={styles.fieldLabel}>Icon</Text>
      <View style={styles.iconGrid}>
        {CHORE_ICONS.map((name) => {
          const selected = mdiName(form.icon) === name;
          return (
            <TouchableOpacity
              key={name}
              style={[styles.iconOption, selected && styles.iconOptionSelected]}
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

      <View style={styles.footer}>
        <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} />
        <View style={{ flex: 1 }}>
          <Button title={isEdit ? 'Save Changes' : 'Create Chore'} loading={save.isPending} onPress={onSave} />
        </View>
      </View>
    </Screen>
  );
}

const CHORE_ORANGE = '#F57C00';

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  fieldLabel: { fontSize: 13, color: colors.textMuted, marginBottom: 6, fontWeight: '500' },
  iconGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: spacing.md },
  iconOption: {
    width: 44,
    height: 44,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconOptionSelected: { backgroundColor: CHORE_ORANGE, borderColor: CHORE_ORANGE },
  error: { color: colors.error, marginVertical: spacing.sm },
  footer: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.xl, alignItems: 'center' },
});
