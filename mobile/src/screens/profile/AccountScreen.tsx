import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../store/auth';
import { settingsApi, authApi } from '../../api';
import { registerForPushNotifications } from '../../lib/push';
import { Button, Card, Input, DateField, Select, SectionTitle, Divider } from '../../components/ui';
import PlacesAutocomplete from '../../components/PlacesAutocomplete';
import { colors, spacing } from '../../theme';

const TIMEZONES = [
  'America/Toronto', 'America/New_York', 'America/Chicago',
  'America/Denver', 'America/Los_Angeles', 'America/Vancouver',
  'Europe/London', 'Europe/Paris', 'Australia/Sydney',
].map((t) => ({ label: t, value: t }));

// Mirrors client/src/views/profile/AccountSection.vue. The home-address field
// is a plain text input here; the Google Places autocomplete is wired in across
// every address field in the cross-cutting Places wave.
export default function AccountScreen() {
  const qc = useQueryClient();
  const { user, setUser } = useAuth();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await settingsApi.get()).data,
  });

  const [form, setForm] = useState({
    firstName: '', lastName: '', birthday: '', timezone: 'America/Toronto', homeAddress: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setForm({
      firstName: settings.firstName ?? '',
      lastName: settings.lastName ?? '',
      birthday: settings.birthday ? String(settings.birthday).slice(0, 10) : '',
      timezone: settings.timezone ?? 'America/Toronto',
      homeAddress: settings.homeAddress ?? '',
    });
  }, [settings]);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      await settingsApi.update({
        firstName: form.firstName,
        lastName: form.lastName,
        birthday: form.birthday || undefined,
        timezone: form.timezone,
        homeAddress: form.homeAddress,
      });
      qc.invalidateQueries({ queryKey: ['settings'] });
      Alert.alert('Saved', 'Your account details were updated.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  // ── Change email ──────────────────────────────────────────────────────────
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

  // ── Change password ───────────────────────────────────────────────────────
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
      setPwOpen(false);
      setPwForm({ currentPassword: '', newPassword: '', confirm: '' });
      Alert.alert('Updated', 'Password updated.');
    } catch (e: any) {
      setPwError(e?.response?.data?.error || 'Failed to update password');
    } finally {
      setPwSaving(false);
    }
  }

  // ── Push ──────────────────────────────────────────────────────────────────
  const [pushBusy, setPushBusy] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);
  async function enablePush() {
    setPushBusy(true);
    try {
      const token = await registerForPushNotifications();
      if (token) {
        setPushEnabled(true);
        Alert.alert('Notifications enabled', 'This device will now receive reminders.');
      } else {
        Alert.alert('Not available', 'Push needs a physical device with notifications allowed.');
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not enable notifications.');
    } finally {
      setPushBusy(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <Text style={styles.cardNote}>Your identity and location.</Text>
        <Input label="First name" value={form.firstName} onChangeText={set('firstName')} />
        <Input label="Last name" value={form.lastName} onChangeText={set('lastName')} />
        <DateField label="Your birthday" value={form.birthday} onChange={set('birthday')} clearable />
        <Select
          label="Timezone"
          value={form.timezone}
          options={TIMEZONES}
          onChange={(v) => set('timezone')((v as string) ?? '')}
        />
        <PlacesAutocomplete
          label="Home address"
          value={form.homeAddress}
          onChangeText={set('homeAddress')}
          placeholder="123 Main St, Toronto, ON"
          type="address"
        />
        <Text style={styles.hint}>Used to calculate driving time to event locations and local weather.</Text>
        <Button title="Save" onPress={save} loading={saving} />
      </Card>

      <Card style={styles.card}>
        <SectionTitle>Sign-in & security</SectionTitle>
        <Text style={styles.cardNote}>The email and password you use to log in.</Text>

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

      <Card style={styles.card}>
        <SectionTitle>Push notifications</SectionTitle>
        <Text style={styles.cardNote}>
          {pushEnabled
            ? 'On — alerts arrive on this device.'
            : 'Enable push to get reminders for tasks, chores, and events.'}
        </Text>
        <Button
          title={pushEnabled ? 'Notifications enabled' : 'Enable notifications'}
          variant="ghost"
          disabled={pushEnabled}
          loading={pushBusy}
          onPress={enablePush}
        />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  card: { marginBottom: spacing.md },
  cardNote: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 18 },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 16 },
  secRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  secText: { flex: 1, minWidth: 0 },
  secLabel: { fontSize: 12, color: colors.textMuted },
  secValue: { fontSize: 15, color: colors.text, marginTop: 2 },
  expand: { marginTop: spacing.sm },
  error: { color: colors.error, fontSize: 13, marginBottom: spacing.sm },
});
