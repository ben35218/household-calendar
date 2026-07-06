import React from 'react';
import { Text, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, SectionTitle, SwitchRow } from '../../components/ui';
import { usePrivacyPrefs, type DataStorage } from '../../lib/privacyPrefs';
import { colors, spacing } from '../../theme';

const STORAGE_OPTIONS: { value: DataStorage; label: string; subtitle: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  {
    value: 'cloud',
    label: 'Back up in the Cloud',
    subtitle: 'Sync across your devices and share with your household. Recommended.',
    icon: 'cloud-outline',
  },
  {
    value: 'local',
    label: 'Store on this device only',
    subtitle: 'Keep app data local. It won’t sync to other devices or your household.',
    icon: 'phone-portrait-outline',
  },
];

export default function PrivacyScreen() {
  const { prefs, set } = usePrivacyPrefs();

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <SectionTitle>Artificial intelligence</SectionTitle>
        <Text style={styles.cardNote}>
          AI powers the assistants, recipe and receipt scanning, and smart suggestions across the app.
        </Text>
        <SwitchRow
          label="Use AI features"
          value={prefs.aiEnabled}
          onValueChange={(v) => set('aiEnabled', v)}
        />
        <View style={prefs.aiEnabled ? undefined : styles.disabled} pointerEvents={prefs.aiEnabled ? 'auto' : 'none'}>
          <SwitchRow
            label="Use personal & contact info in prompts"
            value={prefs.aiEnabled && prefs.aiUsePersonalInfo}
            onValueChange={(v) => set('aiUsePersonalInfo', v)}
          />
        </View>
        <Text style={styles.hint}>
          When off, names, addresses, and other contact details are kept out of AI prompts. Responses may be less
          tailored.
        </Text>
      </Card>

      <Card style={styles.card}>
        <SectionTitle>Data storage</SectionTitle>
        <Text style={styles.cardNote}>Choose where your app data is kept.</Text>
        {STORAGE_OPTIONS.map((opt, i) => {
          const selected = prefs.dataStorage === opt.value;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[styles.optionRow, i > 0 && styles.optionDivider]}
              activeOpacity={0.7}
              onPress={() => set('dataStorage', opt.value)}
            >
              <Ionicons name={opt.icon} size={22} color={selected ? colors.primary : colors.textMuted} style={styles.optionIcon} />
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, selected && { color: colors.primary, fontWeight: '700' }]}>{opt.label}</Text>
                <Text style={styles.optionSubtitle}>{opt.subtitle}</Text>
              </View>
              {selected ? <Ionicons name="checkmark-circle" size={22} color={colors.primary} /> : null}
            </TouchableOpacity>
          );
        })}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  card: { marginBottom: spacing.md },
  cardNote: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 18 },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 16 },
  disabled: { opacity: 0.4 },
  optionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  optionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  optionIcon: { marginRight: spacing.md },
  optionText: { flex: 1, minWidth: 0, marginRight: spacing.sm },
  optionLabel: { fontSize: 15, color: colors.text },
  optionSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2, lineHeight: 16 },
});
