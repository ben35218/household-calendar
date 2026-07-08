import React, { useCallback, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Card, SectionTitle, Button } from '../../components/ui';
import { getReadiness, reencryptStragglers } from '../../lib/dropMigration';
import { getHDK, ensureHouseholdKey, isUnlocked, regenerateRecoveryCode } from '../../lib/e2ee';
import { useAuth } from '../../store/auth';
import type { E2eeReadiness } from '../../api';
import { colors, spacing } from '../../theme';

type KeyStatus = 'locked' | 'ready' | 'pending' | null;

// §9 whole-household migration UI (owner-facing). Shows the readiness checklist
// (every member enrolled + holding a current-version key + on a compatible app)
// and lets the owner re-encrypt any stragglers before the drop. The final,
// irreversible plaintext drop itself is operator-run (scripts/dropPlaintext.js
// --commit) — this screen prepares and verifies, it doesn't flip the switch.
export default function E2eeMigrationScreen() {
  const { logout } = useAuth();
  const [readiness, setReadiness] = useState<E2eeReadiness | null>(null);
  const [keyStatus, setKeyStatus] = useState<KeyStatus>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [sealing, setSealing] = useState(false);
  const [progress, setProgress] = useState<{ sealed: number; total: number } | null>(null);
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      // Ensure this session holds — or, for a keyless owner, mints — the household
      // key before reading readiness, so a solo owner isn't left "waiting for key
      // access" for a household they own. No-op when locked (no private key in
      // memory, e.g. after an app relaunch restored only the token).
      const ks: KeyStatus = isUnlocked() ? await ensureHouseholdKey() : 'locked';
      setKeyStatus(ks);
      setReadiness(await getReadiness());
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Could not load readiness');
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function runReencrypt() {
    if (!getHDK()) {
      Alert.alert('Unlock required', 'Unlock your account first — the household key is needed to encrypt your data.');
      return;
    }
    setSealing(true);
    setProgress({ sealed: 0, total: 0 });
    try {
      const res = await reencryptStragglers((p) => setProgress(p));
      Alert.alert(
        'Done',
        res.total === 0
          ? 'Every record was already encrypted.'
          : `Encrypted ${res.sealed} of ${res.total} records${res.failed ? `, ${res.failed} failed` : ''}.`,
      );
      await load();
    } catch (e: any) {
      Alert.alert('Could not finish', e?.message || 'Please try again.');
    } finally {
      setSealing(false);
      setProgress(null);
    }
  }

  async function regenerate() {
    setRecoveryBusy(true);
    try {
      // Surfaces the new code via the one-time RecoveryCodeModal; null = locked.
      const code = await regenerateRecoveryCode();
      if (!code) Alert.alert('Sign in again', 'Sign out and back in to manage your recovery code.');
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not regenerate your recovery code');
    } finally {
      setRecoveryBusy(false);
    }
  }

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const ready = !!readiness?.ready;

  // Personal encryption status — what THIS device/account is doing right now,
  // as opposed to the household-wide readiness checklist below. `keyStatus`
  // reflects whether this session holds the household key: 'ready' means we're
  // actively sealing everything saved, even before the whole household finishes
  // its switch (readiness.e2eeActive). This is the "am I encrypted?" answer.
  const active = !!readiness?.e2eeActive;
  const hero =
    keyStatus === 'locked'
      ? {
          icon: 'lock-closed' as const,
          color: colors.warning,
          title: 'Encryption is locked on this device',
          detail:
            'Sign in again with your password to unlock your encryption key here. Your data stays protected in the meantime.',
        }
      : keyStatus === 'pending'
        ? {
            icon: 'time-outline' as const,
            color: colors.warning,
            title: 'Setting up your encryption',
            detail:
              'Waiting for a household member to grant this device access to your shared encryption key.',
          }
        : active
          ? {
              icon: 'shield-checkmark' as const,
              color: colors.success,
              title: 'End-to-end encryption is on',
              detail:
                'Your household’s data is end-to-end encrypted. Only members of your household can read it — not even we can.',
            }
          : {
              icon: 'shield-checkmark' as const,
              color: colors.success,
              title: 'Your data is encrypted',
              detail:
                'This device encrypts everything you save with your household’s key. Your household is still finishing its switch to full end-to-end encryption (see readiness below).',
            };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={[styles.card, styles.hero, { borderColor: hero.color }]}>
        <View style={styles.rowCenter}>
          <Ionicons name={hero.icon} size={24} color={hero.color} />
          <Text style={[styles.heroTitle, { color: hero.color }]}>{hero.title}</Text>
        </View>
        <Text style={styles.heroDetail}>{hero.detail}</Text>
        {keyStatus === 'locked' ? (
          <Button title="Sign in again to unlock" onPress={() => logout()} />
        ) : null}
      </Card>

      {keyStatus !== 'locked' ? (
        <Card style={styles.card}>
          <SectionTitle>Recovery code</SectionTitle>
          <Text style={styles.note}>
            Your recovery code is a backup way to unlock your encryption key if you lose your password — resetting your
            password restores sign-in only, not your encrypted data.
          </Text>
          <Button
            title="Regenerate recovery code"
            variant="ghost"
            loading={recoveryBusy}
            onPress={regenerate}
          />
        </Card>
      ) : null}

      <Card style={styles.card}>
        <SectionTitle>Readiness</SectionTitle>
        <Text style={styles.note}>
          Before your household can switch to end-to-end encryption, every member must have set up their key and be on a
          compatible app version.
        </Text>
        <View style={[styles.statusPill, ready ? styles.pillOk : styles.pillWait]}>
          <Ionicons name={ready ? 'checkmark-circle' : 'time-outline'} size={16} color={ready ? colors.success : colors.warning} />
          <Text style={[styles.statusText, { color: ready ? colors.success : colors.warning }]}>
            {ready ? 'Ready to migrate' : 'Not ready yet'}
          </Text>
        </View>

        {(readiness?.perMember || []).map((m) => {
          const ok = m.enrolled && m.hasEnvelope && m.versionOk;
          return (
            <View key={m.userId} style={styles.memberRow}>
              <Ionicons name={ok ? 'checkmark-circle' : 'ellipse-outline'} size={18} color={ok ? colors.success : colors.textMuted} />
              <View style={styles.memberText}>
                <Text style={styles.memberEmail}>{m.email}</Text>
                <Text style={styles.memberDetail}>
                  {!m.enrolled
                    ? 'Key not set up'
                    : !m.hasEnvelope
                      ? 'Waiting for key access'
                      : !m.versionOk
                        ? `App ${m.clientVersion || 'unknown'} — update needed`
                        : 'Ready'}
                </Text>
              </View>
            </View>
          );
        })}

        {readiness?.reasons?.length ? (
          <View style={styles.reasons}>
            {readiness.reasons.map((r, i) => (
              <Text key={i} style={styles.reasonLine}>• {r}</Text>
            ))}
          </View>
        ) : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}
      </Card>

      {!readiness?.e2eeActive && keyStatus !== 'locked' ? (
        <Card style={styles.card}>
          <SectionTitle>Prepare your data</SectionTitle>
          <Text style={styles.note}>
            Encrypt any records that were created before encryption was set up. Safe to run more than once — it only
            touches records that aren’t encrypted yet.
          </Text>
          {sealing ? (
            <View style={styles.rowCenter}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.progressText}>
                Encrypting… {progress ? `${progress.sealed}/${progress.total}` : ''}
              </Text>
            </View>
          ) : (
            <Button title="Re-encrypt older records" onPress={runReencrypt} />
          )}
          <Text style={styles.hint}>
            The final switch to end-to-end encryption is done by an administrator once everyone here is ready.
          </Text>
        </Card>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  card: { marginBottom: spacing.md },
  note: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 18 },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 16 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  hero: { borderWidth: 1 },
  heroTitle: { flex: 1, fontSize: 16, fontWeight: '700' },
  heroDetail: { fontSize: 13, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 18 },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, marginBottom: spacing.sm },
  pillOk: { backgroundColor: 'rgba(76,175,80,0.12)' },
  pillWait: { backgroundColor: 'rgba(255,167,38,0.12)' },
  statusText: { fontSize: 13, fontWeight: '700' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  memberText: { flex: 1 },
  memberEmail: { fontSize: 14, color: colors.text },
  memberDetail: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  reasons: { marginTop: spacing.sm },
  reasonLine: { fontSize: 12, color: colors.textMuted, lineHeight: 17 },
  progressText: { color: colors.textMuted, fontSize: 13 },
  error: { color: colors.error, fontSize: 13, marginTop: spacing.sm },
});
