// Client-side weather (§9.1 P5b). Post-drop the server can't read the home
// address, so an E2EE household geocodes + fetches the forecast directly from
// the decrypted address via open-meteo (keyless). Pre-drop it uses the server
// forecast. Returns the same WeatherData shape.

import { loadWeatherForAddress, loadOutlook } from '@household/weather';
import { weatherApi, settingsApi, householdApi, WeatherData, OutlookWeek } from '../api';
import { getHDK, openRecord } from './e2ee';

// Resolve the decrypted home address only for an unlocked, E2EE-active
// household; returns null otherwise (→ use the server). Throws on a genuinely
// missing address.
async function e2eeHomeAddress(): Promise<string | null> {
  if (!getHDK()) return null;
  const { data: hh } = await householdApi.get();
  if (!hh.e2eeActive) return null;
  const { data: s } = await settingsApi.get();
  let address = s.homeAddress;
  if (s.enc && s.householdId) {
    try {
      const dec: any = await openRecord('Household', {
        _id: String(s.householdId), keyVersion: s.keyVersion, enc: s.enc,
      } as any);
      if (dec.homeAddress) address = dec.homeAddress;
    } catch { /* locked / wrong key */ }
  }
  if (!address) throw new Error('No home address configured. Add one in Settings.');
  return address;
}

export async function loadForecast(): Promise<WeatherData> {
  try {
    const address = await e2eeHomeAddress();
    if (address) return (await loadWeatherForAddress(address)) as unknown as WeatherData;
  } catch (e: any) {
    if (/No home address/.test(e?.message || '')) throw e;
    // otherwise fall through to the server forecast
  }
  return (await weatherApi.get()).data;
}

// 90-day seasonal outlook — client-direct over the decrypted address when E2EE
// is live, else the server endpoint.
export async function loadOutlookWeeks(): Promise<OutlookWeek[]> {
  try {
    const address = await e2eeHomeAddress();
    if (address) return ((await loadOutlook(address)).weeks) as unknown as OutlookWeek[];
  } catch (e: any) {
    if (/No home address/.test(e?.message || '')) throw e;
    // otherwise fall through to the server outlook
  }
  return (await weatherApi.outlook()).data.weeks;
}
