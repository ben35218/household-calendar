import React, { useCallback, useEffect, useState } from 'react';
import {
  View, Text, StyleSheet, Alert, ActivityIndicator, TouchableOpacity,
  AppState, Linking, Switch, Platform, Share, LayoutAnimation, UIManager,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import * as DocumentPicker from 'expo-document-picker';
import { Ionicons } from '@expo/vector-icons';
import { settingsApi, authApi, householdApi, storageApi } from '../../api';
import { useAuth } from '../../store/auth';
import {
  getHDK, sealUpdate, openRecord,
  isUnlocked, ensureHouseholdKey, unlockWithPassword, unlockWithPasskey,
  addPasskeyFactor, hasPasskeyFactor, regenerateRecoveryCode, rewrapForNewPassword,
} from '../../lib/e2ee';
import { passkeysSupported } from '../../lib/passkeys';
import { invalidatePlaceBias } from '../../lib/placeBias';
import { usePrivacyPrefs, type DataStorage } from '../../lib/privacyPrefs';
import { ensureNotificationPermission } from '../../lib/notifications';
import { useStorageState, daysUntil } from '../../lib/storageState';
import { replicateAndBuildManifest } from '../../lib/storageMode';
import { exportEncryptedBackup, importEncryptedBackup } from '../../lib/exportData';
import {
  Input, DateField, Select, Screen, useHeaderCheckButton, Card, Button,
  SectionTitle, Divider, SwitchRow, AccordionSection,
} from '../../components/ui';
import { form as fs, GroupCard, CardDivider } from '../../components/formStyles';
import PlacesAutocomplete from '../../components/PlacesAutocomplete';
import { colors, spacing } from '../../theme';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}

const TIMEZONES = [
  'America/Toronto', 'America/New_York', 'America/Chicago',
  'America/Denver', 'America/Los_Angeles', 'America/Vancouver',
  'Europe/London', 'Europe/Paris', 'Australia/Sydney',
].map((t) => ({ label: t, value: t }));

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

type SectionKey = 'account' | 'reminders' | 'security' | 'privacy';
type KeyStatus = 'locked' | 'ready' | 'pending' | null;

// The one-stop profile screen: identity + location (saved by the header check),
// plus Reminders, Sign-in & Security, and Privacy & Data as collapsible sections.
// Each section below the identity block manages its own persistence (toggles
// auto-save; email/password/backup keep their own action buttons).
export default function AccountScreen() {
  const qc = useQueryClient();
  const navigation = useNavigation();
  const { user, setUser, logout } = useAuth();

  // Only the identity section starts open; the rest are one tap away.
  const [open, setOpen] = useState<Record<SectionKey, boolean>>({
    account: true, reminders: false, security: false, privacy: false,
  });
  function toggle(key: SectionKey) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((o) => ({ ...o, [key]: !o[key] }));
  }

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await settingsApi.get()).data,
  });
  const { data: household } = useQuery({
    queryKey: ['household'],
    queryFn: async () => (await householdApi.get()).data,
  });

  // ── Identity + location ─────────────────────────────────────────────────────
  const [form, setForm] = useState({
    firstName: '', lastName: '', phone: '', birthday: '', timezone: 'America/Toronto', homeAddress: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setForm({
      firstName: settings.firstName ?? '',
      lastName: settings.lastName ?? '',
      phone: settings.phone ?? '',
      birthday: settings.birthday ? String(settings.birthday).slice(0, 10) : '',
      timezone: settings.timezone ?? 'America/Toronto',
      homeAddress: settings.homeAddress ?? '',
    });
    // Decrypt the sealed home location over the plaintext (§9.1 P5); dormant
    // without an HDK. Post-drop this is the only source of the address.
    if (settings.enc && getHDK() && settings.householdId) {
      openRecord('Household', { _id: String(settings.householdId), keyVersion: settings.keyVersion, enc: settings.enc } as any)
        .then((dec: any) => { if (dec.homeAddress) setForm((f) => ({ ...f, homeAddress: dec.homeAddress })); })
        .catch(() => { /* locked / wrong key */ });
    }
  }, [settings]);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      let body: Record<string, unknown> = {
        firstName: form.firstName,
        lastName: form.lastName,
        phone: form.phone.trim(),
        birthday: form.birthday || undefined,
        timezone: form.timezone,
        homeAddress: form.homeAddress,
      };
      // Seal the home location alongside the plaintext (§9.1 P5); no-op without an HDK.
      if (getHDK() && settings?.householdId) {
        body = await sealUpdate('Household', String(settings.householdId), body, { homeAddress: form.homeAddress });
      }
      await settingsApi.update(body);
      qc.invalidateQueries({ queryKey: ['settings'] });
      invalidatePlaceBias();
      Alert.alert('Saved', 'Your account details were updated.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // Header chrome: an X close button on the left (in place of the native back
  // chevron) makes it clear that leaving doesn't save, and the checkmark on the
  // right is the only thing that persists the identity fields.
  useHeaderCheckButton(navigation, { onPress: save, loading: saving });

  // ── Reminders ──────────────────────────────────────────────────────────────
  // The toggle drives useReminderScheduler in RootNavigator via the privacy-prefs
  // store — flipping it here (re)schedules or cancels everything.
  const { prefs, set: setPref } = usePrivacyPrefs();
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

  async function onToggleReminders(v: boolean) {
    setPref('remindersEnabled', v);
    if (v) {
      await ensureNotificationPermission();
      refreshPermission();
    }
  }

  const denied = perm === 'denied';

  // ── Encryption status + unlock ──────────────────────────────────────────────
  const [keyStatus, setKeyStatus] = useState<KeyStatus>(null);
  const [unlockPw, setUnlockPw] = useState('');
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState('');
  const active = !!household?.e2eeActive;

  const loadKeyStatus = useCallback(async () => {
    try {
      setKeyStatus(isUnlocked() ? await ensureHouseholdKey() : 'locked');
    } catch {
      setKeyStatus(isUnlocked() ? 'ready' : 'locked'); // offline — best effort
    }
  }, []);
  useFocusEffect(useCallback(() => { loadKeyStatus(); }, [loadKeyStatus]));

  async function afterUnlock() {
    setUnlockPw('');
    setUnlockError('');
    await loadKeyStatus();
    qc.invalidateQueries(); // sealed records can decrypt now — repaint everything
  }

  async function unlockWithFaceId() {
    setUnlockBusy(true);
    setUnlockError('');
    try {
      if (await unlockWithPasskey()) await afterUnlock();
      // cancel: stay locked quietly — the sheet itself was the feedback
    } catch (e: any) {
      setUnlockError(e?.message || 'Could not unlock.');
    } finally {
      setUnlockBusy(false);
    }
  }

  async function unlockWithPw() {
    if (!unlockPw) return;
    setUnlockBusy(true);
    setUnlockError('');
    try {
      if (await unlockWithPassword(unlockPw)) await afterUnlock();
      else setUnlockError('That password didn’t unlock your key.');
    } catch (e: any) {
      setUnlockError(e?.message || 'Could not unlock.');
    } finally {
      setUnlockBusy(false);
    }
  }

  // ── Passkey factor ──────────────────────────────────────────────────────────
  const [passkeyBusy, setPasskeyBusy] = useState(false);
  const passkeyQ = useQuery({
    queryKey: ['passkeyFactor'],
    queryFn: hasPasskeyFactor,
    enabled: passkeysSupported(),
  });

  async function addPasskey() {
    setPasskeyBusy(true);
    try {
      const ok = await addPasskeyFactor();
      if (ok) {
        qc.invalidateQueries({ queryKey: ['passkeyFactor'] });
        Alert.alert('Passkey added', 'Face ID / Touch ID can now sign you in and unlock your encrypted data on this device.');
      }
    } catch (e: any) {
      Alert.alert('Could not add passkey', e?.message || 'Please try again.');
    } finally {
      setPasskeyBusy(false);
    }
  }

  // ── Recovery code ───────────────────────────────────────────────────────────
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  async function regenerate() {
    setRecoveryBusy(true);
    try {
      // Surfaces the new code via the one-time RecoveryCodeModal; null = locked.
      const code = await regenerateRecoveryCode();
      if (!code) Alert.alert('Locked', 'Unlock your encryption above first.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not regenerate your recovery code');
    } finally {
      setRecoveryBusy(false);
    }
  }

  // ── Change email ────────────────────────────────────────────────────────────
  const [emailOpen, setEmailOpen] = useState(false);
  const [emailForm, setEmailForm] = useState({ email: '', currentPassword: '' });
  const [emailSaving, setEmailSaving] = useState(false);
  const [emailError, setEmailError] = useState('');

  async function saveEmail() {
    setEmailSaving(true);
    setEmailError('');
    try {
      const { data } = await authApi.updateEmail({
        email: emailForm.email.trim(),
        password: emailForm.currentPassword,
      });
      if (user) setUser({ ...user, ...(data as object) });
      setEmailOpen(false);
      setEmailForm({ email: '', currentPassword: '' });
      Alert.alert('Updated', 'Email updated.');
    } catch (e: any) {
      setEmailError(e?.response?.data?.error || 'Failed to update email');
    } finally {
      setEmailSaving(false);
    }
  }

  // ── Change password ─────────────────────────────────────────────────────────
  const [pwOpen, setPwOpen] = useState(false);
  const [pwForm, setPwForm] = useState({ currentPassword: '', newPassword: '', confirm: '' });
  const [pwSaving, setPwSaving] = useState(false);
  const [pwError, setPwError] = useState('');
  const pwReady =
    pwForm.currentPassword.length > 0 && pwForm.newPassword.length >= 8 && pwForm.confirm.length > 0;

  async function savePassword() {
    if (pwForm.newPassword !== pwForm.confirm) {
      setPwError('New passwords do not match');
      return;
    }
    setPwSaving(true);
    setPwError('');
    try {
      await authApi.updatePassword({
        currentPassword: pwForm.currentPassword,
        newPassword: pwForm.newPassword,
      });
      // Re-wrap the E2EE key under the new password so it still unlocks the
      // account. Best-effort — a locked session keeps the old password factor.
      await rewrapForNewPassword(pwForm.newPassword).catch(() => {});
      setPwOpen(false);
      setPwForm({ currentPassword: '', newPassword: '', confirm: '' });
      Alert.alert('Updated', 'Password updated.');
    } catch (e: any) {
      setPwError(e?.response?.data?.error || 'Failed to update password');
    } finally {
      setPwSaving(false);
    }
  }

  // ── Delete account (Apple 5.1.1(v)) ──────────────────────────────────────────
  const [delOpen, setDelOpen] = useState(false);
  const [delPw, setDelPw] = useState('');
  const [delBusy, setDelBusy] = useState(false);
  const [delError, setDelError] = useState('');

  function confirmDelete() {
    if (!delPw) return;
    Alert.alert(
      'Delete your account?',
      'This permanently deletes your account and all your data, including anything you added to your household. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Delete account', style: 'destructive', onPress: runDelete },
      ],
    );
  }

  async function runDelete() {
    setDelBusy(true);
    setDelError('');
    try {
      await authApi.deleteAccount({ password: delPw });
      // Account is gone — tear down the session and return to the auth stack.
      await logout();
    } catch (e: any) {
      setDelError(e?.response?.data?.error || 'Could not delete your account. Please try again.');
      setDelBusy(false);
    }
  }

  // ── Status hero copy ────────────────────────────────────────────────────────
  const hero =
    keyStatus === 'locked'
      ? {
          icon: 'lock-closed' as const,
          color: colors.warning,
          title: 'Locked on this device',
          detail: 'Unlock to read your encrypted data here. It stays protected in the meantime.',
        }
      : keyStatus === 'pending'
        ? {
            icon: 'time-outline' as const,
            color: colors.warning,
            title: 'Waiting for household access',
            detail: 'A household member needs to approve this device before it can read shared data.',
          }
        : {
            icon: 'shield-checkmark' as const,
            color: colors.success,
            title: active ? 'End-to-end encrypted' : 'Encrypted',
            detail: active
              ? 'Only your household can read your data — not even we can. This device is unlocked.'
              : 'Everything you save is encrypted with your household’s key, and this device is unlocked.',
          };

  // ── Data storage ────────────────────────────────────────────────────────────
  const { state, setState, refresh } = useStorageState();
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);

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
      setPref('dataStorage', 'local');
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
      setPref('dataStorage', 'cloud');
      if (scheduled) Alert.alert('Cloud backup resumed', 'The scheduled deletion has been canceled.');
    } catch {
      Alert.alert('Something went wrong', 'Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function onPickStorage(value: DataStorage) {
    if (busy) return;
    if (value === selectedMode && !scheduled) return;
    if (value === 'local') {
      if (!canGoLocal) return explainMemberBlocked();
      confirmGoLocal();
    } else {
      goCloud();
    }
  }

  // ── Encrypted backup ────────────────────────────────────────────────────────
  // Decision 12: prompt for a passphrase, build the encrypted file from the local
  // replica, and hand it to the share sheet to save/send.
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

  if (isLoading) {
    return (
      <View style={fs.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <Screen>
      {/* ── Account (identity + location) ── */}
      <AccordionSection
        icon="card-outline"
        title="Account"
        subtitle="Name, phone, birthday & address"
        expanded={open.account}
        onToggle={() => toggle('account')}
      >
        <GroupCard>
          <Input
            value={form.firstName}
            onChangeText={set('firstName')}
            placeholder="First name"
            containerStyle={fs.headField}
            style={fs.headInput}
          />
          <CardDivider />
          <Input
            value={form.lastName}
            onChangeText={set('lastName')}
            placeholder="Last name"
            containerStyle={fs.headField}
            style={fs.headInput}
          />
          <CardDivider />
          <Input
            value={form.phone}
            onChangeText={set('phone')}
            placeholder="Phone number"
            keyboardType="phone-pad"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="telephoneNumber"
            containerStyle={fs.headField}
            style={fs.headInput}
          />
          <CardDivider />
          <PlacesAutocomplete
            value={form.homeAddress}
            onChangeText={set('homeAddress')}
            placeholder="Home address"
            type="address"
            containerStyle={fs.headField}
            inputStyle={fs.headInput}
          />
          <CardDivider />
          <DateField
            inlineLabel="Your birthday"
            clearable
            placeholder="None"
            value={form.birthday}
            onChange={set('birthday')}
            containerStyle={fs.dtFieldWrap}
            fieldStyle={fs.rowField}
            valueStyle={fs.dtValue}
            hideIcon
          />
          <CardDivider />
          <Select
            inlineLabel="Timezone"
            value={form.timezone}
            options={TIMEZONES}
            onChange={(v) => set('timezone')((v as string) ?? '')}
            containerStyle={fs.dtFieldWrap}
            fieldStyle={fs.rowField}
            valueStyle={fs.dtValue}
            chevronIcon="chevron-expand"
          />
        </GroupCard>
      </AccordionSection>

      {/* ── Reminders ── */}
      <AccordionSection
        icon="notifications-outline"
        title="Reminders"
        subtitle="Events, tasks, chores & birthdays"
        expanded={open.reminders}
        onToggle={() => toggle('reminders')}
      >
        <Card style={styles.sectionCard}>
          <View style={styles.mainRow}>
            <View style={styles.iconBubble}>
              <Ionicons name="notifications" size={18} color="#fff" />
            </View>
            <View style={styles.mainText}>
              <Text style={styles.mainLabel}>Reminders</Text>
              <Text style={styles.mainSubtitle}>Events, tasks, chores & birthdays</Text>
            </View>
            <Switch value={prefs.remindersEnabled} onValueChange={onToggleReminders} trackColor={{ true: colors.primary }} />
          </View>

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

          <View style={styles.infoDivider} />
          <View style={styles.infoRow}>
            <Ionicons name="time-outline" size={16} color={colors.textMuted} style={styles.infoIcon} />
            <Text style={styles.infoText}>Delivered at the time set on each item, or 7am for day-based alerts.</Text>
          </View>
          <View style={styles.infoRow}>
            <Ionicons name="lock-closed-outline" size={16} color={colors.textMuted} style={styles.infoIcon} />
            <Text style={styles.infoText}>Computed on your device — your schedule details never leave it.</Text>
          </View>
        </Card>
      </AccordionSection>

      {/* ── Sign-in & Security ── */}
      <AccordionSection
        icon="shield-checkmark-outline"
        title="Sign-in & Security"
        subtitle="Password, Face ID & encryption"
        expanded={open.security}
        onToggle={() => toggle('security')}
      >
        <Card style={[styles.sectionCard, styles.hero, { borderColor: hero.color }]}>
          <View style={styles.rowCenter}>
            {keyStatus === null
              ? <ActivityIndicator size="small" color={colors.primary} />
              : <Ionicons name={hero.icon} size={24} color={hero.color} />}
            <Text style={[styles.heroTitle, { color: hero.color }]}>{keyStatus === null ? 'Checking…' : hero.title}</Text>
          </View>
          {keyStatus !== null ? <Text style={styles.heroDetail}>{hero.detail}</Text> : null}

          {keyStatus === 'locked' ? (
            <View style={styles.unlockBox}>
              {passkeysSupported() && passkeyQ.data ? (
                <Button title="Unlock with Face ID" onPress={unlockWithFaceId} loading={unlockBusy} />
              ) : null}
              <Input
                label="Password"
                value={unlockPw}
                onChangeText={setUnlockPw}
                secureTextEntry
                returnKeyType="go"
                onSubmitEditing={unlockWithPw}
              />
              {unlockError ? <Text style={styles.error}>{unlockError}</Text> : null}
              <Button
                title="Unlock"
                variant={passkeysSupported() && passkeyQ.data ? 'ghost' : 'primary'}
                onPress={unlockWithPw}
                loading={unlockBusy}
                disabled={!unlockPw}
              />
            </View>
          ) : null}
        </Card>

        <Card style={styles.sectionCard}>
          <SectionTitle>Sign-in</SectionTitle>

          <View style={styles.secRow}>
            <View style={styles.secText}>
              <Text style={styles.secLabel}>Email</Text>
              <Text style={styles.secValue}>{user?.email}</Text>
            </View>
            <Button title={emailOpen ? 'Close' : 'Change'} variant="ghost" onPress={() => setEmailOpen((o) => !o)} />
          </View>
          {emailOpen ? (
            <View style={styles.expand}>
              <Input
                label="New email"
                value={emailForm.email}
                onChangeText={(v) => setEmailForm((f) => ({ ...f, email: v }))}
                autoCapitalize="none"
                keyboardType="email-address"
              />
              <Input
                label="Current password"
                value={emailForm.currentPassword}
                onChangeText={(v) => setEmailForm((f) => ({ ...f, currentPassword: v }))}
                secureTextEntry
              />
              {emailError ? <Text style={styles.error}>{emailError}</Text> : null}
              <Button
                title="Save email"
                onPress={saveEmail}
                loading={emailSaving}
                disabled={!emailForm.email.trim() || !emailForm.currentPassword}
              />
            </View>
          ) : null}

          <Divider />

          <View style={styles.secRow}>
            <View style={styles.secText}>
              <Text style={styles.secLabel}>Password</Text>
              <Text style={styles.secValue}>••••••••</Text>
            </View>
            <Button title={pwOpen ? 'Close' : 'Change'} variant="ghost" onPress={() => setPwOpen((o) => !o)} />
          </View>
          {pwOpen ? (
            <View style={styles.expand}>
              <Input
                label="Current password"
                value={pwForm.currentPassword}
                onChangeText={(v) => setPwForm((f) => ({ ...f, currentPassword: v }))}
                secureTextEntry
              />
              <Input
                label="New password (min 8 chars)"
                value={pwForm.newPassword}
                onChangeText={(v) => setPwForm((f) => ({ ...f, newPassword: v }))}
                secureTextEntry
              />
              <Input
                label="Confirm new password"
                value={pwForm.confirm}
                onChangeText={(v) => setPwForm((f) => ({ ...f, confirm: v }))}
                secureTextEntry
              />
              {pwError ? <Text style={styles.error}>{pwError}</Text> : null}
              <Button title="Save password" onPress={savePassword} loading={pwSaving} disabled={!pwReady} />
            </View>
          ) : null}
        </Card>

        {passkeysSupported() ? (
          <Card style={styles.sectionCard}>
            <SectionTitle>Face ID / Touch ID</SectionTitle>
            <Text style={styles.cardNote}>
              {passkeyQ.data
                ? 'On — a passkey on this device can unlock your encrypted data.'
                : 'Add a passkey so Face ID / Touch ID can unlock your encrypted data — no password needed after a relaunch.'}
            </Text>
            <Button
              title={passkeyQ.data ? 'Passkey enabled' : passkeyBusy ? 'Adding…' : 'Add a passkey'}
              variant="ghost"
              disabled={!!passkeyQ.data || passkeyBusy || keyStatus === 'locked'}
              loading={passkeyBusy}
              onPress={addPasskey}
            />
            {!passkeyQ.data && keyStatus === 'locked' ? (
              <Text style={styles.hint}>Unlock above first — adding a passkey needs your key in hand.</Text>
            ) : null}
          </Card>
        ) : null}

        <Card style={styles.sectionCard}>
          <SectionTitle>Recovery code</SectionTitle>
          <Text style={styles.cardNote}>
            Your backup way in if you forget your password. Resetting the password restores sign-in only — the recovery
            code is what restores access to your encrypted data.
          </Text>
          <Button
            title="Regenerate recovery code"
            variant="ghost"
            loading={recoveryBusy}
            disabled={keyStatus === 'locked'}
            onPress={regenerate}
          />
          {keyStatus === 'locked' ? (
            <Text style={styles.hint}>Unlock above first to manage your recovery code.</Text>
          ) : null}
        </Card>
      </AccordionSection>

      {/* ── Privacy & Data ── */}
      <AccordionSection
        icon="lock-closed-outline"
        title="Privacy & Data"
        subtitle="AI, storage & backup"
        expanded={open.privacy}
        onToggle={() => toggle('privacy')}
      >
        <Card style={styles.sectionCard}>
          <SectionTitle>Artificial intelligence</SectionTitle>
          <Text style={styles.cardNote}>
            AI powers the assistants, recipe and receipt scanning, and smart suggestions across the app.
          </Text>
          <SwitchRow
            label="Use AI features"
            value={prefs.aiEnabled}
            onValueChange={(v) => setPref('aiEnabled', v)}
          />
          <View style={prefs.aiEnabled ? undefined : styles.disabled} pointerEvents={prefs.aiEnabled ? 'auto' : 'none'}>
            <SwitchRow
              label="Use personal & contact info in prompts"
              value={prefs.aiEnabled && prefs.aiUsePersonalInfo}
              onValueChange={(v) => setPref('aiUsePersonalInfo', v)}
            />
          </View>
          <Text style={styles.hint}>
            When off, names, addresses, and other contact details are kept out of AI prompts. Responses may be less
            tailored.
          </Text>
        </Card>

        <Card style={styles.sectionCard}>
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
                onPress={() => onPickStorage(opt.value)}
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

        <Card style={styles.sectionCard}>
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
      </AccordionSection>

      {/* ── Sign out ── */}
      <View style={styles.signOut}>
        <Button title="Sign out" variant="danger" onPress={() => logout()} />
      </View>

      {/* ── Delete account (always visible, Apple 5.1.1(v)) ── */}
      <Card style={[styles.sectionCard, styles.dangerCard]}>
        <SectionTitle>Delete account</SectionTitle>
        <Text style={styles.cardNote}>
          Permanently delete your account and all your data, including anything you added to your household. This can’t be
          undone.
        </Text>
        {delOpen ? (
          <View style={styles.expand}>
            <Input
              label="Confirm your password"
              value={delPw}
              onChangeText={setDelPw}
              secureTextEntry
              autoCapitalize="none"
            />
            {delError ? <Text style={styles.error}>{delError}</Text> : null}
            <Button
              title="Permanently delete account"
              variant="danger"
              onPress={confirmDelete}
              loading={delBusy}
              disabled={!delPw || delBusy}
            />
          </View>
        ) : (
          <Button title="Delete account" variant="danger" onPress={() => setDelOpen(true)} />
        )}
      </Card>
    </Screen>
  );
}

const styles = StyleSheet.create({
  cardNote: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 18 },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm, marginBottom: spacing.md, lineHeight: 16 },
  sectionCard: { marginBottom: spacing.md },
  signOut: { marginBottom: spacing.md },
  dangerCard: { borderColor: colors.error + '55' },
  // Reminders
  mainRow: { flexDirection: 'row', alignItems: 'center' },
  iconBubble: {
    width: 30,
    height: 30,
    borderRadius: 8,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: spacing.md,
  },
  mainText: { flex: 1, minWidth: 0, marginRight: spacing.sm },
  mainLabel: { fontSize: 16, color: colors.text, fontWeight: '600' },
  mainSubtitle: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  infoDivider: { height: StyleSheet.hairlineWidth, backgroundColor: colors.border, marginVertical: spacing.sm },
  infoRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: 4 },
  infoIcon: { marginRight: spacing.sm, marginTop: 1 },
  infoText: { flex: 1, fontSize: 12, color: colors.textMuted, lineHeight: 16 },
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
  // Security
  hero: { borderWidth: 1 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  heroTitle: { flex: 1, fontSize: 16, fontWeight: '700' },
  heroDetail: { fontSize: 13, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 18 },
  unlockBox: { marginTop: spacing.md, gap: spacing.sm },
  secRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  secText: { flex: 1, minWidth: 0 },
  secLabel: { fontSize: 12, color: colors.textMuted },
  secValue: { fontSize: 15, color: colors.text, marginTop: 2 },
  expand: { marginTop: spacing.sm },
  error: { color: colors.error, fontSize: 13, marginBottom: spacing.sm },
  // Privacy
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
  exportRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  exportLabel: { fontSize: 15, color: colors.primary, fontWeight: '600' },
});
