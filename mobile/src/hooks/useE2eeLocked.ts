// True when this device holds a household whose data is *actually* encrypted at
// rest (`e2eeActive`) but whose key is currently locked — i.e. the user is signed
// in yet genuinely can't read their data until they unlock (password / passkey /
// recovery code). This is the normal state after an email-code or passkey sign-in
// on a device with no cached unlock factor. Drives the profile-button alert badge
// and the Profile-view prompt.
//
// Gating on `e2eeActive` (not merely "enrolled") matters: a household that is
// enrolled but not yet born-encrypted still serves plaintext, so `openRecord`
// falls back to it and the data reads fine even while the key is "locked" —
// badging that would be a false alarm.
//
// `isUnlocked()` is an in-memory check. We subscribe to lock-state changes so an
// unlock anywhere in the app updates this immediately (no focus re-read race),
// and still re-read on focus + app foreground as a belt-and-suspenders refresh.
import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useQuery } from '@tanstack/react-query';
import { householdApi } from '../api';
import { isUnlocked, subscribeLockState } from '../lib/e2ee';

export function useE2eeLocked(): boolean {
  const householdQ = useQuery({
    queryKey: ['household'],
    queryFn: async () => (await householdApi.get()).data,
    staleTime: 60_000,
  });

  const [unlocked, setUnlocked] = useState(isUnlocked());
  const refresh = useCallback(() => setUnlocked(isUnlocked()), []);

  // Push updates: fires the instant setKeyPair flips locked↔unlocked on any screen.
  useEffect(() => subscribeLockState(refresh), [refresh]);
  useFocusEffect(refresh);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (s) => {
      if (s === 'active') refresh();
    });
    return () => sub.remove();
  }, [refresh]);

  return !!householdQ.data?.e2eeActive && !unlocked;
}
