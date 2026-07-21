import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  View, Text, StyleSheet, Alert, ActivityIndicator, TouchableOpacity,
  AppState, Linking, Switch, Platform, LayoutAnimation, UIManager,
} from 'react-native';
import { useNavigation, useFocusEffect, useRoute, RouteProp } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Notifications from 'expo-notifications';
import { Ionicons } from '@expo/vector-icons';
import { settingsApi, authApi, householdApi } from '../../api';
import { useAuth } from '../../store/auth';
import { getHDK, sealUpdate, openRecord, isUnlocked, rewrapForNewPassword } from '../../lib/e2ee';
import { invalidatePlaceBias } from '../../lib/placeBias';
import { HOUSEHOLD_ENC } from '../../lib/encSubsets';
import { usePrivacyPrefs } from '../../lib/privacyPrefs';
import { ensureNotificationPermission } from '../../lib/notifications';
import {
  Input, DateField, Select, Screen, useHeaderCheckButton, Card, Button,
  SectionTitle, Divider, AccordionSection,
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

type SectionKey = 'account' | 'reminders' | 'security';

// The identity + credentials screen: name/location (saved by the header check),
// plus Reminders and Sign-in as collapsible sections. Everything about
// encryption, recovery methods, devices, and data controls now lives in the
// dedicated Privacy & Data screen (PrivacyDataScreen) — Account stays focused on
// "who you are and how you sign in".
export default function AccountScreen() {
  const qc = useQueryClient();
  const navigation = useNavigation();
  const route = useRoute<RouteProp<{ Account: { section?: SectionKey } | undefined }, 'Account'>>();
  const { user, setUser, logout } = useAuth();

  // Only the identity section starts open; a deep link (e.g. changing the
  // password from Privacy & data) can open a specific section instead.
  const requestedSection = route.params?.section;
  const collapsedExcept = (key: SectionKey): Record<SectionKey, boolean> =>
    ({ account: false, reminders: false, security: false, [key]: true });
  const [open, setOpen] = useState<Record<SectionKey, boolean>>(
    requestedSection ? collapsedExcept(requestedSection) : { account: true, reminders: false, security: false },
  );
  function toggle(key: SectionKey) {
    LayoutAnimation.configureNext(LayoutAnimation.Presets.easeInEaseOut);
    setOpen((o) => ({ ...o, [key]: !o[key] }));
  }
  useEffect(() => {
    if (requestedSection) setOpen(collapsedExcept(requestedSection));
  }, [requestedSection]);

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
  // The decrypted household blob (name + homeAddress — C2): spread under the
  // update at seal time so re-sealing the address never drops the sealed name.
  const decryptedHH = useRef<Record<string, unknown>>({});

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
        .then((dec: any) => {
          decryptedHH.current = { name: dec.name, homeAddress: dec.homeAddress };
          if (dec.homeAddress) setForm((f) => ({ ...f, homeAddress: dec.homeAddress }));
        })
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
      // Seal the home location alongside the plaintext (§9.1 P5); no-op without
      // an HDK. The blob also carries the household NAME (C2) — merge the
      // decrypted copy (falling back to the served plaintext) so it survives.
      if (getHDK() && settings?.householdId) {
        body = await sealUpdate('Household', String(settings.householdId), body, HOUSEHOLD_ENC({
          name: decryptedHH.current.name ?? household?.name,
          homeAddress: form.homeAddress,
        }));
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

  useHeaderCheckButton(navigation, { onPress: save, loading: saving });

  // ── Reminders ──────────────────────────────────────────────────────────────
  const { prefs, set: setPref } = usePrivacyPrefs();
  const [perm, setPerm] = useState<Notifications.PermissionStatus | null>(null);

  const refreshPermission = useCallback(() => {
    Notifications.getPermissionsAsync()
      .then(({ status }) => setPerm(status))
      .catch(() => {});
  }, []);

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

  const hasPassword = user?.hasPassword !== false;

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
    // The new password must re-wrap the E2EE key, which needs the key in hand.
    // Changing it while locked would swap the sign-in password but leave the key
    // wrapped under the OLD one — the new password then silently fails to unlock.
    if (!isUnlocked()) {
      setPwError('Unlock your encryption first (Profile → Privacy & data) so your new password can unlock your data too.');
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
    // Password accounts must type their password first; passwordless
    // (passkey/OAuth) accounts have none, so the session token is the proof.
    if (hasPassword && !delPw) return;
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
      await authApi.deleteAccount(hasPassword ? { password: delPw } : {});
      // Account is gone — tear down the session and return to the auth stack.
      await logout();
    } catch (e: any) {
      setDelError(e?.response?.data?.error || 'Could not delete your account. Please try again.');
      setDelBusy(false);
    }
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

        {/* Sign out lives inside the Account section, below the identity card,
            so it collapses away with it. */}
        <View style={styles.signOut}>
          <Button title="Sign out" variant="danger" onPress={() => logout()} />
        </View>
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

      {/* ── Sign-in ── */}
      <AccordionSection
        icon="key-outline"
        title="Sign-in"
        subtitle="Email & password"
        expanded={open.security}
        onToggle={() => toggle('security')}
      >
        <Card style={styles.sectionCard}>
          <SectionTitle>Sign-in</SectionTitle>
          <Text style={styles.cardNote}>
            Face ID, passkeys and recovery codes live in Profile → Privacy & data.
          </Text>

          <View style={styles.secRow}>
            <View style={styles.secText}>
              <Text style={styles.secLabel}>Email</Text>
              <Text style={styles.secValue}>{user?.email}</Text>
            </View>
            {/* Changing email re-authenticates with the account password, which a
                passwordless account doesn't have — so only offer it when there
                is one to confirm with. */}
            {hasPassword ? (
              <Button title={emailOpen ? 'Close' : 'Change'} variant="ghost" onPress={() => setEmailOpen((o) => !o)} />
            ) : null}
          </View>
          {!hasPassword ? (
            <Text style={styles.hint}>This is a passwordless account. Changing your email isn’t available yet.</Text>
          ) : null}
          {hasPassword && emailOpen ? (
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

          {hasPassword ? (
            <View style={styles.secRow}>
              <View style={styles.secText}>
                <Text style={styles.secLabel}>Password</Text>
                <Text style={styles.secValue}>••••••••</Text>
              </View>
              <Button title={pwOpen ? 'Close' : 'Change'} variant="ghost" onPress={() => setPwOpen((o) => !o)} />
            </View>
          ) : (
            <View style={styles.secRow}>
              <View style={styles.secText}>
                <Text style={styles.secLabel}>Password</Text>
                <Text style={styles.secValue}>Passwordless — sign in with Face ID or an email code</Text>
              </View>
            </View>
          )}
          {hasPassword && pwOpen ? (
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
      </AccordionSection>

      {/* ── Delete account (always visible, Apple 5.1.1(v)) ── */}
      <Card style={[styles.sectionCard, styles.dangerCard]}>
        <SectionTitle>Delete account</SectionTitle>
        <Text style={styles.cardNote}>
          Permanently delete your account and all your data, including anything you added to your household. This can’t be
          undone.
        </Text>
        {delOpen ? (
          <View style={styles.expand}>
            {hasPassword ? (
              <Input
                label="Confirm your password"
                value={delPw}
                onChangeText={setDelPw}
                secureTextEntry
                autoCapitalize="none"
              />
            ) : null}
            {delError ? <Text style={styles.error}>{delError}</Text> : null}
            <Button
              title="Permanently delete account"
              variant="danger"
              onPress={confirmDelete}
              loading={delBusy}
              disabled={(hasPassword && !delPw) || delBusy}
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
  signOut: { marginTop: spacing.md, marginBottom: spacing.md },
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
  // Sign-in
  secRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  secText: { flex: 1, minWidth: 0 },
  secLabel: { fontSize: 12, color: colors.textMuted },
  secValue: { fontSize: 15, color: colors.text, marginTop: 2 },
  expand: { marginTop: spacing.sm },
  error: { color: colors.error, fontSize: 13, marginBottom: spacing.sm },
});
