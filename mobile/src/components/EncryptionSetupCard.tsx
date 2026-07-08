import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { Ionicons } from '@expo/vector-icons';
import { Card, SectionTitle, Button } from './ui';
import { getReadiness, reencryptStragglers } from '../lib/dropMigration';
import { getHDK } from '../lib/e2ee';
import type { E2eeReadiness } from '../api';
import { colors, spacing } from '../theme';

// Owner-facing §9 migration checklist, shown on HouseholdScreen only while the
// household hasn't switched to full E2EE yet (and only to the owner). Regular
// members see just the personal status hero on SecurityScreen — this card is
// the one place the household-wide "is everyone ready" plumbing surfaces.
// The final, irreversible plaintext drop itself is operator-run
// (scripts/dropPlaintext.js --commit) — this card prepares and verifies.
export default function EncryptionSetupCard() {
  const [readiness, setReadiness] = useState<E2eeReadiness | null>(null);
  const [error, setError] = useState('');
  const [sealing, setSealing] = useState(false);
  const [progress, setProgress] = useState<{ sealed: number; total: number } | null>(null);

  const load = useCallback(async () => {
    setError('');
    try {
      setReadiness(await getReadiness());
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Could not load readiness');
    }
  }, []);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function runReencrypt() {
    if (!getHDK()) {
      Alert.alert('Locked', 'Unlock your encryption first (Profile → Sign-in & Security).');
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

  if (!readiness && !error) return null; // quiet until loaded — this is secondary content

  const ready = !!readiness?.ready;

  return (
    <Card style={styles.card}>
      <SectionTitle>Encryption setup</SectionTitle>
      <Text style={styles.note}>
        Your household is switching to full end-to-end encryption. Everyone must have their key set up and be on a
        current app version; then support completes the switch.
      </Text>

      {readiness ? (
        <>
          <View style={[styles.statusPill, ready ? styles.pillOk : styles.pillWait]}>
            <Ionicons
              name={ready ? 'checkmark-circle' : 'time-outline'}
              size={16}
              color={ready ? colors.success : colors.warning}
            />
            <Text style={[styles.statusText, { color: ready ? colors.success : colors.warning }]}>
              {ready ? 'Everyone is ready' : 'Not ready yet'}
            </Text>
          </View>

          {(readiness.perMember || []).map((m) => {
            const ok = m.enrolled && m.hasEnvelope && m.versionOk;
            return (
              <View key={m.userId} style={styles.memberRow}>
                <Ionicons
                  name={ok ? 'checkmark-circle' : 'ellipse-outline'}
                  size={18}
                  color={ok ? colors.success : colors.textMuted}
                />
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

          {sealing ? (
            <View style={styles.rowCenter}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.progressText}>
                Encrypting… {progress ? `${progress.sealed}/${progress.total}` : ''}
              </Text>
            </View>
          ) : (
            <Button title="Encrypt older records" variant="ghost" onPress={runReencrypt} />
          )}
          <Text style={styles.hint}>
            Encrypts anything created before your key existed. Safe to run more than once.
          </Text>
        </>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Card>
  );
}

const styles = StyleSheet.create({
  card: { marginBottom: spacing.md },
  note: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 18 },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm, lineHeight: 16 },
  rowCenter: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.sm },
  statusPill: { flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start', paddingVertical: 6, paddingHorizontal: 10, borderRadius: 999, marginBottom: spacing.sm },
  pillOk: { backgroundColor: 'rgba(76,175,80,0.12)' },
  pillWait: { backgroundColor: 'rgba(255,167,38,0.12)' },
  statusText: { fontSize: 13, fontWeight: '700' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  memberText: { flex: 1 },
  memberEmail: { fontSize: 14, color: colors.text },
  memberDetail: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  progressText: { color: colors.textMuted, fontSize: 13 },
  error: { color: colors.error, fontSize: 13, marginTop: spacing.sm },
});
