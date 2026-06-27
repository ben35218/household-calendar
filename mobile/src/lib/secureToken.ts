import * as SecureStore from 'expo-secure-store';

// JWT lives in the device keychain/keystore (not AsyncStorage) so it's
// encrypted at rest. We also keep an in-memory copy so the axios request
// interceptor can attach it synchronously without awaiting SecureStore.
const TOKEN_KEY = 'hc_token';

let cachedToken: string | null = null;

export function getCachedToken(): string | null {
  return cachedToken;
}

export async function loadToken(): Promise<string | null> {
  cachedToken = await SecureStore.getItemAsync(TOKEN_KEY);
  return cachedToken;
}

export async function saveToken(token: string): Promise<void> {
  cachedToken = token;
  await SecureStore.setItemAsync(TOKEN_KEY, token);
}

export async function clearToken(): Promise<void> {
  cachedToken = null;
  await SecureStore.deleteItemAsync(TOKEN_KEY);
}
