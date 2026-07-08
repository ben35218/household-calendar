import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useAuth } from '../../store/auth';
import { authApi, householdApi } from '../../api';
import {
  isUnlocked, ensureHouseholdKey, unlockWithPassword, unlockWithPasskey,
  addPasskeyFactor, hasPasskeyFactor, regenerateRecoveryCode, rewrapForNewPassword,
} from '../../lib/e2ee';
import { passkeysSupported } from '../../lib/passkeys';
import { Button, Card, Input, SectionTitle, Divider } from '../../components/ui';
import { colors, spacing } from '../../theme';

type KeyStatus = 'locked' | 'ready' | 'pending' | null;

// Sign-in & Security — the one place for "how I get in and who can read my
// data": encryption status + unlock, email, password, passkey, recovery code.
// These are one concept under the hood too: password / passkey / recovery code
// are the three factor envelopes wrapping the same identity private key.
// (The owner-facing household migration checklist lives on HouseholdScreen.)
export default function SecurityScreen() {
  const qc = useQueryClient();
  const { user, setUser } = useAuth();

  // ── Encryption status + unlock ──────────────────────────────────────────────
  const [keyStatus, setKeyStatus] = useState<KeyStatus>(null);
  const [unlockPw, setUnlockPw] = useState('');
  const [unlockBusy, setUnlockBusy] = useState(false);
  const [unlockError, setUnlockError] = useState('');

  const { data: household } = useQuery({
    queryKey: ['household'],
    queryFn: async () => (await householdApi.get()).data,
  });
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
      const ok = await addPasskeyFactor(String(user?._id || ''), user?.email || 'you');
      if (ok) {
        qc.invalidateQueries({ queryKey: ['passkeyFactor'] });
        Alert.alert('Passkey added', 'Face ID / Touch ID can now unlock your encrypted data on this device.');
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={[styles.card, styles.hero, { borderColor: hero.color }]}>
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

      <Card style={styles.card}>
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
        <Card style={styles.card}>
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

      <Card style={styles.card}>
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
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  card: { marginBottom: spacing.md },
  cardNote: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 18 },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 16 },
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
});
