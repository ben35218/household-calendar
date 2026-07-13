// Locality bias for Places autocomplete (server: routes/places.js), so a
// generic query ("beach") ranks nearby places over globally prominent ones.
// Pre-drop the server biases from its own cached household coords, so the
// client only sends the holiday-calendar country. Post-drop the server can't
// read the home address, so an unlocked E2EE household decrypts it and
// geocodes client-side (keyless open-meteo, same as lib/weather.ts), then
// sends the coords with each query.

import { geocode } from '@household/weather';
import { settingsApi, householdApi } from '../api';
import { getHDK, openRecord } from './e2ee';
import { effectiveCountry } from './calendarPrefs';

export interface PlaceBias {
  lat?: number;
  lon?: number;
  country?: string;
}

// undefined = not resolved yet (retry), null = resolved to "server handles it"
let coords: { lat: number; lon: number } | null | undefined;
let pending: Promise<void> | null = null;

async function resolveCoords(): Promise<void> {
  // Locked or non-E2EE session: leave unresolved so a later unlock retries.
  if (!getHDK()) return;
  try {
    const { data: hh } = await householdApi.get();
    if (!hh.e2eeActive) { coords = null; return; } // pre-drop: server has plaintext coords
    const { data: s } = await settingsApi.get();
    let address = s.homeAddress;
    if (s.enc && s.householdId) {
      try {
        const dec: any = await openRecord('Household', {
          _id: String(s.householdId), keyVersion: s.keyVersion, enc: s.enc,
        } as any);
        if (Number.isFinite(dec.lat) && Number.isFinite(dec.lon)) {
          coords = { lat: dec.lat, lon: dec.lon };
          return;
        }
        if (dec.homeAddress) address = dec.homeAddress;
      } catch { /* locked / wrong key */ }
    }
    coords = address ? await geocode(address) : null;
  } catch {
    coords = null;
  }
}

// Bias params for one autocomplete query. Country is synchronous; coords
// resolve once per session (awaited, so even the first query carries them).
export async function getPlaceBias(): Promise<PlaceBias> {
  if (coords === undefined) {
    if (!pending) pending = resolveCoords().finally(() => { pending = null; });
    await pending;
  }
  return { ...(coords ?? {}), country: effectiveCountry() };
}

// Re-resolve after the home address changes.
export function invalidatePlaceBias() {
  coords = undefined;
}
