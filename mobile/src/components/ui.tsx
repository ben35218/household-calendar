import React, { useState, useEffect, useRef } from 'react';
import {
  Text,
  TextInput,
  TextInputProps,
  TouchableOpacity,
  ActivityIndicator,
  View,
  StyleSheet,
  ViewStyle,
  TextStyle,
  StyleProp,
  Modal,
  ScrollView,
  Pressable,
  Switch as RNSwitch,
  Platform,
} from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { Ionicons } from '@expo/vector-icons';
import { colors, radius, spacing } from '../theme';

export function Button({
  title,
  onPress,
  loading,
  disabled,
  variant = 'primary',
  color,
  compact,
}: {
  title: string;
  onPress: () => void;
  loading?: boolean;
  disabled?: boolean;
  variant?: 'primary' | 'ghost' | 'danger';
  color?: string;
  compact?: boolean;
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
        compact && styles.btnCompact,
        isGhost && styles.btnGhost,
        isDanger && styles.btnDanger,
        // Solid-variant colour override (e.g. section/calendar accent).
        color && !isGhost && !isDanger ? { backgroundColor: color } : null,
        // Ghost-variant colour override tints the outline instead of the fill.
        color && isGhost ? { borderColor: color } : null,
        (disabled || loading) && styles.btnDisabled,
      ]}
    >
      {loading ? (
        <ActivityIndicator color={isGhost ? color || colors.primary : '#fff'} />
      ) : (
        <Text style={[styles.btnText, compact && styles.btnTextCompact, isGhost && styles.btnTextGhost, isGhost && color ? { color } : null]}>{title}</Text>
      )}
    </TouchableOpacity>
  );
}

// A uniform solid-fill circular icon button. The circle is derived entirely
// from `size` (borderRadius = size/2 guarantees a true circle) and the icon is
// sized proportionally (~55%) so the fill always reads as a filled disc rather
// than a thin ring. Use size 36 for header buttons, 56 for FABs.
export function RoundIconButton({
  icon,
  onPress,
  size = 36,
  bg = colors.primary,
  color = '#fff',
  disabled,
  style,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  size?: number;
  bg?: string;
  color?: string;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled}
      activeOpacity={0.8}
      style={[
        {
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: bg,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Ionicons name={icon} size={Math.round(size * 0.55)} color={color} />
    </TouchableOpacity>
  );
}

// The checkmark that replaces a form's Save/Create button. A solid-fill circular
// disc — tinted with the view's calendar/section accent colour — with a white
// checkmark, living in the header's top-right (`headerRight`). While the save
// mutation runs it shows a spinner; `disabled` dims it.
export function HeaderCheckButton({
  onPress,
  loading,
  color = colors.primary,
  disabled,
}: {
  onPress: () => void;
  loading?: boolean;
  color?: string;
  disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.8}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel="Save"
      style={[styles.headerCheck, { backgroundColor: color }, (disabled || loading) && styles.btnDisabled]}
    >
      {loading ? (
        <ActivityIndicator size="small" color="#fff" />
      ) : (
        <Ionicons name="checkmark-sharp" size={22} color="#fff" />
      )}
    </TouchableOpacity>
  );
}

// The plain white X that dismisses a form. Replaces the native back chevron in
// the header's top-left (`headerLeft`); tapping it goes back like the chevron.
export function HeaderCloseButton({ onPress }: { onPress: () => void }) {
  return (
    <TouchableOpacity
      onPress={onPress}
      activeOpacity={0.6}
      hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
      accessibilityRole="button"
      accessibilityLabel="Close"
      style={styles.headerClose}
    >
      <Ionicons name="close" size={28} color="#fff" />
    </TouchableOpacity>
  );
}

// Installs a form's header chrome: a white X close button on the left (in place
// of the native back chevron) and the tinted checkmark save button on the right.
// `onPress` is called via a ref so the check always sees the latest form state
// (no stale closure), while the header only re-renders when its visuals change.
export function useHeaderCheckButton(
  navigation: {
    setOptions: (o: { headerLeft: () => React.ReactNode; headerRight: () => React.ReactNode }) => void;
    goBack: () => void;
  },
  {
    onPress,
    loading,
    color,
    disabled,
    // Set false to hide the checkmark entirely (e.g. a multi-step form's first
    // step where there is nothing to save yet). The X close button always shows.
    enabled = true,
  }: { onPress: () => void; loading?: boolean; color?: string; disabled?: boolean; enabled?: boolean }
) {
  const onPressRef = useRef(onPress);
  onPressRef.current = onPress;
  useEffect(() => {
    navigation.setOptions({
      headerLeft: () => <HeaderCloseButton onPress={() => navigation.goBack()} />,
      headerRight: enabled
        ? () => <HeaderCheckButton onPress={() => onPressRef.current()} loading={loading} color={color} disabled={disabled} />
        : () => null,
    });
  }, [navigation, loading, color, disabled, enabled]);
}

export function Input(props: TextInputProps & { label?: string; highlight?: boolean; containerStyle?: StyleProp<ViewStyle> }) {
  const { label, style, highlight, containerStyle, ...rest } = props;
  return (
    <View style={[styles.inputWrap, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TextInput
        placeholderTextColor={colors.textMuted}
        style={[styles.input, highlight && styles.inputHighlight, style]}
        {...rest}
      />
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
    <KeyboardAwareScrollView
      style={styles.screen}
      contentContainerStyle={[styles.screenContent, style]}
      bottomOffset={spacing.lg}
      keyboardShouldPersistTaps="handled"
    >
      {children}
    </KeyboardAwareScrollView>
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
  highlight,
  boxed,
  color,
}: {
  label: string;
  value: boolean;
  onValueChange: (v: boolean) => void;
  highlight?: boolean;
  // Render like the other form fields: a small label above a bordered box.
  boxed?: boolean;
  // On-state track tint (e.g. a calendar's colour); defaults to the app primary.
  color?: string;
}) {
  const trackColor = { true: color ?? colors.primary };
  if (boxed) {
    return (
      <View style={styles.inputWrap}>
        <View style={[styles.input, styles.selectField, highlight && styles.inputHighlight]}>
          <Text style={styles.selectValue}>{label}</Text>
          <RNSwitch value={value} onValueChange={onValueChange} trackColor={trackColor} />
        </View>
      </View>
    );
  }
  return (
    <View style={[styles.switchRow, highlight && styles.switchRowHighlight]}>
      <Text style={styles.switchLabel}>{label}</Text>
      <RNSwitch value={value} onValueChange={onValueChange} trackColor={trackColor} />
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

// A tappable section header that reveals/collapses its children — an iOS-style
// accordion menu row. The header is a rounded card; the body renders its own
// chrome (GroupCard/Card), so nothing is nested inside another card.
export function AccordionSection({
  icon,
  title,
  subtitle,
  expanded,
  onToggle,
  children,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  expanded: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  return (
    <View style={styles.accordion}>
      <TouchableOpacity
        style={styles.accordionHeader}
        onPress={onToggle}
        activeOpacity={0.7}
        accessibilityRole="button"
        accessibilityState={{ expanded }}
      >
        {icon ? <Ionicons name={icon} size={20} color={colors.primary} style={styles.accordionIcon} /> : null}
        <View style={styles.accordionTitleWrap}>
          <Text style={styles.accordionTitle}>{title}</Text>
          {subtitle ? <Text style={styles.accordionSubtitle}>{subtitle}</Text> : null}
        </View>
        <Ionicons name={expanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
      </TouchableOpacity>
      {expanded ? <View style={styles.accordionBody}>{children}</View> : null}
    </View>
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
  highlight,
  containerStyle,
  fieldStyle,
  valueStyle,
  chevronIcon,
  inlineLabel,
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
  highlight?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  fieldStyle?: StyleProp<ViewStyle>;
  valueStyle?: StyleProp<TextStyle>;
  // Override the trailing glyph (e.g. 'chevron-expand' for iOS-style menu rows).
  chevronIcon?: keyof typeof Ionicons.glyphMap;
  // Label rendered inside the touchable, left of the value — makes the whole
  // row (label included) open the picker. Also titles the option modal.
  inlineLabel?: string;
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
    <View style={[styles.inputWrap, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity
        style={[styles.input, styles.selectField, fieldStyle, highlight && styles.inputHighlight, disabled && styles.btnDisabled]}
        onPress={() => !disabled && setOpen(true)}
        activeOpacity={0.7}
        disabled={disabled}
      >
        {inlineLabel ? <Text style={styles.inlineLabel}>{inlineLabel}</Text> : null}
        <Text style={[styles.selectValue, !selectedLabel && styles.selectPlaceholder, valueStyle]} numberOfLines={1}>
          {selectedLabel || placeholder}
        </Text>
        <Ionicons name={chevronIcon ?? 'chevron-down'} size={18} color={colors.textMuted} style={styles.selectChevron} />
      </TouchableOpacity>

      <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
        <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
          <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
            {label || inlineLabel ? <Text style={styles.modalTitle}>{label || inlineLabel}</Text> : null}
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

// The stored value is 24-hour `HH:MM`; always show it as 12-hour with AM/PM.
function friendlyTime(value: string): string {
  return parseTimeValue(value).toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
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
  defaultValue,
  highlight,
  containerStyle,
  fieldStyle,
  hideIcon,
  valueStyle,
  inlineLabel,
}: {
  mode: 'date' | 'time';
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  clearable?: boolean;
  minimumDate?: Date;
  maximumDate?: Date;
  defaultValue?: string;
  highlight?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  fieldStyle?: StyleProp<ViewStyle>;
  // Drop the trailing calendar/clock glyph (compact rows show the value only).
  hideIcon?: boolean;
  // Override the value text (compact pills need `flex: 0` — the default
  // `flex: 1` collapses to zero width inside a content-sized field).
  valueStyle?: StyleProp<TextStyle>;
  // Label rendered inside the touchable, left of the value — makes the whole
  // row (label included) open the picker. Also titles the iOS modal.
  inlineLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const [temp, setTemp] = useState<Date>(new Date());
  const isDate = mode === 'date';

  const display = value
    ? isDate
      ? friendlyDate(value)
      : friendlyTime(value)
    : placeholder || (isDate ? 'Select date' : 'Select time');

  const emit = (d: Date) => onChange(isDate ? formatDateValue(d) : formatTimeValue(d));

  const openPicker = () => {
    setTemp(isDate ? parseDateValue(value || defaultValue) : parseTimeValue(value || defaultValue));
    setOpen(true);
  };

  const onAndroidChange = (e: DateTimePickerEvent, d?: Date) => {
    setOpen(false);
    if (e.type === 'set' && d) emit(d);
  };

  return (
    <View style={[styles.inputWrap, containerStyle]}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <TouchableOpacity
        // fieldStyle sits before the highlight so the AI-changed tint stays visible.
        style={[styles.input, styles.selectField, fieldStyle, highlight && styles.inputHighlight]}
        onPress={openPicker}
        activeOpacity={0.7}
      >
        {inlineLabel ? <Text style={styles.inlineLabel}>{inlineLabel}</Text> : null}
        <Text style={[styles.selectValue, !value && styles.selectPlaceholder, valueStyle]} numberOfLines={1}>
          {display}
        </Text>
        <View style={styles.dateFieldIcons}>
          {clearable && value ? (
            <TouchableOpacity onPress={() => onChange('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name="close-circle" size={18} color={colors.textMuted} style={{ marginLeft: 8, marginRight: hideIcon ? 0 : 6 }} />
            </TouchableOpacity>
          ) : null}
          {hideIcon ? null : (
            <Ionicons name={isDate ? 'calendar-outline' : 'time-outline'} size={18} color={colors.textMuted} />
          )}
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
          is24Hour={false}
        />
      ) : null}

      {Platform.OS === 'ios' ? (
        <Modal visible={open} transparent animationType="fade" onRequestClose={() => setOpen(false)}>
          <Pressable style={styles.modalBackdrop} onPress={() => setOpen(false)}>
            <Pressable style={styles.modalSheet} onPress={(e) => e.stopPropagation()}>
              {label || inlineLabel ? <Text style={styles.modalTitle}>{label || inlineLabel}</Text> : null}
              <DateTimePicker
                value={temp}
                mode={mode}
                // Apple Calendar-style: a month grid for dates, a wheel for time.
                display={isDate ? 'inline' : 'spinner'}
                onChange={(_, d) => d && setTemp(d)}
                minimumDate={minimumDate}
                maximumDate={maximumDate}
                // Force a 12-hour wheel even when the device is set to 24-hour time.
                locale={isDate ? undefined : 'en_US'}
                themeVariant="dark"
                accentColor={colors.primary}
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
  defaultValue?: string;
  highlight?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  fieldStyle?: StyleProp<ViewStyle>;
  hideIcon?: boolean;
  valueStyle?: StyleProp<TextStyle>;
  inlineLabel?: string;
}) {
  return <DateTimeField mode="date" {...props} />;
}

export function TimeField(props: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  clearable?: boolean;
  defaultValue?: string;
  highlight?: boolean;
  containerStyle?: StyleProp<ViewStyle>;
  fieldStyle?: StyleProp<ViewStyle>;
  hideIcon?: boolean;
  valueStyle?: StyleProp<TextStyle>;
  inlineLabel?: string;
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
  btnCompact: { paddingVertical: 6, paddingHorizontal: spacing.sm },
  btnGhost: { backgroundColor: 'transparent', borderWidth: 1, borderColor: colors.primary },
  btnDanger: { backgroundColor: colors.error },
  btnDisabled: { opacity: 0.6 },
  headerCheck: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  headerClose: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center' },
  btnText: { color: '#fff', fontSize: 16, fontWeight: '600' },
  btnTextCompact: { fontSize: 14 },
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
  // Applied to fields the AI form assistant just changed, so the user can spot
  // them at a glance. Accent border + a subtle primary tint over the surface.
  inputHighlight: {
    borderColor: colors.primary,
    borderWidth: 1.5,
    backgroundColor: colors.primary + '22',
  },
  switchRowHighlight: {
    borderRadius: radius.md,
    borderWidth: 1.5,
    borderColor: colors.primary,
    backgroundColor: colors.primary + '22',
    paddingHorizontal: spacing.sm,
  },
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  accordion: { marginBottom: spacing.md },
  accordionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
  },
  accordionIcon: { marginRight: spacing.sm },
  accordionTitleWrap: { flex: 1, minWidth: 0 },
  accordionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  accordionSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  accordionBody: { marginTop: spacing.md },
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
  selectChevron: { marginLeft: 6 },
  inlineLabel: { flex: 1, fontSize: 16, color: colors.text, marginRight: spacing.sm },
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
    // Tall enough that the Alert select's full option list (leave-relative
    // choices + "Custom…") isn't clipped at the bottom.
    maxHeight: '80%',
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
