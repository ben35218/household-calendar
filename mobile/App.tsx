import React from 'react';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './src/lib/queryClient';
import { AuthProvider } from './src/store/auth';
import RootNavigator from './src/navigation/RootNavigator';
import RecoveryCodeModal from './src/components/RecoveryCodeModal';

export default function App() {
  return (
    <SafeAreaProvider>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <StatusBar style="light" />
          <RootNavigator />
          {/* One-time E2EE recovery code, shown right after enrollment */}
          <RecoveryCodeModal />
        </AuthProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
