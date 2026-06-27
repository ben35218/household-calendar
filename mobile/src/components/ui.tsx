import React, { useState } from 'react';
import {
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  ActivityIndicator,
  View,
  StyleSheet,
  ViewStyle,
  StyleProp,
  Modal,
  ScrollView,
  Pressable,
  Switch as RNSwitch,
  Platform,
} from 'react-native';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../theme';

export function Button({
  title,
  onPress,
  loading,
  disabled,
  variant = 'primary',
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
}) {
  const isGhost = variant === 'ghost';
  const isDanger = variant === 'danger';
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
      style={[
        styles.btn,
        isGhost && styles.btnGhost,
        isDanger && styles.btnDanger,
        (disabled || loading) && styles.btnDisabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isGhost ? colors.primary : '#fff'} />
      ) : (
        <Text style={[styles.btnText, isGhost && styles.btnTextGhost]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

export function Input(props: TextInputProps & { label?: string }) {
  const { label, style, ...rest } = props;
  return (
    <View style={styles.inputWrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput placeholderTextColor={colors.textMuted} style={[styles.input, style]} {...rest} />
    </View>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

export function Screen({
  children,
  scroll = true,
  style,
}: {
  children: React.ReactNode;
  scroll?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  if (!scroll) return <View style={[styles.screen, style]}>{children}</View>;
  return (
    <ScrollView style={styles.screen} contentContainerStyle={[styles.screenContent, style]}>
      {children}
    </ScrollView>
  );
}

export function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Text style={styles.sectionTitle}>{children}</Text>;
}

export function Divider() {
  return <View style={styles.divider} />;
}

export function Chip({
  label,
  selected,
  onPress,
  color = colors.primary,
}: {
  label: string;
  selected?: boolean;
  onPress?: () => void;
  color?: string;
}) {
  return (
    <TouchableOpacity
      activeOpacity={onPress ? 0.7 : 1}
      onPress={onPress}
      style={[
        styles.chip,
        { borderColor: color },
        selected && { backgroundColor: color },
      ]}
    >
      <Text style={[styles.chipText, { color: selected ? '#fff' : color }]}>{label}</Text>
    </TouchableOpacity>
  );
}

// A small status pill (non-interactive), e.g. "Overdue" / "Paused".
export function Badge({ label, color = colors.textMuted }: { label: string; color?: string }) {
  return (
    <View style={[styles.badge, { backgroundColor: color + '22', borderColor: color }]}>
      <Text style={[styles.badgeText, { color }]}>{label}</Text>
    </View>
  );
}

export function SegmentedControl<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { label: string; value: T }[];
  onChange: (v: T) => void;
}) {
  return (
    <View style={styles.segment}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <TouchableOpacity
            key={opt.value}
            style={[styles.segmentBtn, active && styles.segmentBtnActive]}
            onPress={() => onChange(opt.value)}
            activeOpacity={0.8}
          >
            <Text style={[styles.segmentText, active && styles.segmentTextActive]}>{opt.label}</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
}

export function SwitchRow({
  label,
  value,
  onValueChange,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
}) {
  return (
    <View style={styles.switchRow}>
      <Text style={styles.switchLabel}>{label}</Text>
      <RNSwitch
        value={value}
        onValueChange={onValueChange}
        trackColor={{ true: colors.primary }}
      />
    </View>
  );
}

// A tappable detail/list row with optional leading icon and trailing content.
export function ListRow({
  icon,
  title,
  subtitle,
  onPress,
  right,
  iconColor = colors.textMuted,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string | null;
  onPress?: () => void;
  right?: React.ReactNode;
  iconColor?: string;
}) {
  const Wrapper: any = onPress ? TouchableOpacity : View;
  return (
    <Wrapper style={styles.listRow} onPress={onPress} activeOpacity={0.7}>
      {icon ? <Ionicons name={icon} size={20} color={iconColor} style={styles.listRowIcon} /> : null}
      <View style={styles.listRowText}>
        <Text style={styles.listRowTitle}>{title}</Text>
        {subtitle ? <Text style={styles.listRowSubtitle}>{subtitle}</Text> : null}
      </View>
      {right}
      {onPress && !right ? (
        <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
      ) : null}
    </Wrapper>
  );
}

export interface Option<T> {
  label: string;
  value: T;
}

// A labeled field that opens a modal option list. Supports single or multi
// select; replaces Vuetify's <v-select>.
export function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
  placeholder = 'Select…',
  clearable,
  disabled,
  multiple,
  values,
  onChangeMultiple,
}: {
  label?: string;
  value?: T | null;
  options: Option<T>[];
  onChange?: (v: T | null) => void;
  placeholder?: string;
  clearable?: boolean;
  disabled?: boolean;
  multiple?: boolean;
  values?: T[];
  onChangeMultiple?: (v: T[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const selectedLabel = multiple
    ? options.filter((o) => values?.includes(o.value)).map((o) => o.label).join(', ')
    : options.find((o) => o.value === value)?.label;

  const toggleMulti = (v: T) => {
    const set = new Set(values || []);
    if (set.has(v)) set.delete(v);
    else set.add(v);
    onChangeMultiple?.(Array.from(set));
  };

  return (
    <View style={styles.inputWrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity
        style={[styles.input, styles.selectField, disabled && styles.btnDisabled]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
        disabled={disabled}
      >
        <Text style={[styles.selectValue, !selectedLabel && styles.selectPlaceholder]} numberOfLines={1}>
          {selectedLabel || placeholder}
        </Text>
        <Ionicons name="chevron-down" size={18} color={colors.textMuted} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            {label ? <Text style={styles.modalTitle}>{label}</Text> : null}
            <ScrollView style={styles.modalList}>
              {clearable && !multiple ? (
                <TouchableOpacity
                  style={styles.optionRow}
                  onPress={() => {
                    onChange?.(null);
                    setOpen(false);
                  }}
                >
                  <Text style={[styles.optionText, styles.selectPlaceholder]}>{placeholder}</Text>
                  {value == null ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
                </TouchableOpacity>
              ) : null}
              {options.map((opt) => {
                const isSel = multiple ? values?.includes(opt.value) : opt.value === value;
                return (
                  <TouchableOpacity
                    key={String(opt.value)}
                    style={styles.optionRow}
                    onPress={() => {
                      if (multiple) {
                        toggleMulti(opt.value);
                      } else {
                        onChange?.(opt.value);
                        setOpen(false);
                      }
                    }}
                  >
                    <Text style={styles.optionText}>{opt.label}</Text>
                    {isSel ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
            {multiple ? <Button title="Done" onPress={() => setOpen(false)} /> : null}
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

// ---- Date / Time pickers --------------------------------------------------
// Drop-in replacements for the plain YYYY-MM-DD / HH:MM text inputs. They keep
// the same value contract (emit `YYYY-MM-DD` for dates, `HH:MM` for times) so
// call sites only swap the component. iOS shows a spinner in a modal sheet
// (Done commits the shown value); Android uses the native dialog.

function pad2(n: number) {
  return String(n).padStart(2, '0');
}

// Parse a `YYYY-MM-DD` string at local noon to avoid TZ day-rollover.
function parseDateValue(value?: string): Date {
  if (value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
    if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12, 0, 0);
  }
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  return d;
}

function formatDateValue(d: Date): string {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function parseTimeValue(value?: string): Date {
  const d = new Date();
  if (value) {
    const m = /^(\d{1,2}):(\d{2})/.exec(value);
    if (m) d.setHours(Number(m[1]), Number(m[2]), 0, 0);
  }
  return d;
}

function formatTimeValue(d: Date): string {
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

function friendlyDate(value: string): string {
  return parseDateValue(value).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function DateTimeField({
  mode,
  label,
  value,
  onChange,
  placeholder,
  clearable,
  minimumDate,
  maximumDate,
}: {
  mode: 'date' | 'time';
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  clearable?: boolean;
  minimumDate?: Date;
  maximumDate?: Date;
}) {
  const [open, setOpen] = useState(false);
  const [temp, setTemp] = useState<Date>(new Date());
  const isDate = mode === 'date';

  const display = value
    ? isDate
      ? friendlyDate(value)
      : value
    : placeholder || (isDate ? 'Select date' : 'Select time');

  const emit = (d: Date) => onChange(isDate ? formatDateValue(d) : formatTimeValue(d));

  const openPicker = () => {
    setTemp(isDate ? parseDateValue(value) : parseTimeValue(value));
    setOpen(true);
  };

  const onAndroidChange = (e: DateTimePickerEvent, d?: Date) => {
    setOpen(false);
    if (e.type === 'set' && d) emit(d);
  };

  return (
    <View style={styles.inputWrap}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity
        style={[styles.input, styles.selectField]}
        onPress={openPicker}
        activeOpacity={0.7}
      >
        <Text style={[styles.selectValue, !value && styles.selectPlaceholder]} numberOfLines={1}>
          {display}
        </Text>
        <View style={styles.dateFieldIcons}>
          {clearable && value ? (
            <TouchableOpacity onPress={() => onChange('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} style={{ marginRight: 6 }} />
            </TouchableOpacity>
          ) : null}
          <Ionicons name={isDate ? 'calendar-outline' : 'time-outline'} size={18} color={colors.textMuted} />
        </View>
      </TouchableOpacity>

      {open && Platform.OS === 'android' ? (
        <DateTimePicker
          value={temp}
          mode={mode}
          display="default"
          onChange={onAndroidChange}
          minimumDate={minimumDate}
          maximumDate={maximumDate}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
            <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
              {label ? <Text style={styles.modalTitle}>{label}</Text> : null}
              <DateTimePicker
                value={temp}
                mode={mode}
                display="spinner"
                onChange={(_, d) => d && setTemp(d)}
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                style={styles.iosPicker}
              />
              <Button
                title="Done"
                onPress={() => {
                  emit(temp);
                  setOpen(false);
                }}
              />
            </Pressable>
          </Pressable>
        </Modal>
      ) : null}
    </View>
  );
}

export function DateField(props: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  clearable?: boolean;
  minimumDate?: Date;
  maximumDate?: Date;
}) {
  return <DateTimeField mode="date" {...props} />;
}

export function TimeField(props: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  clearable?: boolean;
}) {
  return <DateTimeField mode="time" {...props} />;
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary },
  btnDanger: { backgroundColor: colors.error },
  btnDisabled: { opacity: 0.6 },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  btnTextGhost: { color: colors.primary },
  inputWrap: { marginBottom: spacing.md },
  label: { fontSize: 13, color: colors.textMuted, marginBottom: 6, fontWeight: '500' },
  input: {
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.md,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  screen: { flex: 1, backgroundColor: colors.background },
  screenContent: { padding: spacing.md },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: colors.text,
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  divider: { height: 1, backgroundColor: colors.border, marginVertical: spacing.sm },
  chip: {
    borderWidth: 1,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
    marginRight: 6,
    marginBottom: 6,
  },
  chipText: { fontSize: 13, fontWeight: '600' },
  badge: {
    borderWidth: 1,
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 2,
    alignSelf: 'flex-start',
  },
  badgeText: { fontSize: 12, fontWeight: '600' },
  segment: {
    flexDirection: 'row',
    backgroundColor: colors.border + '66',
    borderRadius: radius.md,
    padding: 3,
  },
  segmentBtn: { flex: 1, paddingVertical: 8, alignItems: 'center', borderRadius: radius.sm },
  segmentBtnActive: { backgroundColor: colors.surface, shadowOpacity: 0.1, shadowRadius: 2, elevation: 1 },
  segmentText: { fontSize: 14, fontWeight: '600', color: colors.textMuted },
  segmentTextActive: { color: colors.text },
  switchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  switchLabel: { flex: 1, fontSize: 15, color: colors.text, marginRight: spacing.md },
  listRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: spacing.md,
  },
  listRowIcon: { marginRight: spacing.md },
  listRowText: { flex: 1 },
  listRowTitle: { fontSize: 15, color: colors.text, fontWeight: '500' },
  listRowSubtitle: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  selectField: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  dateFieldIcons: { flexDirection: 'row', alignItems: 'center' },
  iosPicker: { alignSelf: 'stretch' },
  selectValue: { fontSize: 16, color: colors.text, flex: 1 },
  selectPlaceholder: { color: colors.textMuted },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  modalSheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.md,
    maxHeight: '70%',
  },
  modalTitle: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  modalList: { marginBottom: spacing.sm },
  optionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  optionText: { fontSize: 16, color: colors.text, flex: 1 },
});
