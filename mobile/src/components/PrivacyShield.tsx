import React, { useEffect, useState } from 'react';
import { AppState, AppStateStatus, Image, StyleSheet, View } from 'react-native';
import { usePrivacyPrefs } from '../lib/privacyPrefs';
import { applyScreenSecurity } from '../lib/screenSecurity';
import { colors } from '../theme';

// Signal-parity A3: while the "Screen security" pref is on,
//  1. screenshots/recording are blocked where the platform supports it, and
//  2. the moment the app leaves the foreground, an opaque cover replaces the
//     UI so the iOS app-switcher snapshot (and Android recents) shows the
//     wordmark instead of decrypted household data.
// Mounted once at the root, above the navigator.
export default function PrivacyShield() {
  const { prefs } = usePrivacyPrefs();
  const [covered, setCovered] = useState(false);

  useEffect(() => {
    applyScreenSecurity(prefs.screenSecurity);
  }, [prefs.screenSecurity]);

  useEffect(() => {
    if (!prefs.screenSecurity) { setCovered(false); return; }
    const sub = AppState.addEventListener('change', (s: AppStateStatus) => {
      setCovered(s !== 'active');
    });
    return () => sub.remove();
  }, [prefs.screenSecurity]);

  if (!covered) return null;
  return (
    <View style={styles.cover} pointerEvents="none">
      <Image
        source={require('../../assets/calen-wordmark.png')}
        style={styles.wordmark}
        resizeMode="contain"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  cover: {
    position: 'absolute',
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.background,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 9999,
  },
  wordmark: { width: 200, height: 80, opacity: 0.9 },
});
