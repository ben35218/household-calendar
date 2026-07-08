// WebAuthn passkey ceremonies (Phase 1 follow-through: the biometric unlock
// factor). A passkey's PRF extension gives us 32 authenticator-derived bytes
// that only a successful Face ID / Touch ID assertion can reproduce — that
// output is the secret that wraps the identity private key (see e2ee.ts /
// @household/crypto enrollment.addPasskey). This module is only the platform
// ceremony layer; no key material is handled here beyond the PRF output.
//
// Requirements (why this can silently no-op):
// - native module → dev-client/EAS rebuild; not available in Expo Go
// - PRF: iOS 18+ / Android with a PRF-capable credential provider
// - the RP ID domain must serve the apple-app-site-association /
//   assetlinks.json files that associate it with this app (webcredentials),
//   and app.json must list it under ios.associatedDomains.
import * as passkeys from 'react-native-passkeys';
import { loadHouseholdCrypto } from '@household/crypto/adapters/native';
import { PASSKEY_RP_ID } from '../config';

export function passkeysSupported(): boolean {
  try {
    return passkeys.isSupported();
  } catch {
    return false; // Expo Go / module not linked yet
  }
}

export interface CreatedPasskey {
  credentialId: string; // base64url
  prfOutput: string | null; // base64url — null when the platform defers PRF to `get`
}

// Register a new passkey for this account and evaluate the PRF at `prfSalt`.
// Returns null if the user cancels the sheet.
export async function createPasskeyWithPrf(opts: {
  userId: string;
  userName: string;
  prfSalt: string; // base64url
}): Promise<CreatedPasskey | null> {
  const crypto = await loadHouseholdCrypto();
  const res = await passkeys.create({
    challenge: crypto.b64(crypto.randomBytes(32)),
    rp: { id: PASSKEY_RP_ID, name: 'Household Calendar' },
    user: {
      id: crypto.b64(new TextEncoder().encode(opts.userId)),
      name: opts.userName,
      displayName: opts.userName,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 },   // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    extensions: { prf: { eval: { first: opts.prfSalt } } },
  });
  if (!res) return null;
  const prf = (res.clientExtensionResults as any)?.prf;
  const first = prf?.results?.first;
  return { credentialId: res.id, prfOutput: typeof first === 'string' ? first : null };
}

// Assert with one of the given credentials and get the PRF output evaluated at
// that credential's own salt. Returns null on cancel or if PRF is unsupported.
export async function getPrfForCredentials(
  creds: { credentialId: string; prfSalt: string }[],
): Promise<{ credentialId: string; prfOutput: string } | null> {
  if (!creds.length) return null;
  const crypto = await loadHouseholdCrypto();
  const res = await passkeys.get({
    challenge: crypto.b64(crypto.randomBytes(32)),
    rpId: PASSKEY_RP_ID,
    allowCredentials: creds.map((c) => ({ id: c.credentialId, type: 'public-key' as const })),
    userVerification: 'required',
    extensions: {
      prf: { evalByCredential: Object.fromEntries(creds.map((c) => [c.credentialId, { first: c.prfSalt }])) },
    },
  });
  if (!res) return null;
  const prf = (res.clientExtensionResults as any)?.prf;
  const first = prf?.results?.first;
  return typeof first === 'string' ? { credentialId: res.id, prfOutput: first } : null;
}
