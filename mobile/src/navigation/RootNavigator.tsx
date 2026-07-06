import React from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { NavigationContainer, DarkTheme } from '@react-navigation/native';
import { useAuth } from '../store/auth';
import { useReminderScheduler } from '../hooks/useReminderScheduler';
import AuthNavigator from './AuthNavigator';
import AppNavigator from './AppNavigator';
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

  // On-device reminders (Phase 5): schedule while signed in, refresh on foreground.
  useReminderScheduler(isLoggedIn && !bootstrapping);

  if (bootstrapping) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer theme={navTheme}>
      {isLoggedIn ? <AppNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
});
