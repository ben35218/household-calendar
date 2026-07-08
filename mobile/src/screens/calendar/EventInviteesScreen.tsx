import React, { useMemo, useState } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, RouteProp } from '@react-navigation/native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { invitationsApi, peopleApi, EventInvitation, Person } from '../../api';
import { Badge, Button, Input, Screen } from '../../components/ui';
import { useQueuedInvitees, setQueuedInvitees } from '../../lib/inviteeDraft';
import { openRecord } from '../../lib/e2ee';
import { useAuth } from '../../store/auth';
import { CalendarStackParamList } from '../../navigation/CalendarNavigator';
import { colors, spacing } from '../../theme';

type Rt = RouteProp<CalendarStackParamList, 'EventInvitees'>;

// Manage who is invited to one event, reached from the Invitees card on the
// event form. Two modes:
//   - saved event (eventId set): invitations send immediately (email + in-app
//     for account holders) and each row shows its reply status with a remove
//     action (removing an accepted invitee also deletes their copy);
//   - new-event draft (no eventId): addresses queue in lib/inviteeDraft and
//     EventFormScreen sends them once the event is saved.
// The event snapshot rides in as a route param — it's the decrypted form
// content, which the server can't derive from an E2EE event.

const INVITE_STATUS: Record<EventInvitation['status'], { label: string; color: string }> = {
  pending:  { label: 'Pending',  color: colors.textMuted },
  accepted: { label: 'Accepted', color: colors.success },
  declined: { label: 'Declined', color: colors.error },
  left:     { label: 'Left',     color: colors.textMuted },
};

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function EventInviteesScreen() {
  const { eventId, snapshot } = useRoute<Rt>().params;
  const qc = useQueryClient();
  const isDraft = !eventId;

  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [suggestOpen, setSuggestOpen] = useState(false);
  const { user } = useAuth();

  const queued = useQueuedInvitees();

  const inviteesQ = useQuery({
    queryKey: ['invitations', 'sent', eventId],
    queryFn: async () => (await invitationsApi.sentForEvent(eventId!)).data,
    enabled: !isDraft,
  });

  // Contacts (decrypted on-device) back the email field's autocomplete.
  const peopleQ = useQuery({
    queryKey: ['people', 'decrypted'],
    queryFn: async () => {
      const rows = (await peopleApi.list()).data;
      return Promise.all(rows.map((p) => openRecord('Person', p)));
    },
  });

  // Contacts matching the typed text by name or email — excluding addresses
  // already on the list and the user's own (the server rejects self-invites).
  const suggestions = useMemo(() => {
    const q = email.trim().toLowerCase();
    if (!q) return [];
    const taken = new Set(
      (isDraft ? queued : (inviteesQ.data ?? []).map((i) => i.toEmail)).map((e) => e.toLowerCase()),
    );
    if (user?.email) taken.add(user.email.toLowerCase());
    return (peopleQ.data ?? [])
      .filter((p: Person) => {
        const em = p.email?.trim().toLowerCase();
        if (!em || taken.has(em)) return false;
        return em.includes(q) || (p.name ?? '').toLowerCase().includes(q);
      })
      .slice(0, 5);
  }, [peopleQ.data, email, isDraft, queued, inviteesQ.data, user?.email]);

  const send = useMutation({
    mutationFn: (to: string) => invitationsApi.send({ eventId: eventId!, email: to, event: snapshot }),
    onSuccess: (res) => {
      setEmail('');
      setError('');
      setMessage(
        res.data.userExists
          ? 'Invitation sent — they’ll get an email and see it in their app.'
          : 'Invitation emailed — the attached file adds it to their calendar.',
      );
      qc.invalidateQueries({ queryKey: ['invitations', 'sent', eventId] });
    },
    onError: (e: any) => {
      setMessage('');
      setError(e.response?.data?.error || 'Could not send the invitation');
    },
  });

  const revoke = useMutation({
    mutationFn: (invitationId: string) => invitationsApi.revoke(invitationId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['invitations', 'sent', eventId] }),
    onError: (e: any) => setError(e.response?.data?.error || 'Could not remove the invitee'),
  });

  const onAdd = () => {
    const to = email.trim().toLowerCase();
    if (!EMAIL_RE.test(to)) {
      setMessage('');
      setError('Enter a valid email address');
      return;
    }
    if (isDraft) {
      if (!queued.includes(to)) setQueuedInvitees([...queued, to]);
      setEmail('');
      setError('');
      setMessage('');
    } else {
      send.mutate(to);
    }
  };

  const removeDraft = (to: string) => setQueuedInvitees(queued.filter((q) => q !== to));

  const confirmRevoke = (inv: EventInvitation) =>
    Alert.alert(
      'Remove invitee?',
      inv.status === 'accepted'
        ? `The event will be removed from ${inv.toEmail}'s calendar.`
        : `${inv.toEmail} will no longer be able to accept this invitation.`,
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Remove', style: 'destructive', onPress: () => revoke.mutate(inv._id) },
      ],
    );

  const empty = isDraft ? queued.length === 0 : (inviteesQ.data?.length ?? 0) === 0;

  return (
    <Screen>
      <Text style={styles.hint}>
        {isDraft
          ? 'Add people outside your household by email. Invitations are sent when you save the event.'
          : 'Invite people outside your household by email. They can add the event to Apple or Google Calendar, or accept it onto their calendar in this app.'}
      </Text>

      <View style={styles.emailWrap}>
        <Input
          label="Email address"
          value={email}
          onChangeText={(v) => { setEmail(v); setMessage(''); setError(''); setSuggestOpen(true); }}
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
        />
        {suggestOpen && suggestions.length > 0 ? (
          <View style={styles.dropdown}>
            {suggestions.map((p) => (
              <TouchableOpacity
                key={p._id}
                style={styles.suggestRow}
                onPress={() => { setEmail(p.email!.trim().toLowerCase()); setSuggestOpen(false); }}
              >
                <Ionicons name="person-outline" size={16} color={colors.textMuted} />
                <View style={styles.suggestText}>
                  <Text style={styles.suggestName} numberOfLines={1}>{p.name}</Text>
                  <Text style={styles.suggestEmail} numberOfLines={1}>{p.email}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </View>
        ) : null}
      </View>
      <Button
        title={isDraft ? 'Add invitee' : 'Send invitation'}
        variant="ghost"
        loading={send.isPending}
        disabled={!email.trim()}
        onPress={onAdd}
      />
      {message ? <Text style={styles.success}>{message}</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.list}>
        {isDraft
          ? queued.map((to) => (
              <View key={to} style={styles.row}>
                <Text style={styles.email} numberOfLines={1}>{to}</Text>
                <Badge label="Not sent yet" color={colors.textMuted} />
                <TouchableOpacity style={styles.remove} onPress={() => removeDraft(to)}>
                  <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            ))
          : (inviteesQ.data ?? []).map((inv) => (
              <View key={inv._id} style={styles.row}>
                <Text style={styles.email} numberOfLines={1}>{inv.toEmail}</Text>
                <Badge label={INVITE_STATUS[inv.status].label} color={INVITE_STATUS[inv.status].color} />
                <TouchableOpacity style={styles.remove} onPress={() => confirmRevoke(inv)}>
                  <Ionicons name="close-circle" size={20} color={colors.textMuted} />
                </TouchableOpacity>
              </View>
            ))}
        {empty ? (
          <View style={styles.empty}>
            <Ionicons name="people-outline" size={36} color={colors.textMuted} />
            <Text style={styles.emptyText}>No one invited yet.</Text>
          </View>
        ) : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md },
  // Contact autocomplete under the email field (mirrors PlacesAutocomplete)
  emailWrap: { position: 'relative' },
  dropdown: {
    borderWidth: 1, borderColor: colors.border, borderRadius: 8, backgroundColor: colors.surface,
    marginTop: -spacing.sm, marginBottom: spacing.sm, overflow: 'hidden',
  },
  suggestRow: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm, padding: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border,
  },
  suggestText: { flex: 1 },
  suggestName: { fontSize: 14, color: colors.text },
  suggestEmail: { fontSize: 12, color: colors.textMuted },
  success: { color: colors.success, marginTop: spacing.sm },
  error: { color: colors.error, marginTop: spacing.sm },
  list: { marginTop: spacing.md, gap: spacing.xs },
  row: {
    flexDirection: 'row', alignItems: 'center', gap: spacing.sm,
    backgroundColor: colors.surface, borderRadius: 10,
    paddingHorizontal: spacing.md, paddingVertical: spacing.sm,
  },
  email: { flex: 1, fontSize: 14, color: colors.text },
  remove: { padding: 2 },
  empty: { alignItems: 'center', paddingVertical: spacing.xl, gap: spacing.sm },
  emptyText: { color: colors.textMuted },
});
