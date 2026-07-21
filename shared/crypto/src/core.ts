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

// Signal-parity D1/D2: a resource `scope.kind` maps to a short AAD prefix and the
// self-describing `enc.ks` discriminator. Keeping these one-to-one means adding a
// resource kind is a single-line change and the two can never drift.
const SCOPE_PREFIX: Record<'calendar' | 'trip', string> = { calendar: 'cal', trip: 'trip' };
const SCOPE_KS: Record<'calendar' | 'trip', 'cal' | 'trip'> = { calendar: 'cal', trip: 'trip' };

// Record-envelope `alg` values.
//   RECORD_ALG    — the original format (v1). The AAD binds the plaintext
//                   `collection` type; the sealed payload is the bare record JSON.
//   RECORD_ALG_V2 — Signal-parity C3 (opaque record envelopes). The AAD drops
//                   `collection` (binds a generic `record` tag instead), and the
//                   collection type moves INSIDE the sealed payload, so the server
//                   can store a uniform "record" that never reveals its type. This
//                   is the ONE deliberate envelope-format bump the plan sequences
//                   (D1/D2/C4 were built additive precisely so it happens once).
// Reads accept BOTH; new writes are always v2 (opaque). Key/file-key WRAPS keep
// the v1 primitive (`encryptBytes`/`decryptBytes`) unchanged — they are internal
// crypto envelopes, not stored content rows whose type leaks, and existing D1/D2
// ResourceKeyEnvelope + attachment wraps must decrypt byte-for-byte.
const RECORD_ALG = 'xchacha20poly1305-ietf' as const;
const RECORD_ALG_V2 = 'xchacha20poly1305-ietf-v2' as const;

export function createHouseholdCrypto(sodium: Sodium) {
  const B64 = sodium.base64_variants.URLSAFE_NO_PADDING;
  const b64 = (b: Uint8Array): string => sodium.to_base64(b, B64);
  const unb64 = (s: string): Uint8Array => sodium.from_base64(s, B64);

  // AEAD additional-data that pins a ciphertext to its exact record slot and key
  // version. Any mismatch (moved record / replayed version) fails decryption.
  // Passed as a STRING: react-native-libsodium's native AEAD requires a string
  // AAD, and libsodium-wrappers UTF-8-encodes a string AAD to the same bytes, so
  // one form is portable and cross-platform-compatible.
  function buildAad(loc: RecordLocation, opaque = false): string {
    // Signal-parity C3 (opaque envelopes): the v2 AAD drops the plaintext
    // `collection` and binds a generic `record` tag in its place. Record ids are
    // globally-unique ObjectIds, so `id` alone already pins the ciphertext to its
    // exact slot (no two records share an id) — removing the type from the AAD
    // does not weaken the move/replay binding, it only stops the AAD from
    // revealing the record's collection. The v1 form keeps `collection` for
    // backward-compatible reads of records sealed before the bump.
    const tag = opaque ? 'record' : loc.collection;
    // Signal-parity D1/D2: a resource-scoped ciphertext binds to the resource +
    // resource-key version instead of householdId + HDK version, so a
    // cross-household collaborator (who never learns the owner's householdId) can
    // reconstruct the AAD from the record's own routing (its calendar key / trip
    // id). The kind prefix (cal/trip) is bound too, so a TripKey can't open a
    // CalendarKey record even if resource ids ever collided.
    if (loc.scope) {
      return `${tag} ${loc.id} ${SCOPE_PREFIX[loc.scope.kind]}:${loc.scope.resource} ${loc.scope.version}`;
    }
    return `${tag} ${loc.id} ${loc.householdId} ${loc.keyVersion}`;
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

  // ── Per-resource content keys (Signal-parity D1) ──────────────────────────
  // A CalendarKey seals events on an outside-shared calendar so cross-household
  // collaborators (who hold no HDK) can read them without a plaintext feed. Same
  // shape as an HDK; wrapped two ways — to the owning household under its HDK
  // (AEAD, so any member reads it) and to each accepted collaborator under their
  // identity public key (anonymous sealed box). See the §D1 decision doc.
  function generateResourceKey(): Uint8Array {
    return sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_KEYBYTES);
  }
  // The AAD slot a household-wrapped resource key binds to: the resource + its
  // CalendarKey version, plus the wrapping HDK version, so a member can't replay
  // an old wrap or move it to another resource.
  function resourceWrapLocation(resource: string, keyVersion: number, householdId: string, hdkVersion: number): RecordLocation {
    return { collection: 'ResourceKey', id: `${resource}:${keyVersion}`, householdId, keyVersion: hdkVersion };
  }
  function wrapResourceKeyForHousehold(
    hdk: Uint8Array, resourceKey: Uint8Array,
    resource: string, keyVersion: number, householdId: string, hdkVersion: number,
  ): RecordEnvelope {
    return encryptBytes(hdk, resourceWrapLocation(resource, keyVersion, householdId, hdkVersion), resourceKey);
  }
  function unwrapResourceKeyFromHousehold(
    hdk: Uint8Array, env: RecordEnvelope,
    resource: string, keyVersion: number, householdId: string, hdkVersion: number,
  ): Uint8Array {
    return decryptBytes(hdk, resourceWrapLocation(resource, keyVersion, householdId, hdkVersion), env);
  }
  // Anonymous sealed box to a collaborator's identity public key (= the HDK
  // member-wrap; a distinct name documents intent at the call sites).
  function wrapResourceKeyForMember(resourceKey: Uint8Array, memberPublicKey: Uint8Array): string {
    return b64(sodium.crypto_box_seal(resourceKey, memberPublicKey));
  }
  function unwrapResourceKeyForMember(wrapped: string, keyPair: IdentityKeyPair): Uint8Array {
    return sodium.crypto_box_seal_open(unb64(wrapped), keyPair.publicKey, keyPair.privateKey);
  }

  // ── One-shot sealed snapshot (Signal-parity D3) ───────────────────────────
  // An anonymous sealed box carrying an arbitrary JSON payload to a SINGLE
  // recipient's identity public key — used for the event-invitation snapshot
  // when the invitee is a known account (models/EventInvitation.sealedEvent).
  // Unlike D1/D2's resource keys this is a ONE-SHOT wrap: no versioned key, no
  // rotation, no envelope — the sealed blob lives directly on the invitation
  // row. Padded (C1) so the ciphertext length doesn't leak the snapshot size.
  function sealJsonToMember(payload: unknown, memberPublicKey: Uint8Array): string {
    return b64(sodium.crypto_box_seal(utf8Encode(padJson(JSON.stringify(payload))), memberPublicKey));
  }
  function openJsonFromMember<T = unknown>(sealed: string, keyPair: IdentityKeyPair): T {
    return JSON.parse(
      utf8Decode(sodium.crypto_box_seal_open(unb64(sealed), keyPair.publicKey, keyPair.privateKey)),
    ) as T;
  }

  // ── Ephemeral device-link handshake (Signal-parity F4) ────────────────────
  // QR device linking: a NEW device shows a QR carrying a one-shot ephemeral
  // X25519 public key; an existing UNLOCKED device scans it and seals the account
  // secret (the identity keypair) to that ephemeral key, and the server only
  // ferries the opaque ciphertext. This is the SAME anonymous-sealed-box primitive
  // as D1/D2's member-wrap and D3's invitation snapshot (crypto_box_seal over a
  // C1-padded JSON payload), exposed under link-intent names — no new crypto, so
  // it inherits the same audited surface. The ephemeral key never persists: it is
  // generated for one handoff and discarded, and because it travels out-of-band in
  // the QR (not via the server), a malicious server can't substitute its own key.
  const generateLinkKeyPair = generateIdentityKeyPair;
  const sealLinkPayload = sealJsonToMember;
  const openLinkPayload = openJsonFromMember;

  // ── Guardian recovery, dual-control (specs/features/guardian-recovery.md) ──
  // Optional backstop: a household member helps the user recover, but neither
  // party alone can open the identity key. The key is wrapped under TWO locks —
  // an INNER PIN-derived KEK (Argon2id, reusing the password factor), then an
  // OUTER anonymous sealed box to the guardian's identity public key. The
  // guardian who unseals the outer box still only holds the PIN-locked inner
  // (no PIN → no key); an observer of the server relay holds neither. Reuses the
  // audited seal + password-factor primitives — no new crypto. NB: a 4-digit
  // PIN is a speed bump, not a wall against a *determined* guardian (they can
  // brute-force the inner offline); the model rests on trusting the member.
  function createGuardianEnvelope(privateKey: Uint8Array, pin: string, guardianPublicKey: Uint8Array): string {
    const inner = padJson(JSON.stringify(createPasswordFactor(privateKey, pin)));
    return b64(sodium.crypto_box_seal(utf8Encode(inner), guardianPublicKey));
  }
  // Guardian leg: unseal the outer box → the still-PIN-locked inner blob. Cannot
  // yield the private key (no PIN). Returned opaque so the guardian re-seals it
  // to the requesting device without ever parsing key material.
  function unsealGuardianOuter(outer: string, guardianKeyPair: IdentityKeyPair): string {
    return utf8Decode(sodium.crypto_box_seal_open(unb64(outer), guardianKeyPair.publicKey, guardianKeyPair.privateKey));
  }
  // Guardian leg (return): re-seal the PIN-locked inner to the requesting
  // device's one-shot ephemeral key — same handoff as device-link.
  function resealGuardianInner(inner: string, recipientPublicKey: Uint8Array): string {
    return b64(sodium.crypto_box_seal(utf8Encode(inner), recipientPublicKey));
  }
  // User leg: open the re-sealed inner with the ephemeral private key, then the
  // PIN → the identity private key. Throws on a wrong PIN (secretbox MAC fails).
  function recoverWithGuardian(resealed: string, recipientKeyPair: IdentityKeyPair, pin: string): Uint8Array {
    const inner = utf8Decode(sodium.crypto_box_seal_open(unb64(resealed), recipientKeyPair.publicKey, recipientKeyPair.privateKey));
    return openPasswordFactor(JSON.parse(inner) as PasswordFactorEnvelope, pin);
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
  // Raw-bytes AEAD keeps the v1 format: it wraps KEYS (resource-key envelopes,
  // per-file content keys), not stored content rows, so its AAD's `collection`
  // slot (`ResourceKey`, `Manual`, `TripItemAttachment`, …) is a fixed internal
  // tag, never a leaked record type. Freezing it here means every existing D1/D2
  // wrap + attachment decrypts byte-for-byte across the C3 bump.
  function encryptBytes(hdk: Uint8Array, loc: RecordLocation, plaintext: Uint8Array): RecordEnvelope {
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(plaintext, buildAad(loc), null, nonce, hdk);
    const env: RecordEnvelope = { alg: RECORD_ALG, nonce: b64(nonce), ct: b64(ct) };
    // D1/D2 self-describing key-scope discriminator (see buildAad / types).
    if (loc.scope) env.ks = SCOPE_KS[loc.scope.kind];
    return env;
  }
  function decryptBytes(hdk: Uint8Array, loc: RecordLocation, env: RecordEnvelope): Uint8Array {
    return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(null, unb64(env.ct), buildAad(loc), unb64(env.nonce), hdk);
  }

  // Ciphertext padding (Signal-parity plan C1): ciphertext LENGTH leaks record
  // size, which distinguishes a two-word grocery item from a long note. Pad the
  // serialized JSON up to a size bucket — powers of two from 256 B to 4 KiB,
  // then 4 KiB steps — so records within a bucket are indistinguishable.
  // Padding is trailing spaces: JSON.parse ignores them, so decryptRecord needs
  // no change, old clients read padded records, and new clients read old
  // unpadded ones — no envelope version bump.
  function paddedLength(len: number): number {
    if (len <= 256) return 256;
    if (len <= 4096) return 1 << (32 - Math.clz32(len - 1)); // next power of two
    return Math.ceil(len / 4096) * 4096;
  }
  function padJson(json: string): string {
    return json + ' '.repeat(paddedLength(json.length) - json.length);
  }

  // JSON record helpers (the common case for content models).
  //
  // Signal-parity C3: new writes use the opaque v2 envelope. The sealed plaintext
  // is `{ c: collection, r: record }` — the collection type moves INSIDE the
  // ciphertext, so the server stores a uniform record that never reveals what kind
  // it is, and a decryptor recovers the type without any plaintext hint. The AAD
  // binds the generic `record` tag (see buildAad). Padding (C1) is applied to the
  // wrapped payload so the wrapper adds no size-class signal.
  function encryptRecord(key: Uint8Array, loc: RecordLocation, record: unknown): RecordEnvelope {
    const payload = { c: loc.collection, r: record };
    const nonce = sodium.randombytes_buf(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES);
    const ct = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
      utf8Encode(padJson(JSON.stringify(payload))), buildAad(loc, true), null, nonce, key,
    );
    const env: RecordEnvelope = { alg: RECORD_ALG_V2, nonce: b64(nonce), ct: b64(ct) };
    if (loc.scope) env.ks = SCOPE_KS[loc.scope.kind];
    return env;
  }
  // Decrypt, returning just the record. Accepts BOTH formats — v2 (opaque, reads
  // the type from inside) and v1 (the pre-C3 form, whose type came from the AAD /
  // the caller's `loc.collection`). New backlog is converted by the B1-style
  // re-seal pass, but old-format ciphertext stays readable indefinitely.
  function decryptRecord<T = unknown>(key: Uint8Array, loc: RecordLocation, env: RecordEnvelope): T {
    return decryptRecordTagged<T>(key, loc, env).record;
  }
  // Decrypt AND surface the record's own collection type. The unified sync/replica
  // path (C3) fetches opaque rows with no plaintext collection, so it decrypts
  // with a collection-less `loc` and routes on the returned `collection`. For a v1
  // record (no embedded type) the caller-supplied `loc.collection` is echoed back.
  function decryptRecordTagged<T = unknown>(
    key: Uint8Array, loc: RecordLocation, env: RecordEnvelope,
  ): { collection: string; record: T } {
    const opaque = env.alg === RECORD_ALG_V2;
    const plain = JSON.parse(
      utf8Decode(sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null, unb64(env.ct), buildAad(loc, opaque), unb64(env.nonce), key,
      )),
    );
    return opaque
      ? { collection: plain.c as string, record: plain.r as T }
      : { collection: loc.collection, record: plain as T };
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
    generateResourceKey,
    wrapResourceKeyForHousehold,
    unwrapResourceKeyFromHousehold,
    wrapResourceKeyForMember,
    unwrapResourceKeyForMember,
    sealJsonToMember,
    openJsonFromMember,
    generateLinkKeyPair,
    sealLinkPayload,
    openLinkPayload,
    createGuardianEnvelope,
    unsealGuardianOuter,
    resealGuardianInner,
    recoverWithGuardian,
    publicKeyFingerprint,
    encryptBytes,
    decryptBytes,
    encryptRecord,
    decryptRecord,
    decryptRecordTagged,
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
