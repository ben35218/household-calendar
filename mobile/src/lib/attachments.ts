// Mobile attachment encryption (Phase 4c) — the file-IO half of the crypto in
// lib/e2ee.ts. Reads a picked file's bytes, encrypts them under a fresh per-file
// key wrapped to the HDK, and writes the ciphertext to a cache file ready to
// upload; and the reverse for download. Needs `expo-file-system` (a native dep —
// requires a dev-client rebuild). See docs/E2EE-SYNC-PLAN.md §3.3 / Phase 4c.

// SDK 54+ split the classic read/write helpers into the /legacy entry (the new
// default export is the File/Directory API). The legacy helpers are exactly what
// we need for base64 file IO.
import * as FileSystem from 'expo-file-system/legacy';
import { encryptAttachment, decryptAttachment } from './e2ee';

// Standard base64 <-> bytes. Hermes ships no atob/btoa and expo-file-system
// speaks standard base64, so keep this dependency-free and self-contained.
const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const B64_LOOKUP = (() => { const t = new Int16Array(128).fill(-1); for (let i = 0; i < B64.length; i++) t[B64.charCodeAt(i)] = i; return t; })();

function bytesToBase64(bytes: Uint8Array): string {
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i], b1 = bytes[i + 1], b2 = bytes[i + 2];
    out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | (b1 >> 4)];
    out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : '=';
    out += i + 2 < bytes.length ? B64[b2 & 63] : '=';
  }
  return out;
}

function base64ToBytes(b64: string): Uint8Array {
  const clean = b64.replace(/[^A-Za-z0-9+/]/g, '');
  const len = Math.floor((clean.length * 3) / 4);
  const out = new Uint8Array(len);
  let o = 0;
  for (let i = 0; i < clean.length; i += 4) {
    const c0 = B64_LOOKUP[clean.charCodeAt(i)];
    const c1 = B64_LOOKUP[clean.charCodeAt(i + 1)];
    const c2 = B64_LOOKUP[clean.charCodeAt(i + 2)];
    const c3 = B64_LOOKUP[clean.charCodeAt(i + 3)];
    if (o < len) out[o++] = (c0 << 2) | (c1 >> 4);
    if (c2 >= 0 && o < len) out[o++] = ((c1 & 15) << 4) | (c2 >> 2);
    if (c3 >= 0 && o < len) out[o++] = ((c2 & 3) << 6) | c3;
  }
  return out;
}

export interface EncryptedUpload {
  uri: string; // cache file holding the ciphertext, ready to upload as the file part
  wrappedFileKey: string;
  keyVersion: number;
}

// Read a picked file, encrypt its bytes for `collection`/`id`, write the
// ciphertext to a cache file. Returns null if the session holds no HDK (the
// caller then uploads the plaintext file as before).
export async function encryptFileForUpload(
  collection: string,
  id: string,
  sourceUri: string,
): Promise<EncryptedUpload | null> {
  const b64 = await FileSystem.readAsStringAsync(sourceUri, { encoding: FileSystem.EncodingType.Base64 });
  const sealed = await encryptAttachment(collection, id, base64ToBytes(b64));
  if (!sealed) return null;
  const outUri = `${FileSystem.cacheDirectory}enc-${id}.bin`;
  await FileSystem.writeAsStringAsync(outUri, bytesToBase64(sealed.ciphertext), {
    encoding: FileSystem.EncodingType.Base64,
  });
  return { uri: outUri, wrappedFileKey: sealed.wrappedFileKey, keyVersion: sealed.keyVersion };
}

// Decrypt a ciphertext file already downloaded to `cipherUri`, write the
// plaintext to a cache file, and return its uri for opening/sharing. Null if we
// can't decrypt (no HDK for that version, malformed blob).
export async function decryptDownloadedFile(
  collection: string,
  id: string,
  keyVersion: number | undefined,
  wrappedFileKey: string,
  cipherUri: string,
  outName: string,
): Promise<string | null> {
  const b64 = await FileSystem.readAsStringAsync(cipherUri, { encoding: FileSystem.EncodingType.Base64 });
  const plain = await decryptAttachment(collection, id, keyVersion, wrappedFileKey, base64ToBytes(b64));
  if (!plain) return null;
  const outUri = `${FileSystem.cacheDirectory}${outName}`;
  await FileSystem.writeAsStringAsync(outUri, bytesToBase64(plain), { encoding: FileSystem.EncodingType.Base64 });
  return outUri;
}
