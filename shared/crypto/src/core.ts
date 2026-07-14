// Platform-agnostic E2EE core for Calen.
//
// `createHouseholdCrypto(sodium)` returns the full crypto API bound to one
// libsodium instance. All primitives are libsodium standards — no hand-rolled
// crypto. See docs/E2EE-SYNC-PLAN.md §3.
//
// Portability note: the core deliberately depends only on primitives present in
// BOTH libsodium-wrappers-sumo (web/Node) and react-native-libsodium (mobile).
// react-native-libsodium omits from_string/to_string and the whole
// crypto_secretstream family, so UTF-8 is done via TextEncoder/TextDecoder and
// file encryption via chunked AEAD (below) rather than secretstream.
//
// Key hierarchy:
//   per-user X25519 identity keypair
//     → private key wrapped at rest, independently, by each unlock factor
//       (password-Argon2id / passkey-PRF / recovery-code)
//   per-household symmetric HDK (versioned)
//     → sealed-boxed to each member's public key (HouseholdKeyEnvelope)
//     → encrypts records (XChaCha20-Poly1305) and wraps per-file content keys

import type {
  Sodium,
  IdentityKeyPair,
  RecordLocation,
  RecordEnvelope,
  PasswordFactorEnvelope,
  SecretFactorEnvelope,
  EncryptedFile,
} from './types.ts';

// Crockford base32 (no I/L/O/U) for human-transcribable recovery codes.
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

// UTF-8 via the standard globals rather than libsodium's from_string/to_string,
// which react-native-libsodium doesn't ship. Present on web, Node, and Hermes.
const utf8Encode = (s: string): Uint8Array => new TextEncoder().encode(s);
const utf8Decode = (b: Uint8Array): string => new TextDecoder().decode(b);

// Argon2id work factors, set explicitly because react-native-libsodium exposes
// only the *_INTERACTIVE pwhash limits at runtime, not *_MODERATE (which
// libsodium-wrappers-sumo does). These are libsodium's MODERATE preset; they're
// also stored on each password envelope, so a factor enrolled on one platform
// unlocks on the other regardless of defaults.
const ARGON2_OPSLIMIT = 3; // crypto_pwhash_OPSLIMIT_MODERATE
const ARGON2_MEMLIMIT = 268435456; // crypto_pwhash_MEMLIMIT_MODERATE (256 MiB)

export function createHouseholdCrypto(sodium: Sodium) {
  const B64 = sodium.base64_variants.URLSAFE_NO_PADDING;
  const b64 = (b: Uint8Array): string => sodium.to_base64(b, B64);
  const unb64 = (s: string): Uint8Array => sodium.from_base64(s, B64);

  // AEAD additional-data that pins a ciphertext to its exact record slot and key
  // version. Any mismatch (moved record / replayed version) fails decryption.
  // Passed as a STRING: react-native-libsodium's native AEAD requires a string
  // AAD, and libsodium-wrappers UTF-8-encodes a string AAD to the same bytes, so
  // one form is portable and cross-platform-compatible.
  function buildAad(loc: RecordLocation): string {
    return `${loc.collection} ${loc.id} ${loc.householdId} ${loc.keyVersion}`;
  }

  // Raw CSPRNG bytes (both bindings expose randombytes_buf). Handy for non-crypto
  // needs that still want good randomness, e.g. client-minted record ids.
  function randomBytes(length: number): Uint8Array {
    return sodium.randombytes_buf(length);
  }

  // ── Identity keypair ──────────────────────────────────────────────────────
  function generateIdentityKeyPair(): IdentityKeyPair {
    const kp = sodium.crypto_box_keypair();
    return { publicKey: kp.publicKey, privateKey: kp.privateKey };
  }

  // ── Per-factor KEK derivation ─────────────────────────────────────────────
  // Password → slow Argon2id. Recovery code / passkey-PRF → fast keyed hash
  // (the input is already high-entropy, so key-stretching adds nothing).
  function deriveKekFromPassword(
    password: string,
    opts?: { salt?: Uint8Array; opslimit?: number; memlimit?: number },
  ): { kek: Uint8Array; salt: Uint8Array; opslimit: number; memlimit: number } {
    const salt = opts?.salt ?? sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
    const opslimit = opts?.opslimit ?? ARGON2_OPSLIMIT;
    const memlimit = opts?.memlimit ?? ARGON2_MEMLIMIT;
    const kek = sodium.crypto_pwhash(
      sodium.crypto_secretbox_KEYBYTES,
      utf8Encode(password),
      salt,
      opslimit,
      memlimit,
      sodium.crypto_pwhash_ALG_ARGON2ID13,
    );
    return { kek, salt, opslimit, memlimit };
  }

  function deriveKekFromSecret(secret: Uint8Array): Uint8Array {
    return sodium.crypto_generichash(sodium.crypto_secretbox_KEYBYTES, secret);
  }

  // ── Private-key wrapping (secretbox under a KEK) ───────────────────────────
  function wrapWithKek(plaintext: Uint8Array, kek: Uint8Array): { nonce: string; ct: string } {
    const nonce = sodium.randombytes_buf(sodium.crypto_secretbox_NONCEBYTES);
    return { nonce: b64(nonce), ct: b64(sodium.crypto_secretbox_easy(plaintext, nonce, kek)) };
  }
  function unwrapWithKek(env: { nonce: string; ct: string }, kek: Uint8Array): Uint8Array {
    return sodium.crypto_secretbox_open_easy(unb64(env.ct), unb64(env.nonce), kek);
  }

  // Build/open the per-factor envelopes stored in User.wrappedPrivateKey.
  function createPasswordFactor(privateKey: Uint8Array, password: string): PasswordFactorEnvelope {
    const { kek, salt, opslimit, memlimit } = deriveKekFromPassword(password);
    const { nonce, ct } = wrapWithKek(privateKey, kek);
    return { factor: 'password', kdf: 'argon2id', salt: b64(salt), opslimit, memlimit, nonce, ct };
  }
  function openPasswordFactor(env: PasswordFactorEnvelope, password: string): Uint8Array {
    const { kek } = deriveKekFromPassword(password, {
      salt: unb64(env.salt),
      opslimit: env.opslimit,
      memlimit: env.memlimit,
    });
    return unwrapWithKek(env, kek);
  }

  function createSecretFactor(
    factor: 'passkey' | 'recovery',
    privateKey: Uint8Array,
    secret: Uint8Array,
  ): SecretFactorEnvelope {
    const { nonce, ct } = wrapWithKek(privateKey, deriveKekFromSecret(secret));
    return { factor, nonce, ct };
  }
  function openSecretFactor(env: SecretFactorEnvelope, secret: Uint8Array): Uint8Array {
    return unwrapWithKek(env, deriveKekFromSecret(secret));
  }

  // ── Household Data Key + member envelopes ─────────────────────────────────
  function generateHDK(): Uint8Array {
    return sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
  }
  // Anonymous sealed box → the HouseholdKeyEnvelope.wrappedHDK for a member.
  function wrapHDKForMember(hdk: Uint8Array, memberPublicKey: Uint8Array): string {
    return b64(sodium.crypto_box_seal(hdk, memberPublicKey));
  }
  function unwrapHDK(wrappedHDK: string, keyPair: IdentityKeyPair): Uint8Array {
    return sodium.crypto_box_seal_open(unb64(wrappedHDK), keyPair.publicKey, keyPair.privateKey);
  }

  // Short, human-comparable fingerprint of an identity public key, for the
  // out-of-band verification step in approve-to-join: the approver reads the
  // joiner's fingerprint aloud (or over another channel) and confirms it matches
  // before wrapping the HDK. Derived from a generichash of the public key —
  // no secret involved, so it's safe to display and compute anywhere. 120 bits
  // of the digest rendered as six Crockford-base32 groups of four.
  function publicKeyFingerprint(publicKeyB64: string): string {
    const digest = sodium.crypto_generichash(15, unb64(publicKeyB64));
    let bits = 0;
    let value = 0;
    let raw = '';
    for (let i = 0; i < digest.length; i++) {
      value = (value << 8) | digest[i];
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        raw += CROCKFORD[(value >>> bits) & 31];
      }
    }
    return (raw.match(/.{1,4}/g) ?? []).join('-');
  }

  // ── Record + raw-bytes AEAD ───────────────────────────────────────────────
  function encryptBytes(hdk: Uint8Array, loc: RecordLocation, plaintext: Uint8Array): RecordEnvelope {
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, buildAad(loc), null, nonce, hdk);
    return { alg: 'xchacha20poly1305-ietf', nonce: b64(nonce), ct: b64(ct) };
  }
  function decryptBytes(hdk: Uint8Array, loc: RecordLocation, env: RecordEnvelope): Uint8Array {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, unb64(env.ct), buildAad(loc), unb64(env.nonce), hdk);
  }

  // JSON record helpers (the common case for content models).
  function encryptRecord(hdk: Uint8Array, loc: RecordLocation, record: unknown): RecordEnvelope {
    return encryptBytes(hdk, loc, utf8Encode(JSON.stringify(record)));
  }
  function decryptRecord<T = unknown>(hdk: Uint8Array, loc: RecordLocation, env: RecordEnvelope): T {
    return JSON.parse(utf8Decode(decryptBytes(hdk, loc, env))) as T;
  }

  // ── File / attachment encryption ──────────────────────────────────────────
  // Portable chunked AEAD (no secretstream): each chunk is `nonce(24) || ct`,
  // with the chunk's index and the TOTAL chunk count bound as additional-data.
  // Dropping, adding, or reordering any chunk changes the AAD and fails
  // decryption — the same integrity guarantees secretstream would give.
  function generateFileKey(): Uint8Array {
    return sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
  }
  // The per-file content key is itself wrapped by the HDK (as raw bytes) and
  // stored alongside the ciphertext, so files ride the same key hierarchy.
  function wrapFileKey(hdk: Uint8Array, fileKey: Uint8Array, loc: RecordLocation): RecordEnvelope {
    return encryptBytes(hdk, loc, fileKey);
  }
  function unwrapFileKey(hdk: Uint8Array, env: RecordEnvelope, loc: RecordLocation): Uint8Array {
    return decryptBytes(hdk, loc, env);
  }

  const fileChunkAad = (index: number, total: number): string => `${index}/${total}`;

  function encryptFile(fileKey: Uint8Array, chunks: Uint8Array[]): EncryptedFile {
    const nonceLen = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
    // Always emit at least one (possibly empty) chunk so an empty file still has
    // a verifiable count.
    const input = chunks.length ? chunks : [new Uint8Array(0)];
    const out = input.map((chunk, i) => {
      const nonce = sodium.randombytes_buf(nonceLen);
      const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
        chunk, fileChunkAad(i, input.length), null, nonce, fileKey,
      );
      const framed = new Uint8Array(nonce.length + ct.length);
      framed.set(nonce, 0);
      framed.set(ct, nonce.length);
      return b64(framed);
    });
    return { v: 'hcfile-v1', chunks: out };
  }
  function decryptFile(fileKey: Uint8Array, file: EncryptedFile): Uint8Array {
    const nonceLen = sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES;
    const total = file.chunks.length;
    const parts = file.chunks.map((c, i) => {
      const framed = unb64(c);
      const nonce = framed.subarray(0, nonceLen);
      const ct = framed.subarray(nonceLen);
      return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, ct, fileChunkAad(i, total), nonce, fileKey);
    });
    const size = parts.reduce((n, p) => n + p.length, 0);
    const result = new Uint8Array(size);
    let off = 0;
    for (const p of parts) {
      result.set(p, off);
      off += p.length;
    }
    return result;
  }

  // ── Recovery code ─────────────────────────────────────────────────────────
  // 16 bytes ≈ 128 bits, rendered as 26 Crockford-base32 chars in 5-char groups.
  // The KEK derives from the *canonical* form, so grouping/case/ambiguous glyphs
  // entered by the user don't matter.
  function generateRecoveryCode(): { display: string; secret: Uint8Array } {
    const bytes = sodium.randombytes_buf(16);
    let bits = 0;
    let value = 0;
    let raw = '';
    for (let i = 0; i < bytes.length; i++) {
      value = (value << 8) | bytes[i];
      bits += 8;
      while (bits >= 5) {
        bits -= 5;
        raw += CROCKFORD[(value >>> bits) & 31];
      }
    }
    if (bits > 0) raw += CROCKFORD[(value << (5 - bits)) & 31];
    const display = (raw.match(/.{1,5}/g) ?? []).join('-');
    return { display, secret: recoverySecretFromCode(display) };
  }
  // Canonicalize user input (uppercase, strip separators, map O→0 / I,L→1) and
  // return the bytes the KEK is derived from.
  function recoverySecretFromCode(code: string): Uint8Array {
    const canonical = code
      .toUpperCase()
      .replace(/[\s-]/g, '')
      .replace(/O/g, '0')
      .replace(/[IL]/g, '1');
    return utf8Encode(canonical);
  }

  return {
    b64,
    unb64,
    randomBytes,
    generateIdentityKeyPair,
    deriveKekFromPassword,
    deriveKekFromSecret,
    createPasswordFactor,
    openPasswordFactor,
    createSecretFactor,
    openSecretFactor,
    generateHDK,
    wrapHDKForMember,
    unwrapHDK,
    publicKeyFingerprint,
    encryptBytes,
    decryptBytes,
    encryptRecord,
    decryptRecord,
    generateFileKey,
    wrapFileKey,
    unwrapFileKey,
    encryptFile,
    decryptFile,
    generateRecoveryCode,
    recoverySecretFromCode,
  };
}

export type HouseholdCrypto = ReturnType<typeof createHouseholdCrypto>;
