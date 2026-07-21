// Post-call status for calendar events, derived from the shared ['calls'] query
// (the same cache the event view and Invitations poll). Used to dim events whose
// AI call has resolved: a confirmed cancellation, or a confirmed reschedule the
// user hasn't applied to the event's time yet.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { callsApi, PhoneCallRecord } from '../api';

const CALL_TERMINAL = ['ended', 'failed'];

// Shared read of the household's recent calls. Keyed identically to the event
// view so react-query dedupes it; polls only while a call is still running.
export function useCalls() {
  return useQuery({
    queryKey: ['calls'],
    queryFn: async () => (await callsApi.list()).data,
    refetchInterval: (query) =>
      (query.state.data ?? []).some((c) => !CALL_TERMINAL.includes(c.status)) ? 10_000 : false,
  });
}

// Which events an AI call has resolved, derived from the confirmed call itself
// (not a stored flag — the server can't set one under E2EE, so the signal is the
// call record). Both states clear once the call notice is **acknowledged**
// (Dismiss on the event view / OK in Invitations), which returns the event to a
// normal appearance:
//   • cancelled          — a confirmed CANCEL call, dims + strikes the event.
//   • reschedulePending  — a confirmed RESCHEDULE the user hasn't applied yet
//                          (still at the old time), dims the event.
// Memoised on the calls data so the Sets keep a stable identity across renders —
// safe to pass into other hooks' dependency arrays.
export function useCallEventStatus(): { cancelledIds: Set<string>; reschedulePendingIds: Set<string> } {
  const { data } = useCalls();
  return useMemo(() => {
    const cancelledIds = new Set<string>();
    const reschedulePendingIds = new Set<string>();
    for (const c of data ?? []) {
      if (!c.eventId || c.outcome !== 'confirmed' || c.acknowledged) continue;
      if (c.action === 'cancel') cancelledIds.add(c.eventId);
      else if (c.action === 'reschedule') reschedulePendingIds.add(c.eventId);
    }
    return { cancelledIds, reschedulePendingIds };
  }, [data]);
}

// The most recent call placed for a given event, if any (newest first from the API).
export function latestCallForEvent(calls: PhoneCallRecord[] | undefined, eventId: string): PhoneCallRecord | undefined {
  return (calls ?? []).find((c) => c.eventId === eventId);
}
