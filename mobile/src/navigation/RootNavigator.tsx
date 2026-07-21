import React from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { NavigationContainer, DarkTheme, useNavigationContainerRef } from '@react-navigation/native';
import { useAuth } from '../store/auth';
import { useReminderScheduler } from '../hooks/useReminderScheduler';
import { useAppLock } from '../hooks/useAppLock';
import { useSelfPersonSeed } from '../hooks/useSelfPersonSeed';
import { usePrivacyPrefs } from '../lib/privacyPrefs';
import AuthNavigator from './AuthNavigator';
import AppNavigator from './AppNavigator';
import { RootStackParamList } from './types';
import { colors } from '../theme';

// Dark navigation theme so scene backgrounds (and transition edges) stay dark.
const navTheme = {
  ...DarkTheme,
  colors: {
    ...DarkTheme.colors,
    primary: colors.primary,
    background: colors.background,
    card: colors.primary,
    text: '#fff',
    border: colors.border,
  },
};

// Top-level gate: splash while restoring the session, then either the auth
// stack (logged out) or the main tabs (logged in).
export default function RootNavigator() {
  const { bootstrapping, isLoggedIn } = useAuth();
  const remindersEnabled = usePrivacyPrefs().prefs.remindersEnabled;
  const navRef = useNavigationContainerRef<RootStackParamList>();

  // On-device reminders (Phase 5): schedule while signed in and the user hasn't
  // turned reminders off; refresh on foreground. Flipping the toggle off cancels
  // the pending schedule (the hook's cleanup path).
  useReminderScheduler(isLoggedIn && !bootstrapping && remindersEnabled);

  // App lock (Signal-parity A4): relock the in-memory keys after the configured
  // background window; no-op while the pref is "never".
  useAppLock(isLoggedIn && !bootstrapping);

  // Seed the encrypted "You" Person once unlocked (mandatory E2EE: the server no
  // longer creates it), so person-assignment UIs always have at least the user —
  // not only after the People screen is opened.
  useSelfPersonSeed(isLoggedIn && !bootstrapping);

  if (bootstrapping) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme} ref={navRef}>
      {isLoggedIn ? <AppNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
});
