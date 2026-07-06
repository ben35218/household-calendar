// Public entry point for @household/crypto.
//
// The platform-agnostic core plus its types. Clients pick an adapter under
// ./adapters to obtain a libsodium instance and call createHouseholdCrypto:
//   - web / admin:  adapters/web.ts   (libsodium-wrappers)
//   - mobile:       adapters/native.ts (react-native-libsodium)

export { createHouseholdCrypto } from './core.ts';
export type { HouseholdCrypto } from './core.ts';
export { createEnrollment } from './enrollment.ts';
export type {
  Enrollment,
  EnrollmentResult,
  EnrollmentPayload,
  StoredKeyMaterial,
} from './enrollment.ts';
export type {
  Sodium,
  IdentityKeyPair,
  RecordLocation,
  RecordEnvelope,
  FactorKind,
  FactorEnvelope,
  PasswordFactorEnvelope,
  SecretFactorEnvelope,
  EncryptedFile,
} from './types.ts';
