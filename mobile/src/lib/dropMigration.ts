// §9 client-driven migration helpers (mobile). Mirrors
// client/src/services/dropMigration.js: the owner's unlocked device re-encrypts
// any stragglers (records lacking an `enc` blob) so nothing is lost at the drop.

import { householdApi, type E2eeReadiness } from '../api';
import { getHDK, encryptRecord } from './e2ee';

function pickFields(record: Record<string, unknown>, fields: string[]) {
  const out: Record<string, unknown> = {};
  for (const f of fields) if (record[f] !== undefined) out[f] = record[f];
  return out;
}

// Re-encrypt every straggler under the current HDK and seal it back. Requires an
// unlocked session (HDK held) — throws otherwise. `onProgress` fires per record.
export async function reencryptStragglers(
  onProgress?: (p: { sealed: number; total: number }) => void,
): Promise<{ total: number; sealed: number; failed: number }> {
  if (!getHDK()) throw new Error('Unlock your account first (the household key is needed to encrypt).');
  const { data } = await householdApi.stragglers();
  const total = data.total || 0;
  let sealed = 0;
  let failed = 0;
  for (const group of data.collections || []) {
    for (const record of group.records) {
      try {
        const content = pickFields(record, group.fields);
        const enc = await encryptRecord(group.collection, String(record._id), content);
        if (!enc) throw new Error('encryption returned null (no HDK)');
        await householdApi.seal({ collection: group.collection, _id: String(record._id), ...enc });
        sealed++;
      } catch {
        failed++;
      }
      onProgress?.({ sealed, total });
    }
  }
  return { total, sealed, failed };
}

export async function getReadiness(): Promise<E2eeReadiness> {
  return (await householdApi.readiness()).data;
}
