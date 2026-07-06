// One-time recovery-code modal, shown right after first-time E2EE enrollment.
// The code is a high-entropy fallback that can unlock the account's encrypted
// data if the password/passkey is lost. It is NEVER stored server-side — lose
// every factor and the data is unrecoverable by design (no server escrow). The
// "I've saved it" gate is deliberate friction. Mirrors the web RecoveryCodeDialog.

import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, Pressable } from 'react-native';
import * as Clipboard from 'expo-clipboard';
import { colors, spacing, radius } from '../theme';
import { Button } from './ui';
import {
  subscribeRecoveryCode,
  getPendingRecoveryCode,
  clearRecoveryCode,
} from '../lib/e2ee';

export default function RecoveryCodeModal() {
  const [code, setCode] = useState<string | null>(getPendingRecoveryCode());
  const [acknowledged, setAcknowledged] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => subscribeRecoveryCode(() => setCode(getPendingRecoveryCode())), []);

  async function copy() {
    if (!code) return;
    await Clipboard.setStringAsync(code);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  function done() {
    setAcknowledged(false);
    clearRecoveryCode();
  }

  return (
    <Modal visible={!!code} transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.backdrop}>
        <View style={styles.card}>
          <Text style={styles.title}>Save your recovery code</Text>
          <Text style={styles.body}>
            Your data is end-to-end encrypted. This one-time code is the only way to
            regain access if you lose your password and other sign-in methods.{' '}
            <Text style={styles.bold}>We can’t recover it for you.</Text>
          </Text>

          <View style={styles.codeBox}>
            <Text style={styles.code} selectable>{code}</Text>
          </View>

          <Pressable onPress={copy} style={styles.copyBtn}>
            <Text style={styles.copyText}>{copied ? 'Copied ✓' : 'Copy code'}</Text>
          </Pressable>

          <Text style={styles.note}>
            Resetting your password restores sign-in only — it does not by itself
            decrypt old data. Keep this code.
          </Text>

          <Pressable style={styles.check} onPress={() => setAcknowledged((v) => !v)}>
            <View style={[styles.checkbox, acknowledged && styles.checkboxOn]}>
              {acknowledged && <Text style={styles.checkmark}>✓</Text>}
            </View>
            <Text style={styles.checkLabel}>I’ve saved my recovery code somewhere safe</Text>
          </Pressable>

          <Button title="Done" onPress={done} disabled={!acknowledged} />
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1, backgroundColor: 'rgba(0,0,0,0.6)',
    alignItems: 'center', justifyContent: 'center', padding: spacing.lg,
  },
  card: {
    width: '100%', maxWidth: 420, backgroundColor: colors.surface,
    borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm,
    borderWidth: 1, borderColor: colors.border,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: '700', marginBottom: spacing.xs },
  body: { color: colors.textMuted, fontSize: 14, lineHeight: 20 },
  bold: { color: colors.text, fontWeight: '700' },
  codeBox: {
    backgroundColor: colors.background, borderRadius: radius.md, padding: spacing.md,
    alignItems: 'center', marginTop: spacing.sm, borderWidth: 1, borderColor: colors.border,
  },
  code: { color: colors.text, fontSize: 20, letterSpacing: 3, fontVariant: ['tabular-nums'] },
  copyBtn: { alignSelf: 'flex-start', paddingVertical: spacing.xs },
  copyText: { color: colors.primary, fontWeight: '600' },
  note: { color: colors.textMuted, fontSize: 12, lineHeight: 17, marginTop: spacing.xs },
  check: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginVertical: spacing.sm },
  checkbox: {
    width: 22, height: 22, borderRadius: 6, borderWidth: 2, borderColor: colors.border,
    alignItems: 'center', justifyContent: 'center',
  },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkmark: { color: '#fff', fontSize: 14, fontWeight: '700' },
  checkLabel: { color: colors.text, flex: 1, fontSize: 14 },
});
