import React, { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Platform, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { authApi } from '../../api';
import { useAuth } from '../../store/auth';
import { Button, Input } from '../../components/ui';
import { colors, spacing } from '../../theme';
import type { AuthStackParamList } from '../../navigation/AuthNavigator';

// Two-step reset: request an emailed 6-digit code, then set a new password.
// A successful reset signs the user straight in (the auth store swaps to the
// app navigator), so this screen only needs to handle the E2EE caveat: the
// reset can't unlock data that was wrapped under the old password.
export default function ForgotPasswordScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [codeSent, setCodeSent] = useState(false);
  const [code, setCode] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSendCode() {
    if (!email.trim()) {
      setError('Enter your account email.');
      return;
    }
    setLoading(true);
    setError('');
    try {
      await authApi.forgotPassword({ email: email.trim() });
      setCodeSent(true);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Could not send the reset code');
    } finally {
      setLoading(false);
    }
  }

  async function handleReset() {
    setLoading(true);
    setError('');
    try {
      const e2ee = await resetPassword({ email: email.trim(), code: code.trim(), newPassword });
      if (e2ee === 'locked') {
        // Signed in, but the encrypted data is still wrapped under the old
        // password — point at the existing unlock paths rather than blocking.
        Alert.alert(
          'Password reset',
          'You are signed in, but your encrypted data is still locked. Unlock it with Face ID or your recovery code in Profile → Security & data.'
        );
      }
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Reset failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.inner}>
        <View style={styles.header}>
          <Ionicons name="key" size={56} color={colors.primary} />
          <Text style={styles.title}>Reset password</Text>
          <Text style={styles.subtitle}>
            {codeSent
              ? `Enter the 6-digit code we emailed to ${email.trim()}`
              : "We'll email you a 6-digit reset code"}
          </Text>
        </View>

        <Input
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          editable={!codeSent}
        />

        {codeSent ? (
          <>
            <Input
              label="Reset code"
              value={code}
              onChangeText={setCode}
              keyboardType="number-pad"
              autoComplete="one-time-code"
              maxLength={6}
            />
            <Input
              label="New password"
              value={newPassword}
              onChangeText={setNewPassword}
              secureTextEntry
              autoComplete="new-password"
            />
          </>
        ) : null}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {codeSent ? (
          <>
            <Button title="Set New Password" onPress={handleReset} loading={loading} />
            <View style={styles.resend}>
              <Button title="Resend code" variant="ghost" onPress={handleSendCode} />
            </View>
          </>
        ) : (
          <Button title="Email Me a Code" onPress={handleSendCode} loading={loading} />
        )}

        <Text style={styles.link} onPress={() => nav.goBack()}>
          Back to sign in
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  inner: { flex: 1, justifyContent: 'center', padding: spacing.lg },
  header: { alignItems: 'center', marginBottom: spacing.xl },
  title: { fontSize: 24, fontWeight: '700', color: colors.text, marginTop: spacing.sm },
  subtitle: { fontSize: 14, color: colors.textMuted, marginTop: 4, textAlign: 'center' },
  error: { color: colors.error, marginBottom: spacing.md, textAlign: 'center' },
  resend: { marginTop: spacing.sm },
  link: { color: colors.primary, fontWeight: '600', textAlign: 'center', marginTop: spacing.lg },
});
