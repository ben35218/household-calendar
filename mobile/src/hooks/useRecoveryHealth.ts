// Recovery-health guard (docs/PASSWORDLESS-E2EE-PLAN.md §4). Computes how durably
// an account can recover its E2EE data, so the UI can nudge single-factor
// accounts toward a synced passkey + a confirmed recovery code before the
// password is retired. Read-only: it never changes factors.
import { useQuery } from '@tanstack/react-query';
import { keysApi, type StoredKeyMaterial } from '../api';
import { passkeysSupported } from '../lib/passkeys';

export type RecoveryLevel =
  | 'loading'
  | 'not_enrolled'
  | 'needs_setup'    // enrolled but no confirmed non-password recovery factor
  | 'single_factor'  // recovery code only — no synced passkey for cross-device
  | 'healthy';       // recovery confirmed AND a passkey (or platform lacks PRF)

export interface RecoveryHealth {
  level: RecoveryLevel;
  hasPasskey: boolean;
  hasRecovery: boolean;
  recoveryConfirmed: boolean;
  refresh: () => void;
}

export function useRecoveryHealth(): RecoveryHealth {
  const q = useQuery({
    queryKey: ['recoveryHealth'],
    queryFn: () => keysApi.me().then((r) => r.data as StoredKeyMaterial),
    staleTime: 30_000,
  });

  const refresh = () => { void q.refetch(); };

  if (!q.data) return { level: 'loading', hasPasskey: false, hasRecovery: false, recoveryConfirmed: false, refresh };

  const factors = (q.data.wrappedPrivateKey || []) as Array<{ factor?: string }>;
  const hasPasskey = factors.some((f) => f.factor === 'passkey');
  const hasRecovery = factors.some((f) => f.factor === 'recovery');
  const recoveryConfirmed = !!q.data.recoverySetupAt;

  let level: RecoveryLevel;
  if (!q.data.enrolled) level = 'not_enrolled';
  else if (!recoveryConfirmed) level = 'needs_setup';
  // A synced passkey is the cross-device durability factor; only nudge for one
  // where the platform can actually provide it (PRF). Otherwise the confirmed
  // recovery code is the accepted backstop.
  else if (!hasPasskey && passkeysSupported()) level = 'single_factor';
  else level = 'healthy';

  return { level, hasPasskey, hasRecovery, recoveryConfirmed, refresh };
}
