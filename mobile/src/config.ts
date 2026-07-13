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
  webUrl?: string;
  termsUrl?: string;
  privacyUrl?: string;
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

// Legal pages linked from the paywall. App Review guideline 3.1.2 requires
// Terms of Use + Privacy Policy links next to auto-renewing subscriptions.
// Served by the household-calendar-web static site (render.yaml → static/).
// Marketing/app-landing site, linked from SMS share invites (the invitee opens
// it to download the app and accept from their in-app Invitations inbox).
export const WEB_URL =
  process.env.EXPO_PUBLIC_WEB_URL || extra.webUrl || 'https://householdcalendar.com';
export const TERMS_URL =
  process.env.EXPO_PUBLIC_TERMS_URL || extra.termsUrl || 'https://householdcalendar.com/terms';
export const PRIVACY_URL =
  process.env.EXPO_PUBLIC_PRIVACY_URL || extra.privacyUrl || 'https://householdcalendar.com/privacy';

// The AI assistant's persona name, shown in chat titles, greetings, and form
// assist. Keep in sync with server/src/config/assistant.js (system prompts).
// Settings/plumbing copy ("AI Usage", "Use AI features") intentionally stays
// generic "AI" so users managing the technology can find it.
export const ASSISTANT_NAME = 'Calvin';
export const ASSISTANT_NAME_SHORT = 'Cal';
