import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, StyleSheet, Alert, ActivityIndicator, TouchableOpacity } from 'react-native';
import { KeyboardAwareScrollView } from 'react-native-keyboard-controller';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { householdApi, HouseholdMember, HouseholdInvitation, JoinRequestForApprover, JoinRequestMine } from '../../api';
import { Button, Card, Input, SectionTitle } from '../../components/ui';
import EncryptionSetupCard from '../../components/EncryptionSetupCard';
import { ensureHouseholdKey, getHDK, wrapHDKForJoiner, publicKeyFingerprint } from '../../lib/e2ee';
import { classifyRecipient, composeShareSms } from '../../lib/shareInvite';
import { colors, spacing } from '../../theme';

// Household hub: rename, invite members by email, approve-on-device joins
// (request → a member verifies a fingerprint and approves → membership + HDK
// envelope are granted), and member management. Joining another household is by
// accepting an emailed invitation from the Invitations inbox.
export default function HouseholdScreen() {
  const qc = useQueryClient();
  const { data: household, isLoading, refetch } = useQuery({
    queryKey: ['household'],
    queryFn: async () => (await householdApi.get()).data,
  });

  const [name, setName] = useState('');
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviting, setInviting] = useState(false);
  const [inviteError, setInviteError] = useState('');
  const [inviteNote, setInviteNote] = useState('');
  const [leaving, setLeaving] = useState(false);

  const { data: sentInvites, refetch: refetchInvites } = useQuery({
    queryKey: ['householdInvitations', 'sent'],
    queryFn: async () => (await householdApi.sentInvitations()).data,
  });

  const [myRequest, setMyRequest] = useState<JoinRequestMine | null>(null);
  const [canceling, setCanceling] = useState(false);
  const [pending, setPending] = useState<JoinRequestForApprover[]>([]);
  const [fingerprints, setFingerprints] = useState<Record<string, string>>({});
  const [acting, setActing] = useState<string | null>(null);
  const [approveError, setApproveError] = useState('');
  const [keyVersion, setKeyVersion] = useState(0);
  const [hdkReady, setHdkReady] = useState(false);

  useEffect(() => {
    if (household) setName(household.name);
  }, [household]);

  const loadPending = useCallback(async () => {
    try {
      const { data } = await householdApi.joinRequests();
      setPending(data);
      // Compute any fingerprints we don't have yet and merge them in.
      await Promise.all(data.map(async (r) => {
        const fp = await publicKeyFingerprint(r.requesterPublicKey);
        setFingerprints((cur) => (cur[r._id] === fp ? cur : { ...cur, [r._id]: fp }));
      }));
    } catch { /* not a member / transient */ }
  }, []);

  const loadMine = useCallback(async () => {
    try {
      const { data } = await householdApi.myJoinRequest();
      setMyRequest((prevMine) => {
        if (data.status === 'approved' && prevMine?.status === 'pending') {
          // Our envelope now exists — unwrap the HDK and refresh membership.
          ensureHouseholdKey().then(() => { refetch(); qc.invalidateQueries(); });
          return null;
        }
        return data.status === 'none' ? null : data;
      });
    } catch { /* ignore */ }
  }, [qc, refetch]);

  const loadKeyState = useCallback(async () => {
    try {
      await ensureHouseholdKey();
      const { data } = await householdApi.getKey();
      setKeyVersion(data.currentKeyVersion || 0);
      setHdkReady(getHDK() != null);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    loadKeyState();
    loadMine();
    loadPending();
    const timer = setInterval(() => { loadMine(); loadPending(); }, 5000);
    return () => clearInterval(timer);
  }, [loadKeyState, loadMine, loadPending]);

  async function saveName() {
    const trimmed = name.trim();
    if (!trimmed || trimmed === household?.name) return;
    await householdApi.rename(trimmed);
    qc.invalidateQueries({ queryKey: ['household'] });
  }

  async function invite() {
    const recipient = classifyRecipient(inviteEmail);
    if (!recipient) { setInviteError('Enter a valid email or phone number'); return; }
    setInviting(true);
    setInviteError('');
    setInviteNote('');
    try {
      const { data } = await householdApi.invite(recipient);
      setInviteEmail('');
      if ('phone' in recipient) {
        // Phone invites carry no email — text them from this device.
        try {
          await composeShareSms(recipient.phone, `the ${household?.name || 'family'} household`);
        } catch (e: any) {
          setInviteError(e?.message || 'Saved, but the text couldn’t be started.');
        }
        setInviteNote(
          data.userExists
            ? 'Invitation sent — it’s in their Invitations inbox.'
            : 'Invitation saved. Send the text so they can join once they get the app.',
        );
      } else {
        setInviteNote(
          data.userExists
            ? 'Invitation sent — it’s now in their Invitations inbox.'
            : 'Invitation emailed. They’ll see it in the app once they sign up.',
        );
      }
      await refetchInvites();
    } catch (e: any) {
      setInviteError(e?.response?.data?.error || 'Could not send the invitation');
    } finally {
      setInviting(false);
    }
  }

  function revokeInvite(inv: HouseholdInvitation) {
    Alert.alert('Revoke invitation?', `${inv.toEmail} will no longer be able to join with this invite.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Revoke',
        style: 'destructive',
        onPress: async () => {
          try {
            await householdApi.revokeInvitation(inv._id);
            await refetchInvites();
          } catch (e: any) {
            Alert.alert('Could not revoke', e?.response?.data?.error || 'Please try again.');
          }
        },
      },
    ]);
  }

  async function cancelRequest() {
    setCanceling(true);
    try {
      await householdApi.cancelJoinRequest();
      setMyRequest(null);
    } finally {
      setCanceling(false);
    }
  }

  async function approve(r: JoinRequestForApprover) {
    setApproveError('');
    setActing(r._id);
    try {
      const envelope = await wrapHDKForJoiner(r.requesterPublicKey, keyVersion);
      if (!envelope) { setApproveError('Your household key is not ready — reopen this screen and try again.'); return; }
      await householdApi.approveJoin(r._id, envelope);
      await refetch();
      qc.invalidateQueries();
      await loadPending();
    } catch (e: any) {
      setApproveError(e?.response?.data?.error || 'Could not approve');
    } finally {
      setActing(null);
    }
  }

  function reject(r: JoinRequestForApprover) {
    Alert.alert('Reject request?', 'This person will not be able to join.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reject',
        style: 'destructive',
        onPress: async () => {
          setActing(r._id);
          try {
            await householdApi.rejectJoin(r._id);
            setPending((cur) => cur.filter((x) => x._id !== r._id));
          } finally {
            setActing(null);
          }
        },
      },
    ]);
  }

  function removeMember(m: HouseholdMember) {
    const who = [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email || 'this member';
    Alert.alert(
      `Remove ${who}?`,
      'They’ll move to their own household with their own data. Your household’s encryption key rotates so they can’t see anything you add afterward — but they keep access to what they could already see.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Remove',
          style: 'destructive',
          onPress: async () => {
            setActing(m._id);
            try {
              await householdApi.removeMember(m._id);
              await refetch();
              qc.invalidateQueries();
              // Drive the rotation now (the server flagged it) while we're unlocked.
              await ensureHouseholdKey();
            } catch (e: any) {
              Alert.alert('Could not remove member', e?.response?.data?.error || 'Please try again.');
            } finally {
              setActing(null);
            }
          },
        },
      ]
    );
  }

  function leave() {
    Alert.alert(
      'Leave household?',
      'You’ll start a fresh household with your own data.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Leave',
          style: 'destructive',
          onPress: async () => {
            setLeaving(true);
            try {
              await householdApi.leave();
              await refetch();
              qc.invalidateQueries();
            } finally {
              setLeaving(false);
            }
          },
        },
      ]
    );
  }

  if (isLoading || !household) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <KeyboardAwareScrollView bottomOffset={24} keyboardShouldPersistTaps="handled" style={styles.container} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <Input
          label="Household name"
          value={name}
          onChangeText={setName}
          onBlur={saveName}
          returnKeyType="done"
          onSubmitEditing={saveName}
        />
        <Text style={styles.caption}>
          Everyone in this household shares calendars, tasks, chores, recipes, people, and settings.
        </Text>
      </Card>

      {/* Requests to join THIS household — an existing member approves. */}
      {pending.length > 0 ? (
        <Card style={styles.card}>
          <SectionTitle>Requests to join</SectionTitle>
          <Text style={styles.caption}>
            Before approving, confirm the security code below matches what the person sees on their
            device — this proves you're granting access to the right person.
          </Text>
          {!hdkReady ? (
            <Text style={styles.warn}>Your device is still unlocking the household key — reopen this screen if this persists.</Text>
          ) : null}
          {pending.map((r) => {
            const display = [r.firstName, r.lastName].filter(Boolean).join(' ') || r.email || 'Someone';
            return (
              <View key={r._id} style={styles.requestRow}>
                <Text style={styles.memberName}>{display}</Text>
                {r.email ? <Text style={styles.memberEmail}>{r.email}</Text> : null}
                <Text style={styles.fingerprint}>{fingerprints[r._id] || '…'}</Text>
                <View style={styles.requestActions}>
                  <View style={styles.actionBtn}>
                    <Button title="Approve" onPress={() => approve(r)} loading={acting === r._id} disabled={!hdkReady} />
                  </View>
                  <View style={styles.actionBtn}>
                    <Button title="Reject" variant="ghost" onPress={() => reject(r)} disabled={acting === r._id} />
                  </View>
                </View>
              </View>
            );
          })}
          {approveError ? <Text style={styles.error}>{approveError}</Text> : null}
        </Card>
      ) : null}

      <Card style={styles.card}>
        <SectionTitle>Members ({household.members.length})</SectionTitle>
        {household.members.map((m: HouseholdMember) => {
          const display = [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email || '?';
          const isMemberOwner = String(m._id) === String(household.ownerId);
          const canRemove = !!household.isOwner && !isMemberOwner;
          return (
            <View key={m._id} style={styles.memberRow}>
              <View style={styles.memberAvatar}>
                <Text style={styles.memberInitial}>
                  {(m.firstName || m.email || '?').charAt(0).toUpperCase()}
                </Text>
              </View>
              <View style={styles.memberText}>
                <Text style={styles.memberName} numberOfLines={1}>{display}</Text>
                {m.email ? <Text style={styles.memberEmail} numberOfLines={1}>{m.email}</Text> : null}
              </View>
              {isMemberOwner ? <Text style={styles.ownerChip}>Owner</Text> : null}
              {canRemove ? (
                <TouchableOpacity
                  onPress={() => removeMember(m)}
                  disabled={acting === m._id}
                  style={styles.removeBtn}
                  activeOpacity={0.7}
                >
                  {acting === m._id
                    ? <ActivityIndicator size="small" color={colors.error} />
                    : <Ionicons name="person-remove-outline" size={18} color={colors.error} />}
                </TouchableOpacity>
              ) : null}
            </View>
          );
        })}

        <SectionTitle>Invite a member</SectionTitle>
        <View style={styles.emailAddRow}>
          <Input
            value={inviteEmail}
            onChangeText={(t) => { setInviteEmail(t); setInviteError(''); setInviteNote(''); }}
            placeholder="Add email or phone…"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="send"
            onSubmitEditing={invite}
            containerStyle={styles.emailInput}
            style={styles.emailInputField}
          />
          {inviting ? (
            <ActivityIndicator size="small" color={colors.primary} style={styles.emailAddIcon} />
          ) : (
            <TouchableOpacity
              onPress={invite}
              disabled={!inviteEmail.trim()}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              style={styles.emailAddIcon}
            >
              <Ionicons name="add-circle" size={28} color={inviteEmail.trim() ? colors.primary : colors.border} />
            </TouchableOpacity>
          )}
        </View>
        {inviteError ? <Text style={styles.error}>{inviteError}</Text> : null}
        {inviteNote ? <Text style={styles.note}>{inviteNote}</Text> : null}

        {(sentInvites ?? []).filter((i) => i.status !== 'declined').length > 0 ? (
          <View style={styles.invitesList}>
            {(sentInvites ?? []).filter((i) => i.status !== 'declined').map((inv) => (
              <View key={inv._id} style={styles.inviteRow}>
                <View style={styles.memberText}>
                  <Text style={styles.memberName} numberOfLines={1}>{inv.toEmail || inv.toPhone}</Text>
                  <Text style={styles.memberEmail}>
                    {inv.status === 'accepted' ? 'Accepted — approve them below' : 'Invited'}
                  </Text>
                </View>
                <TouchableOpacity onPress={() => revokeInvite(inv)} style={styles.removeBtn} activeOpacity={0.7}>
                  <Ionicons name="close-circle-outline" size={20} color={colors.error} />
                </TouchableOpacity>
              </View>
            ))}
          </View>
        ) : null}
      </Card>

      {/* Encryption status + §9 migration checklist — owner-only. Shows the
          current encrypted/not-encrypted state; while not yet encrypted it also
          surfaces the per-member readiness checklist. Members see their personal
          status on the Sign-in & Security screen instead. */}
      {household.isOwner ? <EncryptionSetupCard e2eeActive={household.e2eeActive} /> : null}

      {myRequest && myRequest.status === 'pending' ? (
        <Card style={styles.card}>
          <View style={styles.waitingRow}>
            <ActivityIndicator color={colors.primary} />
            <Text style={styles.waitingTitle}>Waiting for approval</Text>
          </View>
          <Text style={styles.caption}>
            A family member in “{myRequest.name}” needs to approve you on their device. This stays
            pending until they're online.
          </Text>
          <Button title="Cancel request" variant="ghost" onPress={cancelRequest} loading={canceling} />
        </Card>
      ) : null}

      <Button title="Leave household" variant="danger" onPress={leave} loading={leaving} />
    </KeyboardAwareScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  card: { marginBottom: spacing.md },
  caption: { fontSize: 12, color: colors.textMuted, marginTop: 4, marginBottom: spacing.sm, lineHeight: 17 },
  warn: { fontSize: 12, color: colors.warning ?? '#b26a00', marginBottom: spacing.sm },
  note: { fontSize: 12, color: colors.success, marginBottom: spacing.sm },
  emailAddRow: { position: 'relative', justifyContent: 'center' },
  emailInput: { marginBottom: 0 },
  emailInputField: { paddingRight: 46 },
  emailAddIcon: { position: 'absolute', right: 10, alignItems: 'center', justifyContent: 'center' },
  invitesList: { marginTop: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  inviteRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 8 },
  requestRow: { paddingVertical: spacing.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  requestActions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  actionBtn: { flex: 1 },
  fingerprint: { fontSize: 13, letterSpacing: 1, color: colors.primary, marginTop: 4, fontVariant: ['tabular-nums'] },
  waitingRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: 4 },
  waitingTitle: { fontSize: 15, fontWeight: '600', color: colors.text },
  memberRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6 },
  memberAvatar: {
    width: 32, height: 32, borderRadius: 16, backgroundColor: colors.primary,
    alignItems: 'center', justifyContent: 'center', marginRight: spacing.md,
  },
  memberInitial: { color: '#fff', fontSize: 12, fontWeight: '700' },
  memberText: { flex: 1, minWidth: 0 },
  memberName: { fontSize: 14, fontWeight: '600', color: colors.text },
  memberEmail: { fontSize: 12, color: colors.textMuted },
  ownerChip: {
    fontSize: 11, fontWeight: '600', color: colors.primary, backgroundColor: colors.primary + '18',
    paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden',
  },
  removeBtn: { padding: 6, marginLeft: spacing.sm },
  error: { color: colors.error, fontSize: 13, marginBottom: spacing.sm, marginTop: spacing.sm },
});
