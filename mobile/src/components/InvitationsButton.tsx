import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { invitationsApi, customCalendarsApi, tripsApi, householdApi, callsApi } from '../api';
import { colors } from '../theme';

// The invitations button in the bottom-right floating pill on the Calendar and
// Events views (opens the Invitations modal). Shows a count badge while any
// invitation — event, calendar, trip, or household — is awaiting a reply, or a
// Calen phone-call outcome notice awaits dismissal in the "New" tab. Sized to
// match the pill's other buttons.
export default function InvitationsButton({ onPress }: { onPress: () => void }) {
  const invQ = useQuery({
    queryKey: ['invitations'],
    queryFn: async () => (await invitationsApi.list()).data,
    staleTime: 60_000,
  });
  const calInvQ = useQuery({
    queryKey: ['calendarInvitations'],
    queryFn: async () => (await customCalendarsApi.invitations()).data,
    staleTime: 60_000,
  });
  const tripInvQ = useQuery({
    queryKey: ['tripInvitations'],
    queryFn: async () => (await tripsApi.invitations()).data,
    staleTime: 60_000,
  });
  const hhInvQ = useQuery({
    queryKey: ['householdInvitations', 'mine'],
    queryFn: async () => (await householdApi.myInvitations()).data,
    staleTime: 60_000,
  });
  const callsQ = useQuery({
    queryKey: ['calls'],
    queryFn: async () => (await callsApi.list()).data,
    staleTime: 60_000,
  });
  const countPending = (rows?: { status: string }[]) => (rows ?? []).filter((i) => i.status === 'pending').length;
  const callNotices = (callsQ.data ?? []).filter(
    (c) => (c.status === 'ended' || c.status === 'failed') && c.outcome && !c.acknowledged,
  ).length;
  const pending =
    countPending(invQ.data) + countPending(calInvQ.data) +
    countPending(tripInvQ.data) + countPending(hhInvQ.data) + callNotices;

  return (
    <TouchableOpacity style={styles.btn} onPress={onPress}>
      <Ionicons name="mail-outline" size={22} color="#fff" />
      {pending > 0 ? (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{pending > 9 ? '9+' : pending}</Text>
        </View>
      ) : null}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: { paddingHorizontal: 12, paddingVertical: 6 },
  badge: {
    position: 'absolute', top: 0, right: 4,
    minWidth: 16, height: 16, borderRadius: 8, paddingHorizontal: 3,
    backgroundColor: colors.error, alignItems: 'center', justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: '700' },
});
