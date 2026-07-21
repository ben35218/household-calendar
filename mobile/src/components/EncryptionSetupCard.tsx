import React, { useCallback, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { Card, SectionTitle, Button } from './ui';
import { getReadiness } from '../lib/dropMigration';
import { getHDK, activateBornEncryptedHousehold } from '../lib/e2ee';
import type { E2eeReadiness } from '../api';
import { colors, spacing } from '../theme';

// Owner-facing encryption status, shown on HouseholdScreen only while the
// household hasn't finished switching to full E2EE (and only to the owner).
// Regular members see just the personal status hero in Account's Sign-in &
// Security section — this card is the one place the household-wide "is everyone
// ready" plumbing surfaces.
//
// E2EE is mandatory: every household activates on its own the next time the
// owner's key is unlocked (see lib/e2ee maybeActivateBornEncrypted). This card
// mirrors that as an explicit "Turn on encryption now" action — it seals any
// stragglers and drops the server's plaintext copy via the self-serve
// /household/e2ee/activate endpoint (no operator step). The endpoint enforces
// the readiness gate server-side, so it can never strand an un-enrolled member.
export default function EncryptionSetupCard({ e2eeActive = false }: { e2eeActive?: boolean }) {
  const qc = useQueryClient();
  const [readiness, setReadiness] = useState<E2eeReadiness | null>(null);
  const [error, setError] = useState('');
  const [activating, setActivating] = useState(false);

  const load = useCallback(async () => {
    if (e2eeActive) return; // already encrypted — no setup checklist to fetch
    setError('');
    try {
      setReadiness(await getReadiness());
    } catch (e: any) {
      setError(e?.response?.data?.error || e?.message || 'Could not load readiness');
    }
  }, [e2eeActive]);
  useFocusEffect(useCallback(() => { load(); }, [load]));

  async function runActivate() {
    if (!getHDK()) {
      Alert.alert('Locked', 'Unlock your encryption first (Profile → Privacy & data).');
      return;
    }
    setActivating(true);
    try {
      const ok = await activateBornEncryptedHousehold();
      if (ok) {
        qc.invalidateQueries({ queryKey: ['household'] }); // flip the card to "Encrypted"
        Alert.alert('Encryption on', 'Your household is now end-to-end encrypted. Only members with a key can read its data.');
      } else {
        Alert.alert(
          'Almost there',
          'Not everyone has set up their key yet. Encryption turns on automatically once every member is ready.',
        );
      }
      await load();
    } catch (e: any) {
      Alert.alert('Could not finish', e?.message || 'Please try again.');
    } finally {
      setActivating(false);
    }
  }

  if (!e2eeActive && !readiness && !error) return null; // quiet until loaded — this is secondary content

  const ready = !!readiness?.ready;

  if (e2eeActive) {
    return (
      <Card style={styles.card}>
        <SectionTitle>Encryption</SectionTitle>
        <View style={[styles.statusPill, styles.pillOk]}>
          <Ionicons name="lock-closed" size={16} color={colors.success} />
          <Text style={[styles.statusText, { color: colors.success }]}>Encrypted</Text>
        </View>
        <Text style={styles.note}>
          Your household’s data is end-to-end encrypted. Only members with a key can read it — not even support can.
        </Text>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <SectionTitle>Encryption</SectionTitle>
      <View style={[styles.statusPill, styles.pillNeutral]}>
        <Ionicons name="lock-open-outline" size={16} color={colors.textMuted} />
        <Text style={[styles.statusText, { color: colors.textMuted }]}>Not encrypted yet</Text>
      </View>
      <Text style={styles.note}>
        Your household is switching to full end-to-end encryption. It turns on automatically once every member has
        set up their key and saved a recovery method — or you can turn it on now.
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

          {activating ? (
            <View style={styles.rowCenter}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.progressText}>Turning on encryption…</Text>
            </View>
          ) : (
            <Button title="Turn on encryption now" onPress={runActivate} />
          )}
          <Text style={styles.hint}>
            Encrypts everything and drops the server’s plaintext copy. Safe to run more than once.
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
  pillNeutral: { backgroundColor: colors.border },
  statusText: { fontSize: 13, fontWeight: '700' },
  memberRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: 8, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  memberText: { flex: 1 },
  memberEmail: { fontSize: 14, color: colors.text },
  memberDetail: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  progressText: { color: colors.textMuted, fontSize: 13 },
  error: { color: colors.error, fontSize: 13, marginTop: spacing.sm },
});
