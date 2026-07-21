// Screen security (Signal-parity plan A3): block screenshots/screen recording
// of decrypted content (Android FLAG_SECURE; iOS screenshot detection is
// limited, but recording protection applies) and let App.tsx cover the UI when
// backgrounded so the iOS app-switcher snapshot never shows household data.
//
// expo-screen-capture is a NATIVE dep: until the next dev-client/EAS rebuild
// links it, the module isn't present — so it is required lazily and every call
// no-ops gracefully (same pattern as lib/sqliteReplica.ts).

let mod: typeof import('expo-screen-capture') | null | undefined;

function screenCapture() {
  if (mod !== undefined) return mod;
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    mod = require('expo-screen-capture');
  } catch {
    mod = null; // not linked yet — rebuild required
  }
  return mod;
}

export async function applyScreenSecurity(enabled: boolean): Promise<void> {
  const sc = screenCapture();
  if (!sc) return;
  try {
    if (enabled) await sc.preventScreenCaptureAsync();
    else await sc.allowScreenCaptureAsync();
  } catch { /* unsupported platform/simulator */ }
}
