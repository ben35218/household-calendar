// Web / admin adapter: binds the core to libsodium-wrappers (WASM).
//
//   const crypto = await loadHouseholdCrypto();
//   const kp = crypto.generateIdentityKeyPair();
//
// libsodium's WASM must finish initializing before any call, hence `.ready`.
// The `-sumo` build is required for Argon2id (crypto_pwhash), which the base
// build omits.

import _sodium from 'libsodium-wrappers-sumo';
import { createHouseholdCrypto } from '../core.ts';
import type { Sodium, HouseholdCrypto } from '../index.ts';

let cached: HouseholdCrypto | null = null;

export async function loadHouseholdCrypto(): Promise<HouseholdCrypto> {
  if (cached) return cached;
  await _sodium.ready;
  cached = createHouseholdCrypto(_sodium as unknown as Sodium);
  return cached;
}
