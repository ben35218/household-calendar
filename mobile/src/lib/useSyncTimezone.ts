import { useEffect, useRef } from 'react';
import { settingsApi } from '../api';

// The device's IANA zone (e.g. "America/Toronto"), or '' if unavailable.
function deviceTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

// Keep the server's stored timezone in sync with the phone. Alerts fire at the
// user's own 7am local (see server scheduler), so the stored zone must follow
// the device when the user travels or relocates. The Account screen picker
// stays as a manual override; this just self-heals the common case. Runs once
// per app session, and only issues a write when the zone actually changed.
export function useSyncTimezone() {
  const synced = useRef(false);
  useEffect(() => {
    if (synced.current) return;
    synced.current = true;
    const tz = deviceTimezone();
    if (!tz) return;
    (async () => {
      try {
        const { data } = await settingsApi.get();
        if (data.timezone !== tz) await settingsApi.update({ timezone: tz });
      } catch {
        // Non-critical: a failed sync just leaves the existing stored zone.
      }
    })();
  }, []);
}
