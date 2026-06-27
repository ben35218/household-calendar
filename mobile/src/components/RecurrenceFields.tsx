import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Input, Select, SegmentedControl, Chip, SectionTitle } from './ui';
import {
  RecurrenceForm,
  MonthlyMode,
  RECURRENCE_TYPE_OPTIONS,
  INTERVAL_UNIT_OPTIONS,
  WEEK_OF_MONTH_OPTIONS,
  MONTH_OPTIONS,
  WEEKDAYS,
  recurrencePreview,
} from '../lib/recurrence';
import { colors, spacing } from '../theme';

// The recurrence builder shared by TaskFormScreen and ChoreFormScreen — mirrors
// the interval/calendar/one-time editor from the web TaskFormView/ChoreFormView.
export default function RecurrenceFields({
  form,
  monthlyMode,
  onChange,
  onChangeMonthlyMode,
}: {
  form: RecurrenceForm;
  monthlyMode: MonthlyMode;
  onChange: (patch: Partial<RecurrenceForm>) => void;
  onChangeMonthlyMode: (m: MonthlyMode) => void;
}) {
  const preview = recurrencePreview(form, monthlyMode);

  return (
    <View>
      <SectionTitle>Recurrence</SectionTitle>

      <Select
        label="Type"
        value={form.type}
        options={RECURRENCE_TYPE_OPTIONS}
        onChange={(v) => onChange({ type: (v as RecurrenceForm['type']) ?? 'interval' })}
      />

      {form.type === 'interval' ? (
        <>
          <View style={styles.cols}>
            <View style={styles.col}>
              <Input
                label="Every"
                keyboardType="numeric"
                value={String(form.intervalValue ?? '')}
                onChangeText={(v) => onChange({ intervalValue: Number(v) || 1 })}
              />
            </View>
            <View style={styles.col}>
              <Select
                label="Unit"
                value={form.intervalUnit}
                options={INTERVAL_UNIT_OPTIONS}
                onChange={(v) => onChange({ intervalUnit: (v as RecurrenceForm['intervalUnit']) ?? 'weeks' })}
              />
            </View>
          </View>

          {form.intervalUnit === 'weeks' ? (
            <WeekdayChips
              value={form.dayOfWeek}
              onChange={(d) => onChange({ dayOfWeek: form.dayOfWeek === d ? null : d })}
              label="On (optional)"
            />
          ) : null}

          {form.intervalUnit === 'months' ? (
            <>
              <Text style={styles.fieldLabel}>On (optional)</Text>
              <SegmentedControl<MonthlyMode>
                value={monthlyMode}
                onChange={onChangeMonthlyMode}
                options={[
                  { label: 'Specific day', value: 'day' },
                  { label: 'Day of week', value: 'weekday' },
                ]}
              />
              <View style={{ height: spacing.md }} />
              {monthlyMode === 'day' ? (
                <Input
                  label="Day of month"
                  keyboardType="numeric"
                  value={form.dayOfMonth != null ? String(form.dayOfMonth) : ''}
                  onChangeText={(v) => onChange({ dayOfMonth: v ? Number(v) : null })}
                />
              ) : (
                <>
                  <Select
                    label="Which occurrence"
                    value={form.weekOfMonth ?? undefined}
                    options={WEEK_OF_MONTH_OPTIONS}
                    onChange={(v) => onChange({ weekOfMonth: (v as number) ?? null })}
                  />
                  <WeekdayChips
                    value={form.dayOfWeek}
                    onChange={(d) => onChange({ dayOfWeek: d })}
                    label="Weekday"
                  />
                </>
              )}
            </>
          ) : null}

          {form.intervalUnit === 'years' ? (
            <View style={styles.cols}>
              <View style={styles.col}>
                <Select
                  label="In month (optional)"
                  clearable
                  value={form.months?.[0] ?? undefined}
                  options={MONTH_OPTIONS}
                  onChange={(v) => onChange({ months: v ? [v as number] : [] })}
                />
              </View>
              <View style={styles.col}>
                <Input
                  label="On day (optional)"
                  keyboardType="numeric"
                  value={form.dayOfMonth != null ? String(form.dayOfMonth) : ''}
                  onChangeText={(v) => onChange({ dayOfMonth: v ? Number(v) : null })}
                />
              </View>
            </View>
          ) : null}
        </>
      ) : null}

      {form.type === 'calendar' ? (
        <>
          <Select
            label="Months"
            multiple
            values={form.months}
            options={MONTH_OPTIONS}
            onChangeMultiple={(v) => onChange({ months: (v as number[]).sort((a, b) => a - b) })}
          />
          <Input
            label="On day of month"
            keyboardType="numeric"
            value={form.dayOfMonth != null ? String(form.dayOfMonth) : ''}
            onChangeText={(v) => onChange({ dayOfMonth: v ? Number(v) : null })}
          />
        </>
      ) : null}

      {preview ? (
        <View style={styles.preview}>
          <Text style={styles.previewText}>{preview}</Text>
        </View>
      ) : null}
    </View>
  );
}

function WeekdayChips({
  value,
  onChange,
  label,
}: {
  value: number | null;
  onChange: (d: number) => void;
  label: string;
}) {
  return (
    <View style={{ marginBottom: spacing.md }}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <View style={styles.chipRow}>
        {WEEKDAYS.map((d, i) => (
          <Chip key={i} label={d} selected={value === i} onPress={() => onChange(i)} />
        ))}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  cols: { flexDirection: 'row', gap: spacing.md },
  col: { flex: 1 },
  fieldLabel: { fontSize: 13, color: colors.textMuted, marginBottom: 6, fontWeight: '500' },
  chipRow: { flexDirection: 'row', flexWrap: 'wrap' },
  preview: {
    backgroundColor: colors.primary + '14',
    borderRadius: 8,
    padding: spacing.sm,
    marginBottom: spacing.md,
  },
  previewText: { color: colors.primaryDark, fontSize: 14, fontWeight: '500' },
});
