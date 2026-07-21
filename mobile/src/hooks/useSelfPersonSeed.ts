// Seed the signed-in user's "You" Person at app boot — and the instant the key
// unlocks — so every person-assignment UI has at least the user to pick,
// decoupled from ever opening the People screen. Mounted once in RootNavigator.
//
// ensureSelfPerson guards on e2eeActive + a held key, so this no-ops while locked
// or on a not-yet-encrypted household; we re-attempt on lock-state changes so the
// seed lands as soon as an email-code/passkey session unlocks.

import { useCallback, useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../store/auth';
import { isUnlocked, subscribeLockState } from '../lib/e2ee';
import { ensureSelfPerson } from '../lib/selfPerson';

export function useSelfPersonSeed(enabled: boolean) {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [unlocked, setUnlocked] = useState(isUnlocked());
  const refresh = useCallback(() => setUnlocked(isUnlocked()), []);
  useEffect(() => subscribeLockState(refresh), [refresh]);

  useEffect(() => {
    if (!enabled || !unlocked || !user) return;
    ensureSelfPerson(user).then((created) => {
      if (created) qc.invalidateQueries({ queryKey: ['people'] });
    });
  }, [enabled, unlocked, user, qc]);
}
