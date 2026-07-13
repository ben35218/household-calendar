import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { billingApi } from '../api';

// Single source for the billing/plan status query so every surface (paywall,
// usage banners, profile row) shares one cache entry and staleTime.
export function useBilling() {
  return useQuery({
    queryKey: ['billing', 'status'],
    queryFn: async () => (await billingApi.status()).data,
    staleTime: 60_000,
  });
}

export type PlanActivationState = 'idle' | 'activating' | 'active' | 'timeout';

const POLL_MS = 3_000;
const TIMEOUT_MS = 45_000;

// After a purchase, the plan flips server-side via the RevenueCat webhook, so
// there's a gap where /billing/status still reports the old plan. Poll until
// the plan changes so the UI never shows "Free" to someone who just paid.
// 'timeout' means payment went through but the webhook hasn't landed yet —
// callers should reassure, not alarm.
export function usePlanActivation() {
  const qc = useQueryClient();
  const [state, setState] = useState<PlanActivationState>('idle');
  const [plan, setPlan] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function start(previousPlan: string) {
    if (timer.current) clearTimeout(timer.current);
    setState('activating');
    const startedAt = Date.now();

    const poll = async () => {
      try {
        const { data } = await billingApi.status();
        if (!alive.current) return;
        qc.setQueryData(['billing', 'status'], data);
        if (data.plan !== previousPlan) {
          setPlan(data.plan);
          setState('active');
          return;
        }
      } catch {
        // Transient fetch failure — keep polling until the deadline.
      }
      if (!alive.current) return;
      if (Date.now() - startedAt >= TIMEOUT_MS) {
        setState('timeout');
        return;
      }
      timer.current = setTimeout(poll, POLL_MS);
    };
    poll();
  }

  return { state, plan, start };
}
