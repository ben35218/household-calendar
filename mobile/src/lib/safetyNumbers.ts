import AsyncStorage from '@react-native-async-storage/async-storage';
import { householdApi } from '../api';
import { publicKeyFingerprint } from './e2ee';

// Continuous safety numbers (Signal-parity plan A2). Each household member's
// identity public key has a short human-comparable fingerprint (the "safety
// number"). The user can verify a member out-of-band and mark them verified;
// the verified state is LOCAL to this device (it is this user's judgement, not
// server data) and is invalidated automatically if the member's key ever
// changes — that's the Signal "safety number changed" moment.

const STORE_KEY = 'hc_safety_numbers_v1';

export type SafetyStatus = 'unverified' | 'verified' | 'changed';

export interface MemberSafety {
  userId: string;
  fingerprint: string;      // current fingerprint of the member's live key
  status: SafetyStatus;
  verifiedAt?: string;      // when this device last marked them verified
}

interface StoredEntry { fingerprint: string; verifiedAt: string }
type Store = Record<string, StoredEntry>;

async function readStore(): Promise<Store> {
  try {
    const raw = await AsyncStorage.getItem(STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

async function writeStore(store: Store): Promise<void> {
  await AsyncStorage.setItem(STORE_KEY, JSON.stringify(store));
}

// Fetch every enrolled member's key, compute fingerprints, and derive each
// member's status against this device's verified records:
//   verified   — verified here, and the key hasn't changed since
//   changed    — verified here, but the LIVE KEY IS DIFFERENT (alert!)
//   unverified — never verified on this device
export async function loadSafetyNumbers(selfUserId?: string): Promise<MemberSafety[]> {
  const { data } = await householdApi.memberKeys();
  const store = await readStore();
  const out: MemberSafety[] = [];
  for (const m of data) {
    if (selfUserId && String(m.userId) === String(selfUserId)) continue;
    const fingerprint = await publicKeyFingerprint(m.identityPublicKey);
    const saved = store[m.userId];
    const status: SafetyStatus = !saved
      ? 'unverified'
      : saved.fingerprint === fingerprint ? 'verified' : 'changed';
    out.push({ userId: m.userId, fingerprint, status, verifiedAt: saved?.verifiedAt });
  }
  return out;
}

// Mark a member verified at their CURRENT fingerprint (also how a 'changed'
// member is re-verified after comparing the new number out-of-band).
export async function markVerified(userId: string, fingerprint: string): Promise<void> {
  const store = await readStore();
  store[userId] = { fingerprint, verifiedAt: new Date().toISOString() };
  await writeStore(store);
}

export async function clearVerified(userId: string): Promise<void> {
  const store = await readStore();
  delete store[userId];
  await writeStore(store);
}
