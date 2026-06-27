import React from 'react';
import { ActivityIndicator, View, StyleSheet } from 'react-native';
import { NavigationContainer } from '@react-navigation/native';
import { useAuth } from '../store/auth';
import AuthNavigator from './AuthNavigator';
import TabNavigator from './TabNavigator';
import { colors } from '../theme';

// Top-level gate: splash while restoring the session, then either the auth
// stack (logged out) or the main tabs (logged in).
export default function RootNavigator() {
  const { bootstrapping, isLoggedIn } = useAuth();

  if (bootstrapping) {
    return (
      <View style={styles.splash}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <NavigationContainer>
      {isLoggedIn ? <TabNavigator /> : <AuthNavigator />}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  splash: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
});
