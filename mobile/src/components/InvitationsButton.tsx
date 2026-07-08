import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery } from '@tanstack/react-query';
import { invitationsApi } from '../api';
import { colors } from '../theme';

// The invitations button in the bottom-right floating pill on the Calendar and
// Events views (opens the Invitations modal). Shows a count badge while any
// invitation is awaiting a reply. Sized to match the pill's other buttons.
export default function InvitationsButton({ onPress }: { onPress: () => void }) {
  const invQ = useQuery({
    queryKey: ['invitations'],
    queryFn: async () => (await invitationsApi.list()).data,
    staleTime: 60_000,
  });
  const pending = (invQ.data ?? []).filter((i) => i.status === 'pending').length;

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
