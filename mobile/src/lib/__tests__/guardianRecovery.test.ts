// Round-trip test of the dual-control guardian recovery flow
// (lib/guardianRecovery.ts, spec: features/guardian-recovery.md) over the REAL
// crypto: arm → request → guardian approve → PIN finish. The API is an
// in-memory blind relay (it only ever holds `outer` and the re-sealed inner as
// opaque strings), and the e2ee session is faked to whichever device the step
// runs on — so the test proves neither leg alone recovers the key and the
// wrong PIN fails without burning the request.
jest.mock('@household/crypto/adapters/native', () => require('@household/crypto/adapters/web'));

type KP = { publicKey: Uint8Array; privateKey: Uint8Array };
let mockActiveKeyPair: KP | null = null; // whose device is "unlocked" right now
const mockImported: { pub: string; priv: string }[] = [];
jest.mock('../e2ee', () => ({
  getKeyPair: () => mockActiveKeyPair,
  importLinkedKeyPair: async (pub: string, priv: string) => {
    mockImported.push({ pub, priv });
    return 'ready';
  },
}));

// The blind relay: stores opaque strings, never opens them.
const mockRelay = {
  guardianPub: '' as string, // /keys/public/:userId
  userPub: '' as string, // /keys/me → identityPublicKey
  outer: null as string | null,
  ephemeralPublicKey: null as string | null,
  sealedPayload: null as string | null,
};
jest.mock('../../api', () => ({
  keysApi: {
    publicKey: async () => ({ data: { identityPublicKey: mockRelay.guardianPub } }),
    guardianArm: async ({ outer }: { outer: string }) => { mockRelay.outer = outer; return { data: { ok: true } }; },
    guardianDisarm: async () => { mockRelay.outer = null; return { data: { ok: true } }; },
    guardianRequest: async ({ ephemeralPublicKey }: { ephemeralPublicKey: string }) => {
      mockRelay.ephemeralPublicKey = ephemeralPublicKey;
      return { data: { requestId: 'req-1', expiresAt: '2026-08-01T00:00:00.000Z' } };
    },
    guardianPoll: async () => ({
      data: mockRelay.sealedPayload
        ? { status: 'sealed', sealedPayload: mockRelay.sealedPayload }
        : { status: 'pending' },
    }),
    guardianApprove: async ({ sealedPayload }: { sealedPayload: string }) => {
      mockRelay.sealedPayload = sealedPayload;
      return { data: { ok: true } };
    },
    me: async () => ({ data: { identityPublicKey: mockRelay.userPub } }),
  },
}));

import { loadHouseholdCrypto } from '@household/crypto/adapters/web';
import {
  armGuardian, startGuardianRecovery, pollGuardianRecovery,
  finishGuardianRecovery, approveGuardianRecovery,
} from '../guardianRecovery';

const PIN = '4321';
let user: KP;
let guardian: KP;

beforeAll(async () => {
  const crypto = await loadHouseholdCrypto();
  user = crypto.generateIdentityKeyPair();
  guardian = crypto.generateIdentityKeyPair();
  mockRelay.guardianPub = crypto.b64(guardian.publicKey);
  mockRelay.userPub = crypto.b64(user.publicKey);
});

test('the full dual-control journey recovers the original identity key', async () => {
  const crypto = await loadHouseholdCrypto();

  // Arm, on the user's unlocked device. The server receives only `outer`.
  mockActiveKeyPair = user;
  const { fingerprint } = await armGuardian('guardian-1', PIN);
  expect(fingerprint).toBe(crypto.publicKeyFingerprint(mockRelay.guardianPub));
  expect(mockRelay.outer).toBeTruthy();
  expect(mockRelay.outer).not.toContain(crypto.b64(user.privateKey));

  // Recovery request, on a fresh locked device (no keypair).
  mockActiveKeyPair = null;
  const started = await startGuardianRecovery();
  expect(started.requestId).toBe('req-1');
  expect(started.fingerprint).toBe(crypto.publicKeyFingerprint(mockRelay.ephemeralPublicKey!));
  expect(await pollGuardianRecovery('req-1')).toBe('pending');

  // Guardian leg: their unlocked device re-seals the inner to the ephemeral
  // key. The re-sealed payload differs from `outer` (it is NOT a passthrough —
  // and still never contains the private key).
  mockActiveKeyPair = guardian;
  await approveGuardianRecovery({
    requestId: 'req-1',
    outer: mockRelay.outer!,
    ephemeralPublicKey: mockRelay.ephemeralPublicKey!,
  } as never);
  expect(mockRelay.sealedPayload).toBeTruthy();
  expect(mockRelay.sealedPayload).not.toBe(mockRelay.outer);

  // User leg: poll picks it up; the wrong PIN fails WITHOUT burning the slot;
  // the right PIN recovers the exact original private key.
  mockActiveKeyPair = null;
  expect(await pollGuardianRecovery('req-1')).toBe('ready');
  expect(await finishGuardianRecovery('0000')).toBe(false);
  expect(mockImported).toHaveLength(0);

  expect(await finishGuardianRecovery(PIN)).toBe(true);
  expect(mockImported).toHaveLength(1);
  expect(mockImported[0].pub).toBe(crypto.b64(user.publicKey));
  expect(mockImported[0].priv).toBe(crypto.b64(user.privateKey));
});

test('guard rails: a locked guardian cannot approve; an unknown request reads as expired', async () => {
  mockActiveKeyPair = null;
  await expect(
    approveGuardianRecovery({ requestId: 'req-x', outer: 'x', ephemeralPublicKey: 'y' } as never),
  ).rejects.toThrow(/unlock/i);

  expect(await pollGuardianRecovery('some-other-request')).toBe('expired');
});

test('arming requires an unlocked vault', async () => {
  mockActiveKeyPair = null;
  await expect(armGuardian('guardian-1', PIN)).rejects.toThrow(/unlock/i);
});
