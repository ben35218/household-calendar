import Constants from 'expo-constants';

// API base URL resolution order:
//   1. EXPO_PUBLIC_API_URL env var (set per-developer, e.g. your LAN IP for a
//      physical device: http://192.168.1.20:3001)
//   2. expo.extra.apiBaseUrl from app.json (defaults to localhost for simulators)
const fromExtra = (Constants.expoConfig?.extra as { apiBaseUrl?: string } | undefined)?.apiBaseUrl;

export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_URL || fromExtra || 'http://localhost:3001';

export const API_URL = `${API_BASE_URL}/api`;

// RevenueCat public SDK keys (per platform). Set in app.json → expo.extra, or
// via EXPO_PUBLIC_* env vars. When unset, in-app purchases are disabled and the
// paywall shows a "not configured" state instead of crashing.
const extra = (Constants.expoConfig?.extra ?? {}) as {
  revenueCatIosKey?: string;
  revenueCatAndroidKey?: string;
  passkeyRpId?: string;
};

// Passkey relying-party ID: a DOMAIN (no scheme/port) associated with this app
// via apple-app-site-association / assetlinks.json (webcredentials) and listed
// in app.json ios.associatedDomains. Defaults to the API host, which is right
// once the API runs on the real product domain.
const apiHost = API_BASE_URL.replace(/^https?:\/\//, '').split(/[/:]/)[0];
export const PASSKEY_RP_ID =
  process.env.EXPO_PUBLIC_PASSKEY_RP_ID || extra.passkeyRpId || apiHost;

export const REVENUECAT_IOS_KEY =
  process.env.EXPO_PUBLIC_RC_IOS_KEY || extra.revenueCatIosKey || '';
export const REVENUECAT_ANDROID_KEY =
  process.env.EXPO_PUBLIC_RC_ANDROID_KEY || extra.revenueCatAndroidKey || '';
