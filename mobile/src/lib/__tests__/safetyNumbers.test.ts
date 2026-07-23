// Safety-number lifecycle (lib/safetyNumbers.ts, spec: features/households-sharing.md):
// fingerprints are computed with the REAL crypto; the member-keys API and the
// device-local AsyncStorage store are in-memory fakes. Pins the Signal-parity
// contract: unverified → verified sticks to a fingerprint, and a member whose
// key CHANGES flips to 'changed' until re-verified at the new number.
jest.mock('@household/crypto/adapters/native', () => require('@household/crypto/adapters/web'));

const mockStorage = new Map<string, string>();
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: async (k: string) => mockStorage.get(k) ?? null,
  setItem: async (k: string, v: string) => { mockStorage.set(k, v); },
  removeItem: async (k: string) => { mockStorage.delete(k); },
}));

let mockMembers: { userId: string; identityPublicKey: string }[] = [];
jest.mock('../../api', () => ({
  householdApi: { memberKeys: async () => ({ data: mockMembers }) },
}));

// The real fingerprint, without dragging the whole e2ee session module in.
jest.mock('../e2ee', () => ({
  publicKeyFingerprint: async (b64: string) => {
    const { loadHouseholdCrypto } = require('@household/crypto/adapters/web');
    return (await loadHouseholdCrypto()).publicKeyFingerprint(b64);
  },
}));

import { loadHouseholdCrypto } from '@household/crypto/adapters/web';
import { loadSafetyNumbers, markVerified, clearVerified } from '../safetyNumbers';

test('verify → verified; key change → changed; re-verify at the new number; clear resets', async () => {
  const crypto = await loadHouseholdCrypto();
  const alice = crypto.b64(crypto.generateIdentityKeyPair().publicKey);
  const bob = crypto.b64(crypto.generateIdentityKeyPair().publicKey);
  const self = crypto.b64(crypto.generateIdentityKeyPair().publicKey);
  mockMembers = [
    { userId: 'self', identityPublicKey: self },
    { userId: 'alice', identityPublicKey: alice },
    { userId: 'bob', identityPublicKey: bob },
  ];

  // Fresh device: everyone (except self, who is excluded) is unverified.
  let rows = await loadSafetyNumbers('self');
  expect(rows.map((r) => r.userId).sort()).toEqual(['alice', 'bob']);
  expect(rows.every((r) => r.status === 'unverified')).toBe(true);

  // Verify Alice at her current fingerprint — sticky across reloads.
  const aliceRow = rows.find((r) => r.userId === 'alice')!;
  await markVerified('alice', aliceRow.fingerprint);
  rows = await loadSafetyNumbers('self');
  expect(rows.find((r) => r.userId === 'alice')!.status).toBe('verified');
  expect(rows.find((r) => r.userId === 'bob')!.status).toBe('unverified');

  // Alice's key changes (re-enrollment / attack): the safety number changed.
  const aliceNewKey = crypto.b64(crypto.generateIdentityKeyPair().publicKey);
  mockMembers = mockMembers.map((m) => (m.userId === 'alice' ? { ...m, identityPublicKey: aliceNewKey } : m));
  rows = await loadSafetyNumbers('self');
  const changed = rows.find((r) => r.userId === 'alice')!;
  expect(changed.status).toBe('changed');
  expect(changed.fingerprint).not.toBe(aliceRow.fingerprint);

  // Re-verifying at the NEW number restores 'verified'; clearing resets.
  await markVerified('alice', changed.fingerprint);
  rows = await loadSafetyNumbers('self');
  expect(rows.find((r) => r.userId === 'alice')!.status).toBe('verified');
  await clearVerified('alice');
  rows = await loadSafetyNumbers('self');
  expect(rows.find((r) => r.userId === 'alice')!.status).toBe('unverified');
});
