import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { storageApi } from '../api';
import { useStorageState, daysUntil } from '../lib/storageState';
import { usePrivacyPrefs } from '../lib/privacyPrefs';
import { useActiveRoute } from '../navigation/activeRoute';
import { colors, spacing } from '../theme';

// The Profile section (where the storage setting lives) + every screen reachable
// from it. The purge countdown is scoped to this section rather than app-wide.
const PROFILE_ROUTES = new Set([
  'ProfileHome', 'Account', 'People', 'PersonForm', 'ContactImport',
  'Household', 'Plan', 'ComparePlans', 'AiUsage',
]);

// Persistent countdown banner shown while a cloud purge is pending (§6.2 step 5),
// scoped to the Profile section. Renders nothing otherwise, so it has zero layout
// impact elsewhere. Tapping "Keep in cloud" cancels the purge within the undo window.
export default function StorageBanner() {
  const insets = useSafeAreaInsets();
  const { state, setState } = useStorageState();
  const { set: setPref } = usePrivacyPrefs();
  const activeRoute = useActiveRoute();
  const [busy, setBusy] = useState(false);

  if (!state || state.cloudDeletionState !== 'scheduled') return null;
  if (!activeRoute || !PROFILE_ROUTES.has(activeRoute)) return null;

  const days = daysUntil(state.cloudDeletionScheduledAt);

  async function keepInCloud() {
    setBusy(true);
    try {
      const { data } = await storageApi.switchToCloud();
      setState(data);
      setPref('dataStorage', 'cloud');
    } catch {
      Alert.alert('Could not cancel', 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={[styles.wrap, { paddingTop: insets.top + spacing.sm }]}>
      <Ionicons name="cloud-offline-outline" size={20} color="#000" style={styles.icon} />
      <Text style={styles.text}>
        Cloud copy deletes in {days} {days === 1 ? 'day' : 'days'}. Switch back to keep it.
      </Text>
      <TouchableOpacity style={styles.btn} onPress={keepInCloud} disabled={busy} activeOpacity={0.7}>
        {busy ? <ActivityIndicator size="small" color="#000" /> : <Text style={styles.btnText}>Keep in cloud</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.warning,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.sm,
  },
  icon: { marginRight: spacing.sm },
  text: { flex: 1, color: '#000', fontSize: 13, fontWeight: '600', lineHeight: 17 },
  btn: {
    marginLeft: spacing.sm,
    backgroundColor: '#000',
    borderRadius: 14,
    paddingHorizontal: 12,
    paddingVertical: 6,
    minWidth: 96,
    alignItems: 'center',
  },
  btnText: { color: '#fff', fontSize: 12, fontWeight: '700' },
});
