import React from 'react';
import { StyleSheet } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, spacing } from '../../theme';

// Shared scaffold for the pre-auth screens (Login / Register / Forgot password).
// A keyboard-aware scroll view so tall content (e.g. the password path's extra
// fields, or the keyboard on a small device) can scroll instead of running off
// the top and bottom of the screen. Safe-area padding keeps the title clear of
// the notch/status bar; the content stays vertically centered while it fits.
export function AuthScaffold({ children }: { children: React.ReactNode }) {
  const insets = useSafeAreaInsets();
  return (
    <KeyboardAwareScrollView
      style={styles.container}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.lg, paddingBottom: insets.bottom + spacing.lg },
      ]}
      bottomOffset={spacing.lg}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="interactive"
      showsVerticalScrollIndicator={false}
    >
      {children}
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.primary },
  content: { flexGrow: 1, justifyContent: 'center', paddingHorizontal: spacing.lg },
});
