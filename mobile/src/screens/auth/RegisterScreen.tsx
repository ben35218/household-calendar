import React, { useState } from 'react';
import { View, Text, StyleSheet, KeyboardAvoidingView } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../store/auth';
import { Button, Input } from '../../components/ui';
import { spacing } from '../../theme';
import { authStyles, authInputProps, AUTH_PRIMARY_BTN_COLOR, keyboardBehavior } from './authStyles';
import type { AuthStackParamList } from '../../navigation/AuthNavigator';

export default function RegisterScreen() {
  const nav = useNavigation<NativeStackNavigationProp<AuthStackParamList>>();
  const { register } = useAuth();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleRegister() {
    setLoading(true);
    setError('');
    try {
      await register({ email: email.trim(), password, firstName: firstName.trim(), lastName: lastName.trim() });
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Registration failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <KeyboardAvoidingView style={authStyles.container} behavior={keyboardBehavior}>
      <View style={authStyles.inner}>
        <Text style={[authStyles.title, styles.title]}>Create your account</Text>
        <Input label="First name" value={firstName} onChangeText={setFirstName} {...authInputProps} />
        <Input label="Last name (optional)" value={lastName} onChangeText={setLastName} {...authInputProps} />
        <Input label="Email" value={email} onChangeText={setEmail} autoCapitalize="none" keyboardType="email-address" {...authInputProps} />
        <Input label="Password" value={password} onChangeText={setPassword} secureTextEntry {...authInputProps} />

        {error ? <Text style={authStyles.error}>{error}</Text> : null}

        <Button title="Create account" onPress={handleRegister} loading={loading} color={AUTH_PRIMARY_BTN_COLOR} />

        <View style={authStyles.footer}>
          <Text style={authStyles.footerText}>Already have an account? </Text>
          <Text style={authStyles.link} onPress={() => nav.navigate('Login')}>
            Sign in
          </Text>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  title: { marginTop: 0, marginBottom: spacing.lg, textAlign: 'center' },
});
