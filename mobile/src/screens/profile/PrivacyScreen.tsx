import React, { useState } from 'react';
import { Text, ScrollView, StyleSheet, TouchableOpacity, View, Alert, ActivityIndicator, Platform, Share } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Card, SectionTitle, SwitchRow } from '../../components/ui';
import { usePrivacyPrefs, type DataStorage } from '../../lib/privacyPrefs';
import { useStorageState, daysUntil } from '../../lib/storageState';
import { replicateAndBuildManifest } from '../../lib/storageMode';
import * as DocumentPicker from 'expo-document-picker';
import { exportEncryptedBackup, importEncryptedBackup } from '../../lib/exportData';
import { storageApi } from '../../api';
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
    subtitle: 'Keep app data on this device. It won’t sync to other devices, and this device becomes the only copy.',
    icon: 'phone-portrait-outline',
  },
];

export default function PrivacyScreen() {
  const { prefs, set } = usePrivacyPrefs();
  const { state, setState, refresh } = useStorageState();
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

  // Encrypted backup (decision 12): prompt for a passphrase, build the encrypted
  // file from the local replica, and hand it to the share sheet to save/send.
  function exportBackup() {
    if (Platform.OS !== 'ios') {
      Alert.alert('Encrypted backup', 'Exporting a backup is available on iOS for now.');
      return;
    }
    Alert.prompt(
      'Encrypted backup',
      'Choose a passphrase to protect this backup. You’ll need it to restore — we can’t recover it for you.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Export',
          onPress: async (passphrase?: string) => {
            if (!passphrase || passphrase.length < 8) {
              Alert.alert('Passphrase too short', 'Use at least 8 characters.');
              return;
            }
            setExporting(true);
            try {
              const uri = await exportEncryptedBackup(passphrase);
              if (!uri) { Alert.alert('Nothing to export', 'There’s no data on this device yet.'); return; }
              await Share.share({ url: uri });
            } catch (e: any) {
              Alert.alert('Export failed', e?.message || 'Please try again.');
            } finally {
              setExporting(false);
            }
          },
        },
      ],
      'secure-text',
    );
  }

  // Restore a .hcbackup on a new device: pick the file, ask for its passphrase,
  // decrypt + upsert into the local replica (LWW keeps newer local records).
  async function importBackup() {
    if (Platform.OS !== 'ios') {
      Alert.alert('Encrypted backup', 'Restoring a backup is available on iOS for now.');
      return;
    }
    const result = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (result.canceled) return;
    const uri = result.assets[0].uri;
    Alert.prompt(
      'Restore backup',
      'Enter the passphrase this backup was protected with.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Restore',
          onPress: async (passphrase?: string) => {
            if (!passphrase) return;
            setImporting(true);
            try {
              const { total } = await importEncryptedBackup(uri, passphrase);
              Alert.alert('Backup restored', `${total} record${total === 1 ? '' : 's'} imported to this device.`);
            } catch (e: any) {
              Alert.alert('Restore failed', e?.message || 'Please try again.');
            } finally {
              setImporting(false);
            }
          },
        },
      ],
      'secure-text',
    );
  }

  // The server is authoritative for the selected mode once loaded; fall back to
  // the device pref while it loads.
  const selectedMode: DataStorage = state ? state.storageMode : prefs.dataStorage;
  const scheduled = state?.cloudDeletionState === 'scheduled';
  const canGoLocal = state ? state.canGoLocal : true;

  // Solo guard (§6.1): a household member can't go local — shared family data
  // stays in the encrypted cloud so everyone can see it.
  function explainMemberBlocked() {
    Alert.alert(
      'Shared with your household',
      "Your data is shared with your household, so it stays in the encrypted cloud where everyone can see it. End-to-end encryption already keeps it private. Leave your household first to store data on this device only.",
    );
  }

  // cloud → local (§6.2): blocking confirmation, then download-first + schedule.
  function confirmGoLocal() {
    Alert.alert(
      'Store on this device only?',
      'Your data will be copied to this device and your encrypted cloud copy will be scheduled for deletion in 7 days.\n\n' +
        '• This becomes your only device — there is no automatic recovery if you lose it.\n' +
        '• You can switch back to cloud any time in the next 7 days to cancel.\n' +
        '• We’ll email you the exact deletion date.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', style: 'destructive', onPress: runGoLocal },
      ],
    );
  }

  async function runGoLocal() {
    setBusy(true);
    try {
      // Download-first: prove a complete local copy before the server schedules
      // any deletion. A failed fetch throws and we never claim completeness.
      const manifest = await replicateAndBuildManifest();
      const { data } = await storageApi.switchToLocal(manifest);
      setState(data);
      set('dataStorage', 'local');
      Alert.alert(
        'Saved on this device',
        `Your data is now on this device. Your cloud copy will be deleted in ${daysUntil(data.cloudDeletionScheduledAt)} days — switch back before then to cancel.`,
      );
    } catch (err: unknown) {
      const resp = (err as { response?: { data?: { reasons?: string[]; error?: string } } })?.response?.data;
      const detail = resp?.reasons?.length
        ? `\n\nStill to sync:\n${resp.reasons.join('\n')}`
        : '';
      Alert.alert(
        'Couldn’t verify your local copy',
        `${resp?.error || 'Your data could not be fully copied to this device, so nothing was deleted.'}${detail}`,
      );
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  // local → cloud (§6.3 undo): cancel a pending purge, resume sync.
  async function goCloud() {
    setBusy(true);
    try {
      const { data } = await storageApi.switchToCloud();
      setState(data);
      set('dataStorage', 'cloud');
      if (scheduled) Alert.alert('Cloud backup resumed', 'The scheduled deletion has been canceled.');
    } catch {
      Alert.alert('Something went wrong', 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function onPick(value: DataStorage) {
    if (busy) return;
    if (value === selectedMode && !scheduled) return;
    if (value === 'local') {
      if (!canGoLocal) return explainMemberBlocked();
      confirmGoLocal();
    } else {
      goCloud();
    }
  }

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
        <SectionTitle>Notifications</SectionTitle>
        <Text style={styles.cardNote}>
          Reminders for events, tasks, chores, and birthdays are computed on your device — no schedule details leave it.
        </Text>
        <SwitchRow
          label="Reminders"
          value={prefs.remindersEnabled}
          onValueChange={(v) => set('remindersEnabled', v)}
        />
      </Card>

      <Card style={styles.card}>
        <SectionTitle>Data storage</SectionTitle>
        <Text style={styles.cardNote}>Choose where your app data is kept.</Text>

        {scheduled && (
          <View style={styles.scheduledBanner}>
            <Ionicons name="time-outline" size={18} color={colors.warning} style={{ marginRight: spacing.sm }} />
            <Text style={styles.scheduledText}>
              Your cloud copy will be deleted in {daysUntil(state?.cloudDeletionScheduledAt)} days. Switch back to “Back
              up in the Cloud” to cancel.
            </Text>
          </View>
        )}

        {STORAGE_OPTIONS.map((opt, i) => {
          const selected = selectedMode === opt.value;
          const memberBlocked = opt.value === 'local' && !canGoLocal;
          return (
            <TouchableOpacity
              key={opt.value}
              style={[styles.optionRow, i > 0 && styles.optionDivider, memberBlocked && styles.optionBlocked]}
              activeOpacity={0.7}
              disabled={busy}
              onPress={() => onPick(opt.value)}
            >
              <Ionicons name={opt.icon} size={22} color={selected ? colors.primary : colors.textMuted} style={styles.optionIcon} />
              <View style={styles.optionText}>
                <Text style={[styles.optionLabel, selected && { color: colors.primary, fontWeight: '700' }]}>{opt.label}</Text>
                <Text style={styles.optionSubtitle}>
                  {memberBlocked ? 'Shared with your household — stays in the encrypted cloud.' : opt.subtitle}
                </Text>
              </View>
              {busy && opt.value === 'local' ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : selected ? (
                <Ionicons name="checkmark-circle" size={22} color={colors.primary} />
              ) : null}
            </TouchableOpacity>
          );
        })}
        <Text style={styles.hint}>
          Your data is end-to-end encrypted in the cloud — only your household can read it. “On this device only” keeps
          it off our servers entirely, but there’s no backup if you lose this device.
        </Text>
      </Card>

      <Card style={styles.card}>
        <SectionTitle>Encrypted backup</SectionTitle>
        <Text style={styles.cardNote}>
          Save a passphrase-protected copy of your data to a file you control — the only way to move “on this device
          only” data to another device. Keep the passphrase safe; without it the backup can’t be opened.
        </Text>
        <TouchableOpacity style={styles.exportRow} disabled={exporting} onPress={exportBackup} activeOpacity={0.7}>
          {exporting
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Ionicons name="download-outline" size={20} color={colors.primary} />}
          <Text style={styles.exportLabel}>Export encrypted backup…</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.exportRow} disabled={importing} onPress={importBackup} activeOpacity={0.7}>
          {importing
            ? <ActivityIndicator size="small" color={colors.primary} />
            : <Ionicons name="push-outline" size={20} color={colors.primary} />}
          <Text style={styles.exportLabel}>Restore from backup…</Text>
        </TouchableOpacity>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  card: { marginBottom: spacing.md },
  cardNote: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 18 },
  exportRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  exportLabel: { fontSize: 15, color: colors.primary, fontWeight: '600' },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 16 },
  disabled: { opacity: 0.4 },
  optionRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12 },
  optionDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  optionBlocked: { opacity: 0.5 },
  optionIcon: { marginRight: spacing.md },
  optionText: { flex: 1, minWidth: 0, marginRight: spacing.sm },
  optionLabel: { fontSize: 15, color: colors.text },
  optionSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2, lineHeight: 16 },
  scheduledBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(255,167,38,0.12)',
    borderRadius: 10,
    padding: spacing.sm,
    marginBottom: spacing.sm,
  },
  scheduledText: { flex: 1, color: colors.warning, fontSize: 12, lineHeight: 16 },
});
