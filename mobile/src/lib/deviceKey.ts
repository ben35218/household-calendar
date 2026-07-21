import * as SecureStore from 'expo-secure-store';

// Biometric-gated device cache of the E2EE identity private key.
//
// After the first successful unlock on a device we stash the keypair here so
// later app launches unlock with a single Face ID / Touch ID prompt instead of
// the account password. This is a *convenience* cache, not a recovery path:
//   - WHEN_UNLOCKED_THIS_DEVICE_ONLY → never migrates to a new device / backup,
//     so it can't leak the key off the phone. Cross-device recovery is the
//     synced passkey's job (docs/E2EE-SYNC-PLAN.md §1.1 / §5).
//   - requireAuthentication → the OS gates every read behind the biometric /
//     passcode check, backed by the Secure Enclave. The plaintext key never
//     leaves the keychain without a live user presence check.
// The server never sees any of this — it only ever holds ciphertext envelopes.
const DEVICE_KEY = 'hc_device_key';
// A cheap, non-auth marker so we can tell the cache is armed WITHOUT triggering
// a biometric prompt (reading DEVICE_KEY itself would). Kept in sync with it.
const MARKER = 'hc_device_key_on';

const AUTH_OPTS: SecureStore.SecureStoreOptions = {
  requireAuthentication: true,
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  authenticationPrompt: 'Unlock your encrypted data',
};

// Whether a device key has been stashed (no biometric prompt).
export async function isDeviceKeyEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(MARKER)) === '1';
  } catch {
    return false;
  }
}

// Stash the serialized keypair behind the biometric gate. Best-effort: on a
// device with no passcode/biometric enrolled the write throws and we no-op
// (the account still unlocks via password / passkey / recovery code).
export async function saveDeviceKey(serialized: string): Promise<boolean> {
  try {
    await SecureStore.setItemAsync(DEVICE_KEY, serialized, AUTH_OPTS);
    await SecureStore.setItemAsync(MARKER, '1');
    return true;
  } catch {
    await clearDeviceKey().catch(() => {});
    return false;
  }
}

// Read the serialized keypair, prompting for Face ID / Touch ID. Returns null on
// cancel, failure, or when nothing is stashed.
export async function loadDeviceKey(): Promise<string | null> {
  try {
    return await SecureStore.getItemAsync(DEVICE_KEY, AUTH_OPTS);
  } catch {
    return null;
  }
}

export async function clearDeviceKey(): Promise<void> {
  await SecureStore.deleteItemAsync(DEVICE_KEY).catch(() => {});
  await SecureStore.deleteItemAsync(MARKER).catch(() => {});
}
