// Category names are E2EE content (Signal-parity D5). This module is the one
// place screens load categories through: it decrypts each row's sealed name
// over the plaintext (dual-write fallback), and — the P1 ensureSelf pattern —
// seeds the DEFAULT categories client-side, encrypted, for an E2EE-active
// household that has none (the server only seeds plaintext at registration,
// which the straggler pass seals before the drop).

import defaultSeed from '@household/seed/defaultCategories.json';
import { categoriesApi, householdApi, Category, LinkedRef } from '../api';
import { getHDK, openRecord, sealNew } from './e2ee';

// Fetch + decrypt all categories (top-level and subcategories).
export async function loadCategories(params?: Record<string, unknown>): Promise<Category[]> {
  const rows = (await categoriesApi.list(params)).data;
  return Promise.all(rows.map((c) => openRecord('Category', c)));
}

// Decrypt a populated category/item ref in place (routes now populate refs with
// their enc blob so sealed names stay readable post-drop).
export async function openLinkedRef(collection: string, ref?: LinkedRef | string | null): Promise<LinkedRef | null> {
  if (!ref || typeof ref !== 'object') return null;
  return openRecord(collection, ref as LinkedRef & { _id: string });
}

// One-time client-side seed: when this household is E2EE-active, the key is
// held, and no categories exist, create the default set (names sealed). Safe to
// call on every Maintenance load — it no-ops in a session after the first run
// and whenever categories already exist.
let seededThisSession = false;
export async function ensureDefaultCategories(): Promise<boolean> {
  if (seededThisSession || !getHDK()) return false;
  try {
    const { data: hh } = await householdApi.get();
    if (!hh?.e2eeActive) return false;
    const existing = (await categoriesApi.list({ topLevel: 'true' })).data;
    if (existing.length) { seededThisSession = true; return false; }

    seededThisSession = true; // guard against concurrent double-seeds
    const parentIds = new Map<string, string>();
    for (const c of defaultSeed.categories) {
      const payload = { name: c.name, icon: c.icon, color: c.color, sortOrder: c.sortOrder };
      const sealed = await sealNew('Category', payload, { name: c.name });
      const { data } = await categoriesApi.create(sealed);
      parentIds.set(c.name, data._id);
    }
    for (const [parentName, subs] of Object.entries(defaultSeed.subcategories)) {
      const parentId = parentIds.get(parentName);
      if (!parentId) continue;
      for (const s of subs) {
        const payload = { name: s.name, sortOrder: s.sortOrder, parentId, icon: 'mdi-circle-small', color: '#9E9E9E' };
        await categoriesApi.create(await sealNew('Category', payload, { name: s.name }));
      }
    }
    return true;
  } catch {
    return false; // offline/locked — retried next session
  }
}
