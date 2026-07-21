import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './src/lib/queryClient';
import { AuthProvider } from './src/store/auth';
import RootNavigator from './src/navigation/RootNavigator';
import RecoveryCodeModal from './src/components/RecoveryCodeModal';
import PrivacyShield from './src/components/PrivacyShield';

export default function App() {
  return (
    <SafeAreaProvider>
      <KeyboardProvider>
        <QueryClientProvider client={queryClient}>
          <AuthProvider>
            <StatusBar style="light" />
            <RootNavigator />
            {/* One-time E2EE recovery code, shown right after enrollment */}
            <RecoveryCodeModal />
            {/* Screen-security cover: hides decrypted content from the
                app-switcher snapshot while backgrounded (Signal-parity A3) */}
            <PrivacyShield />
          </AuthProvider>
        </QueryClientProvider>
      </KeyboardProvider>
    </SafeAreaProvider>
  );
}
