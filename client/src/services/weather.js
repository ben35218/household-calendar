// Client-side weather (§9.1 P5b). Post-drop the server can't read the home
// address, so an E2EE household geocodes + fetches the forecast directly from
// the decrypted address via open-meteo (keyless). Pre-drop it uses the server
// forecast unchanged. Returns the same { current, forecast, units } shape.

import { weatherApi, settingsApi, householdApi } from './api';
import { getHDK, openRecord } from './e2ee';
import { loadWeatherForAddress } from '@household/weather';

export async function loadForecast() {
  // Only an unlocked, E2EE-active household takes the client path; everyone else
  // hits the server (no extra requests when locked, i.e. today).
  if (getHDK()) {
    try {
      const { data: hh } = await householdApi.get();
      if (hh.e2eeActive) {
        const { data: s } = await settingsApi.get();
        let address = s.homeAddress;
        if (s.enc && s.householdId) {
          try {
            const dec = await openRecord('Household', { _id: String(s.householdId), keyVersion: s.keyVersion, enc: s.enc });
            if (dec.homeAddress) address = dec.homeAddress;
          } catch { /* locked / wrong key */ }
        }
        if (!address) throw new Error('No home address configured. Add one in Settings.');
        return await loadWeatherForAddress(address);
      }
    } catch (e) {
      if (/No home address/.test(e?.message || '')) throw e;
      // otherwise fall through to the server forecast
    }
  }
  const { data } = await weatherApi.get();
  return data;
}
