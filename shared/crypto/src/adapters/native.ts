/// <reference path="./external-modules.d.ts" />
// Mobile adapter: binds the core to react-native-libsodium (JSI).
//
// Requires an Expo dev/prebuild client (the JSI native module isn't available in
// Expo Go). The API surface matches libsodium-wrappers, so the core is identical
// to the web path — only the instance differs.

import sodium from 'react-native-libsodium';
import { createHouseholdCrypto } from '../core.ts';
import type { Sodium, HouseholdCrypto } from '../index.ts';

let cached: HouseholdCrypto | null = null;

export async function loadHouseholdCrypto(): Promise<HouseholdCrypto> {
  if (cached) return cached;
  const s = sodium as unknown as {
    ready: Promise<void>;
    loadSumoVersion?: () => Promise<void>;
  };
  // react-native-libsodium also exposes a `ready` promise for parity.
  await s.ready;
  // Argon2id (crypto_pwhash) lives in the "sumo" build. It's compiled into the
  // native JSI module, but on the Expo-web target it must be pulled in
  // explicitly — this call is a no-op where it's already present.
  if (typeof s.loadSumoVersion === 'function') await s.loadSumoVersion();
  cached = createHouseholdCrypto(sodium as unknown as Sodium);
  return cached;
}
