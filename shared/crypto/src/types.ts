// Shared crypto types for Household Calendar E2EE.
//
// The core (core.ts) is platform-agnostic: it takes a `Sodium` instance and
// never imports libsodium directly. Each client injects its own binding
// (`libsodium-wrappers` on web/admin, `react-native-libsodium` on mobile), so
// there is exactly one audited implementation of the crypto and three thin
// adapters. See docs/E2EE-SYNC-PLAN.md §3.1.

// ── The subset of libsodium the core depends on ─────────────────────────────
// Kept intentionally small so the surface an adapter must satisfy is explicit.
// Both libsodium-wrappers and react-native-libsodium expose these identically.
export interface Sodium {
  // Constants.
  readonly crypto_aead_xchacha20poly1305_ietf_KEYBYTES: number;
  readonly crypto_aead_xchacha20poly1305_ietf_NPUBBYTES: number;
  readonly crypto_secretbox_KEYBYTES: number;
  readonly crypto_secretbox_NONCEBYTES: number;
  readonly crypto_pwhash_SALTBYTES: number;
  readonly crypto_pwhash_ALG_ARGON2ID13: number;
  readonly base64_variants: { readonly URLSAFE_NO_PADDING: number };

  // Randomness.
  randombytes_buf(length: number): Uint8Array;

  // Identity keypair (X25519) + anonymous sealed boxes (for HDK envelopes).
  crypto_box_keypair(): { publicKey: Uint8Array; privateKey: Uint8Array; keyType: string };
  crypto_box_seal(message: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array;
  crypto_box_seal_open(
    ciphertext: Uint8Array,
    recipientPublicKey: Uint8Array,
    recipientPrivateKey: Uint8Array,
  ): Uint8Array;

  // Record AEAD (XChaCha20-Poly1305 IETF).
  // additionalData is passed as a string for cross-binding portability (see
  // core.ts buildAad); both libsodium bindings accept it.
  crypto_aead_xchacha20poly1305_ietf_encrypt(
    message: Uint8Array,
    additionalData: string | Uint8Array | null,
    secretNonce: Uint8Array | null,
    publicNonce: Uint8Array,
    key: Uint8Array,
  ): Uint8Array;
  crypto_aead_xchacha20poly1305_ietf_decrypt(
    secretNonce: Uint8Array | null,
    ciphertext: Uint8Array,
    additionalData: string | Uint8Array | null,
    publicNonce: Uint8Array,
    key: Uint8Array,
  ): Uint8Array;

  // Secretbox — used to wrap the private key under a per-factor KEK.
  crypto_secretbox_easy(message: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;
  crypto_secretbox_open_easy(ciphertext: Uint8Array, nonce: Uint8Array, key: Uint8Array): Uint8Array;

  // Password KDF (Argon2id) — the baseline factor's KEK.
  crypto_pwhash(
    keyLength: number,
    password: Uint8Array,
    salt: Uint8Array,
    opsLimit: number,
    memLimit: number,
    algorithm: number,
  ): Uint8Array;

  // Fast keyed hash — derives a KEK from a high-entropy secret (recovery code,
  // passkey PRF output) where a slow password KDF is unnecessary.
  crypto_generichash(hashLength: number, message: Uint8Array, key?: Uint8Array | null): Uint8Array;

  // Base64 encoding. NB: we deliberately do NOT depend on libsodium's
  // from_string/to_string or crypto_secretstream — react-native-libsodium omits
  // them. UTF-8 is done via TextEncoder/TextDecoder, and file encryption via
  // chunked AEAD, so the core runs unmodified on web and mobile.
  to_base64(input: Uint8Array, variant?: number): string;
  from_base64(input: string, variant?: number): Uint8Array;
}

// ── Data shapes ─────────────────────────────────────────────────────────────

export interface IdentityKeyPair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

// The plaintext routing/metadata that binds a record ciphertext to its slot.
// Reconstructed at decrypt time and fed as AEAD additional-data, so the server
// cannot move a ciphertext to a different record or replay an old key version.
export interface RecordLocation {
  collection: string;
  id: string;
  householdId: string;
  keyVersion: number;
}

// The AEAD ciphertext stored in a document's `enc` field.
export interface RecordEnvelope {
  alg: 'xchacha20poly1305-ietf';
  nonce: string; // base64url
  ct: string; // base64url (ciphertext + tag)
}

// A private key wrapped by one unlock factor. Any one envelope can recover the
// private key, which in turn unwraps the HDK. See §3.4.
export type FactorKind = 'password' | 'passkey' | 'recovery';

export interface PasswordFactorEnvelope {
  factor: 'password';
  kdf: 'argon2id';
  salt: string; // base64url
  opslimit: number;
  memlimit: number;
  nonce: string; // base64url (secretbox)
  ct: string; // base64url
}

export interface SecretFactorEnvelope {
  factor: 'passkey' | 'recovery';
  nonce: string; // base64url (secretbox)
  ct: string; // base64url
}

export type FactorEnvelope = PasswordFactorEnvelope | SecretFactorEnvelope;

// An encrypted file/attachment: a version marker plus per-chunk ciphertext. Each
// chunk is `nonce(24) || AEAD(chunk)`, with the chunk's index and the total
// chunk count bound as additional-data — so dropping, adding, or reordering any
// chunk fails decryption (portable replacement for secretstream).
export interface EncryptedFile {
  v: 'hcfile-v1';
  chunks: string[]; // base64url per chunk
}
