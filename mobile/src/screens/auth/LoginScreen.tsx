import React, { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView, Image } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../store/auth';
import { passkeysSupported } from '../../lib/passkeys';
import { Button, Input } from '../../components/ui';
import { spacing } from '../../theme';
import {
  authStyles,
  authInputProps,
  AUTH_PRIMARY_BTN_COLOR,
  AUTH_GHOST_BTN_COLOR,
  keyboardBehavior,
} from './authStyles';
import type { AuthStackParamList } from '../../navigation/AuthNavigator';

export default function LoginScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const { login, loginWithPasskey } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [passkeyLoading, setPasskeyLoading] = useState(false);

  async function handleLogin() {
    setLoading(true);
    setError('');
    try {
      await login({ email: email.trim(), password });
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Login failed');
    } finally {
      setLoading(false);
    }
  }

  async function handlePasskey() {
    if (!email.trim()) {
      setError('Enter your email, then sign in with your passkey.');
      return;
    }
    setPasskeyLoading(true);
    setError('');
    try {
      await loginWithPasskey(email.trim()); // false = canceled, which needs no message
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Passkey sign-in failed');
    } finally {
      setPasskeyLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={authStyles.container} behavior={keyboardBehavior}>
      <View style={authStyles.inner}>
        <View style={authStyles.header}>
          <Image
            source={require('../../../assets/android-icon-monochrome.png')}
            style={styles.logo}
            resizeMode="contain"
          />
          <Text style={authStyles.title}>Calen</Text>
          <Text style={authStyles.subtitle}>Sign in to your account</Text>
        </View>

        <Input
          label="Email"
          value={email}
          onChangeText={setEmail}
          autoCapitalize="none"
          keyboardType="email-address"
          autoComplete="email"
          {...authInputProps}
        />
        <Input
          label="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          autoComplete="password"
          {...authInputProps}
        />

        {error ? <Text style={authStyles.error}>{error}</Text> : null}

        <Button title="Sign In" onPress={handleLogin} loading={loading} color={AUTH_PRIMARY_BTN_COLOR} />
        {passkeysSupported() ? (
          <View style={styles.passkeyButton}>
            <Button
              title="Sign in with Face ID / passkey"
              variant="ghost"
              onPress={handlePasskey}
              loading={passkeyLoading}
              color={AUTH_GHOST_BTN_COLOR}
            />
          </View>
        ) : null}

        <Text style={[authStyles.link, styles.forgot]} onPress={() => nav.navigate('ForgotPassword')}>
          Forgot password?
        </Text>

        <View style={authStyles.footer}>
          <Text style={authStyles.footerText}>Don't have an account? </Text>
          <Text style={authStyles.link} onPress={() => nav.navigate('Register')}>
            Register
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  logo: { width: 96, height: 96 },
  passkeyButton: { marginTop: spacing.sm },
  forgot: { textAlign: 'center', marginTop: spacing.md },
});
