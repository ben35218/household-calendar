import { useEffect } from 'react';
import { AppState } from 'react-native';
import { rescheduleReminders, cancelAllReminders } from '../lib/notifications';

// Keep the rolling on-device reminder window fresh (Phase 5): while `enabled`
// (i.e. signed in), reschedule once now and again whenever the app returns to
// the foreground; clear everything when signed out. Permission is prompted on
// the first schedule — if denied, nothing is scheduled and this is a no-op.
export function useReminderScheduler(enabled: boolean) {
  useEffect(() => {
    if (!enabled) {
      void cancelAllReminders();
      return;
    }
    void rescheduleReminders();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void rescheduleReminders();
    });
    return () => sub.remove();
  }, [enabled]);
}
