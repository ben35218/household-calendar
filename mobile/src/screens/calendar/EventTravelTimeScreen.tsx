import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, RouteProp } from '@react-navigation/native';
import { Screen, SwitchRow } from '../../components/ui';
import PlacesAutocomplete from '../../components/PlacesAutocomplete';
import { setTravelDraft } from '../../lib/travelDraft';
import { form } from '../../components/formStyles';
import { CalendarStackParamList } from '../../navigation/CalendarNavigator';
import { colors, spacing } from '../../theme';

type Rt = RouteProp<CalendarStackParamList, 'EventTravelTime'>;

const MANUAL_OPTIONS = [
  { label: '5 minutes', value: 5 },
  { label: '15 minutes', value: 15 },
  { label: '30 minutes', value: 30 },
  { label: '1 hour', value: 60 },
  { label: '1 hour, 30 minutes', value: 90 },
  { label: '2 hours', value: 120 },
];

// Pushed from the event form's Travel Time row. Edits sync back to the form
// live through the travelDraft store; going back is the only "save".
export default function EventTravelTimeScreen() {
  const params = useRoute<Rt>().params;
  const [enabled, setEnabled] = useState(params.enabled);
  const [fromAddress, setFromAddress] = useState(params.fromAddress);
  const [manualMinutes, setManualMinutes] = useState<number | null>(params.manualMinutes);

  const sync = (next: Partial<{ enabled: boolean; fromAddress: string; manualMinutes: number | null }>) => {
    if (next.enabled !== undefined) setEnabled(next.enabled);
    if (next.fromAddress !== undefined) setFromAddress(next.fromAddress);
    if (next.manualMinutes !== undefined) setManualMinutes(next.manualMinutes);
    setTravelDraft({ enabled, fromAddress, manualMinutes, ...next });
  };

  return (
    <Screen>
      <View style={form.groupCard}>
        <View style={form.groupPad}>
          <SwitchRow label="Travel Time" value={enabled} onValueChange={(v) => sync({ enabled: v })} />
        </View>
      </View>

      {enabled ? (
        <>
          <PlacesAutocomplete
            label="Starting location"
            value={fromAddress}
            onChangeText={(v) => sync({ fromAddress: v })}
            type="address"
            placeholder="Home address"
          />
          <Text style={styles.hint}>
            {manualMinutes == null
              ? 'Travel time is calculated from the starting location to the event location.'
              : 'A manual travel time is set; the starting location is not used.'}
          </Text>

          <View style={form.groupCard}>
            <TouchableOpacity style={form.dtRow} activeOpacity={0.7} onPress={() => sync({ manualMinutes: null })}>
              <Text style={form.dtLabel}>Based on starting location</Text>
              {manualMinutes == null ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
            </TouchableOpacity>
            {MANUAL_OPTIONS.map((o) => (
              <React.Fragment key={o.value}>
                <View style={form.cardDivider} />
                <TouchableOpacity style={form.dtRow} activeOpacity={0.7} onPress={() => sync({ manualMinutes: o.value })}>
                  <Text style={form.dtLabel}>{o.label}</Text>
                  {manualMinutes === o.value ? <Ionicons name="checkmark" size={18} color={colors.primary} /> : null}
                </TouchableOpacity>
              </React.Fragment>
            ))}
          </View>
        </>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, color: colors.textMuted, marginTop: -spacing.sm, marginBottom: spacing.md },
});
