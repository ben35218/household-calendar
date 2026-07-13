import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, StyleProp, TextStyle, ViewStyle } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { placesApi, PlacePrediction } from '../api';
import { getPlaceBias } from '../lib/placeBias';
import { Input } from './ui';
import { colors, spacing } from '../theme';

// Reusable Google-Places address autocomplete (debounced) used across every
// address field — replaces the web's <v-combobox> + placesApi.autocomplete.
// `onSelect` receives the chosen prediction so callers can look up a timezone
// (journey legs) or store the place_id.
export default function PlacesAutocomplete({
  label,
  value,
  onChangeText,
  onSelect,
  placeholder,
  type,
  highlight,
  inputStyle,
  containerStyle,
}: {
  label?: string;
  value: string;
  onChangeText: (text: string) => void;
  onSelect?: (p: PlacePrediction) => void;
  placeholder?: string;
  type?: string;
  highlight?: boolean;
  inputStyle?: StyleProp<TextStyle>;
  containerStyle?: StyleProp<ViewStyle>;
}) {
  const [suggestions, setSuggestions] = useState<PlacePrediction[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const justSelected = useRef(false);
  // Only autocomplete once the user has actually typed. Guards against the
  // field being pre-filled from saved settings (e.g. the Account home address),
  // which would otherwise pop the dropdown open on load without any input.
  const userTyped = useRef(false);

  useEffect(() => {
    if (justSelected.current) { justSelected.current = false; return; }
    if (!userTyped.current) return;
    if (timer.current) clearTimeout(timer.current);
    const q = value.trim();
    if (q.length < 3) { setSuggestions([]); setOpen(false); return; }
    timer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const bias = await getPlaceBias();
        const { data } = await placesApi.autocomplete(q, type, bias);
        setSuggestions(data.predictions ?? []);
        setOpen(true);
      } catch {
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 350);
    return () => { if (timer.current) clearTimeout(timer.current); };
  }, [value, type]);

  function handleChange(text: string) {
    userTyped.current = true;
    onChangeText(text);
  }

  function pick(p: PlacePrediction) {
    justSelected.current = true;
    onChangeText(p.description);
    onSelect?.(p);
    setSuggestions([]);
    setOpen(false);
  }

  return (
    <View style={styles.wrap}>
      <Input
        label={label}
        value={value}
        onChangeText={handleChange}
        placeholder={placeholder}
        autoCapitalize="none"
        highlight={highlight}
        style={inputStyle}
        containerStyle={containerStyle}
      />
      {loading ? <ActivityIndicator size="small" color={colors.primary} style={styles.spinner} /> : null}
      {open && suggestions.length > 0 ? (
        <View style={styles.dropdown}>
          {suggestions.slice(0, 6).map((p) => (
            <TouchableOpacity key={p.place_id} style={styles.row} onPress={() => pick(p)}>
              <Ionicons name="location-outline" size={16} color={colors.textMuted} />
              <View style={{ flex: 1 }}>
                <Text style={styles.main} numberOfLines={1}>{p.main_text || p.description}</Text>
                {p.secondary_text ? <Text style={styles.sub} numberOfLines={1}>{p.secondary_text}</Text> : null}
              </View>
            </TouchableOpacity>
          ))}
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { position: 'relative' },
  spinner: { position: 'absolute', right: 10, top: 34 },
  dropdown: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface,
    marginTop: -spacing.sm, marginBottom: spacing.sm, overflow: 'hidden',
  },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  main: { fontSize: 14, color: colors.text },
  sub: { fontSize: 12, color: colors.textMuted },
});
