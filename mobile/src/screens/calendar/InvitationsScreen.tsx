import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, FlatList, ActivityIndicator } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invitationsApi, EventInvitation } from '../../api';
import { Button, SegmentedControl, Badge } from '../../components/ui';
import { colors, spacing } from '../../theme';

// Invitations inbox (event sharing across households). Opened from the
// bottom-right floating button on the Calendar and Events views; presented as
// a modal with an X close button in the header (see AppNavigator). "New" holds
// pending invitations with Accept/Decline; "Replied" is the response history.
// Accepting copies the event onto this user's calendar; either way the emailed
// invite.ics can add it to Apple/Google Calendar.

type Tab = 'new' | 'replied';

// "Monday, July 13, 2026" or "Jul 13, 3:00 PM – 4:00 PM" style when-line.
function whenLabel(e: EventInvitation['event']): string {
  const start = new Date(e.startDate);
  if (e.allDay !== false) {
    // All-day records are stored at noon UTC → read the date in UTC.
    const opts = { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' } as const;
    const s = start.toLocaleDateString(undefined, opts);
    if (e.endDate) {
      const end = new Date(e.endDate).toLocaleDateString(undefined, opts);
      if (end !== s) return `${s} – ${end}`;
    }
    return s;
  }
  const day = start.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const t1 = start.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (!e.endDate) return `${day}, ${t1}`;
  const t2 = new Date(e.endDate).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${day}, ${t1} – ${t2}`;
}

export default function InvitationsScreen() {
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('new');
  const [error, setError] = useState('');

  const invQ = useQuery({
    queryKey: ['invitations'],
    queryFn: async () => (await invitationsApi.list()).data,
  });

  const respond = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'accept' | 'decline' }) =>
      action === 'accept' ? invitationsApi.accept(id) : invitationsApi.decline(id),
    onSuccess: (_res, { action }) => {
      setError('');
      qc.invalidateQueries({ queryKey: ['invitations'] });
      // Accepting adds a copy of the event to this user's calendar.
      if (action === 'accept') qc.invalidateQueries({ queryKey: ['calendar'] });
    },
    onError: (e: any) => setError(e.response?.data?.error || 'Something went wrong'),
  });

  const items = useMemo(() => {
    const all = invQ.data ?? [];
    return tab === 'new'
      ? all.filter((i) => i.status === 'pending')
      : all.filter((i) => i.status !== 'pending');
  }, [invQ.data, tab]);

  const renderItem = ({ item }: { item: EventInvitation }) => {
    const busy = respond.isPending && respond.variables?.id === item._id;
    return (
      <View style={styles.card}>
        <Text style={styles.from}>
          {item.fromName || item.fromEmail || 'Someone'}
          <Text style={styles.fromSub}> invited you</Text>
        </Text>
        <Text style={styles.title}>{item.event.title}</Text>
        <View style={styles.metaRow}>
          <Ionicons name="time-outline" size={14} color={colors.textMuted} />
          <Text style={styles.meta}>{whenLabel(item.event)}</Text>
        </View>
        {item.event.location ? (
          <View style={styles.metaRow}>
            <Ionicons name="location-outline" size={14} color={colors.textMuted} />
            <Text style={styles.meta} numberOfLines={1}>{item.event.location}</Text>
          </View>
        ) : null}
        {item.event.description ? (
          <Text style={styles.description} numberOfLines={3}>{item.event.description}</Text>
        ) : null}

        {item.status === 'pending' ? (
          <View style={styles.actions}>
            <View style={styles.actionBtn}>
              <Button
                title="Accept"
                loading={busy && respond.variables?.action === 'accept'}
                onPress={() => respond.mutate({ id: item._id, action: 'accept' })}
              />
            </View>
            <View style={styles.actionBtn}>
              <Button
                title="Decline"
                variant="ghost"
                color={colors.error}
                loading={busy && respond.variables?.action === 'decline'}
                onPress={() => respond.mutate({ id: item._id, action: 'decline' })}
              />
            </View>
          </View>
        ) : (
          <View style={styles.statusRow}>
            <Badge
              label={item.status === 'accepted' ? 'Accepted' : item.status === 'left' ? 'Left' : 'Declined'}
              color={item.status === 'accepted' ? colors.success : item.status === 'left' ? colors.textMuted : colors.error}
            />
            {item.respondedAt ? (
              <Text style={styles.meta}>
                {new Date(item.respondedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
              </Text>
            ) : null}
          </View>
        )}
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.tabs}>
        <SegmentedControl<Tab>
          value={tab}
          options={[
            { label: 'New', value: 'new' },
            { label: 'Replied', value: 'replied' },
          ]}
          onChange={setTab}
        />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {invQ.isLoading ? (
        <View style={styles.center}><ActivityIndicator color={colors.primary} /></View>
      ) : items.length === 0 ? (
        <View style={styles.center}>
          <MaterialCommunityIcons name="email-open-outline" size={40} color={colors.textMuted} />
          <Text style={styles.emptyText}>
            {tab === 'new' ? 'No new invitations.' : 'No replied invitations yet.'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={items}
          keyExtractor={(i) => i._id}
          renderItem={renderItem}
          contentContainerStyle={styles.list}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  tabs: { paddingHorizontal: spacing.md, paddingTop: spacing.md },
  list: { padding: spacing.md, paddingBottom: spacing.xl },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.xl },
  emptyText: { color: colors.textMuted, marginTop: spacing.sm },
  error: { color: colors.error, paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: 12, padding: spacing.md, marginBottom: spacing.md },
  from: { fontSize: 13, fontWeight: '600', color: colors.text },
  fromSub: { fontWeight: '400', color: colors.textMuted },
  title: { fontSize: 17, fontWeight: '700', color: colors.text, marginTop: 4, marginBottom: 6 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 2 },
  meta: { fontSize: 13, color: colors.textMuted, flexShrink: 1 },
  description: { fontSize: 13, color: colors.textMuted, marginTop: spacing.sm },
  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md },
  actionBtn: { flex: 1 },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginTop: spacing.md },
});
