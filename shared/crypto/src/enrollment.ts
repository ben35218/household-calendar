// Client-side enrollment + unlock orchestration, shared by web and mobile.
//
// Pure logic over a HouseholdCrypto instance — no HTTP, no storage. Each client
// supplies its own API calls (POST /keys/enroll, GET /keys/me) and its own
// in-memory key holder; this module just turns a password (and a generated
// recovery code) into the envelopes the server stores, and turns stored
// envelopes back into an unlocked keypair. See docs/E2EE-SYNC-PLAN.md §3.4.

import type { HouseholdCrypto } from './core.ts';
import type { FactorEnvelope, IdentityKeyPair, PasswordFactorEnvelope, SecretFactorEnvelope } from './types.ts';

// What the server returns from GET /keys/me.
export interface StoredKeyMaterial {
  identityPublicKey: string;
  wrappedPrivateKey: FactorEnvelope[];
}

export interface EnrollmentPayload {
  identityPublicKey: string; // b64url — POST to /keys/enroll
  factors: FactorEnvelope[]; // POST to /keys/enroll
}

export interface EnrollmentResult {
  payload: EnrollmentPayload; // send to the server
  recoveryCodeDisplay: string; // SHOW ONCE, never stored server-side
  keyPair: IdentityKeyPair; // keep in memory — the account is now unlocked
}

function findFactor(material: StoredKeyMaterial, kind: FactorEnvelope['factor']): FactorEnvelope {
  const env = material.wrappedPrivateKey.find((f) => f.factor === kind);
  if (!env) throw new Error(`No ${kind} factor enrolled on this account`);
  return env;
}

export function createEnrollment(crypto: HouseholdCrypto) {
  // First-time enrollment: new identity keypair wrapped by a password factor and
  // a one-time recovery code (the two baseline factors — passkey is added later
  // where the platform supports PRF).
  function enroll(password: string): EnrollmentResult {
    const keyPair = crypto.generateIdentityKeyPair();
    const recovery = crypto.generateRecoveryCode();
    const factors: FactorEnvelope[] = [
      crypto.createPasswordFactor(keyPair.privateKey, password),
      crypto.createSecretFactor('recovery', keyPair.privateKey, recovery.secret),
    ];
    return {
      payload: { identityPublicKey: crypto.b64(keyPair.publicKey), factors },
      recoveryCodeDisplay: recovery.display,
      keyPair,
    };
  }

  function unlockWithPassword(material: StoredKeyMaterial, password: string): IdentityKeyPair {
    const privateKey = crypto.openPasswordFactor(
      findFactor(material, 'password') as PasswordFactorEnvelope,
      password,
    );
    return { publicKey: crypto.unb64(material.identityPublicKey), privateKey };
  }

  function unlockWithRecovery(material: StoredKeyMaterial, code: string): IdentityKeyPair {
    const privateKey = crypto.openSecretFactor(
      findFactor(material, 'recovery') as SecretFactorEnvelope,
      crypto.recoverySecretFromCode(code),
    );
    return { publicKey: crypto.unb64(material.identityPublicKey), privateKey };
  }

  // Re-wrap the private key under a new password (call after a password change)
  // or mint a fresh recovery code — the result is PUT to /keys/factors.
  function rewrapPassword(privateKey: Uint8Array, newPassword: string): PasswordFactorEnvelope {
    return crypto.createPasswordFactor(privateKey, newPassword);
  }

  function regenerateRecoveryCode(privateKey: Uint8Array): { factor: SecretFactorEnvelope; display: string } {
    const recovery = crypto.generateRecoveryCode();
    return { factor: crypto.createSecretFactor('recovery', privateKey, recovery.secret), display: recovery.display };
  }

  // Passkey factor (§3.4): the WebAuthn PRF output (32 high-entropy bytes only
  // the authenticator can reproduce) wraps the private key. credentialId routes
  // the unlock to the right passkey; prfSalt is the fixed PRF input it was
  // evaluated with. The result is PUT to /keys/factors like any other factor.
  function addPasskey(
    privateKey: Uint8Array,
    prfOutput: Uint8Array,
    credentialId: string,
    prfSalt: string,
  ): SecretFactorEnvelope {
    return { ...crypto.createSecretFactor('passkey', privateKey, prfOutput), credentialId, prfSalt };
  }

  function unlockWithPasskeyPrf(
    material: StoredKeyMaterial,
    credentialId: string,
    prfOutput: Uint8Array,
  ): IdentityKeyPair {
    const env = material.wrappedPrivateKey.find(
      (f): f is SecretFactorEnvelope => f.factor === 'passkey' && (f as SecretFactorEnvelope).credentialId === credentialId,
    );
    if (!env) throw new Error('No passkey factor for that credential');
    const privateKey = crypto.openSecretFactor(env, prfOutput);
    return { publicKey: crypto.unb64(material.identityPublicKey), privateKey };
  }

  return { enroll, unlockWithPassword, unlockWithRecovery, rewrapPassword, regenerateRecoveryCode, addPasskey, unlockWithPasskeyPrf };
}

export type Enrollment = ReturnType<typeof createEnrollment>;
