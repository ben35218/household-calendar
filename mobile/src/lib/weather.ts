// Client-side weather (§9.1 P5b). Post-drop the server can't read the home
// address, so an E2EE household geocodes + fetches the forecast directly from
// the decrypted address via open-meteo (keyless). Pre-drop it uses the server
// forecast. Returns the same WeatherData shape.

import { loadWeatherForAddress } from '@household/weather';
import { weatherApi, settingsApi, householdApi, WeatherData } from '../api';
import { getHDK, openRecord } from './e2ee';

export async function loadForecast(): Promise<WeatherData> {
  if (getHDK()) {
    try {
      const { data: hh } = await householdApi.get();
      if (hh.e2eeActive) {
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
        return (await loadWeatherForAddress(address)) as unknown as WeatherData;
      }
    } catch (e: any) {
      if (/No home address/.test(e?.message || '')) throw e;
      // otherwise fall through to the server forecast
    }
  }
  return (await weatherApi.get()).data;
}
