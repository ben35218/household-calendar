import React, { useCallback, useEffect, useState } from 'react';
import { Text, ScrollView, StyleSheet, TouchableOpacity, View, AppState, Linking } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import { Card, SwitchRow } from '../../components/ui';
import { usePrivacyPrefs } from '../../lib/privacyPrefs';
import { ensureNotificationPermission } from '../../lib/notifications';
import { colors, spacing } from '../../theme';

// The reminders toggle drives useReminderScheduler in RootNavigator via the
// privacy-prefs store — flipping it here (re)schedules or cancels everything.
export default function NotificationsScreen() {
  const { prefs, set } = usePrivacyPrefs();
  const [perm, setPerm] = useState<Notifications.PermissionStatus | null>(null);

  const refreshPermission = useCallback(() => {
    Notifications.getPermissionsAsync()
      .then(({ status }) => setPerm(status))
      .catch(() => {});
  }, []);

  // Re-check on focus and on return from the system Settings app.
  useFocusEffect(useCallback(() => { refreshPermission(); }, [refreshPermission]));
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refreshPermission();
    });
    return () => sub.remove();
  }, [refreshPermission]);

  async function onToggle(v: boolean) {
    set('remindersEnabled', v);
    if (v) {
      await ensureNotificationPermission();
      refreshPermission();
    }
  }

  const denied = perm === 'denied';

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <Text style={styles.cardNote}>
          Reminders for events, tasks, chores, and birthdays are computed on your device — no schedule details leave it.
        </Text>
        <SwitchRow label="Reminders" value={prefs.remindersEnabled} onValueChange={onToggle} />

        {denied && (
          <View style={styles.deniedBanner}>
            <Ionicons name="notifications-off-outline" size={18} color={colors.warning} style={{ marginRight: spacing.sm }} />
            <Text style={styles.deniedText}>
              Notifications are turned off for this app in system Settings, so reminders can’t be delivered.
            </Text>
          </View>
        )}
        {denied && (
          <TouchableOpacity style={styles.settingsRow} onPress={() => Linking.openSettings()} activeOpacity={0.7}>
            <Ionicons name="settings-outline" size={20} color={colors.primary} />
            <Text style={styles.settingsLabel}>Open Settings</Text>
          </TouchableOpacity>
        )}

        <Text style={styles.hint}>
          You’ll be reminded at the times set on each event, task, or chore, and at 7am for day-based alerts.
        </Text>
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
  deniedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,167,38,0.12)',
    borderRadius: 10,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  deniedText: { flex: 1, color: colors.warning, fontSize: 12, lineHeight: 16 },
  settingsRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  settingsLabel: { fontSize: 15, color: colors.primary, fontWeight: '600' },
});
