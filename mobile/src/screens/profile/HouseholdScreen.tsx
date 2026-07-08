import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, ActivityIndicator, Share, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { householdApi, HouseholdMember, JoinRequestForApprover, JoinRequestMine } from '../../api';
import { Button, Card, Input, SectionTitle } from '../../components/ui';
import { ensureHouseholdKey, getHDK, wrapHDKForJoiner, publicKeyFingerprint } from '../../lib/e2ee';
import { colors, spacing } from '../../theme';

// Mirrors client/src/views/HouseholdView.vue: rename, invite code, members, and
// the approve-on-device join flow (Phase 2) — request → a member verifies a
// fingerprint and approves → membership + HDK envelope are granted.
export default function HouseholdScreen() {
  const qc = useQueryClient();
  const { data: household, isLoading, refetch } = useQuery({
    queryKey: ['household'],
    queryFn: async () => (await householdApi.get()).data,
  });

  const [name, setName] = useState('');
  const [copied, setCopied] = useState(false);
  const [joinCode, setJoinCode] = useState('');
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState('');
  const [leaving, setLeaving] = useState(false);

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

  async function copyCode() {
    if (!household) return;
    await Clipboard.setStringAsync(household.joinCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  async function shareCode() {
    if (!household) return;
    await Share.share({
      message: `Join our household "${household.name}" — use invite code ${household.joinCode}.`,
    });
  }

  async function join() {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setJoining(true);
    setJoinError('');
    try {
      const { data } = await householdApi.join(code);
      setJoinCode('');
      if (data.status === 'pending') {
        setMyRequest({ status: 'pending', name: data.name, requestId: data.requestId });
      } else {
        await refetch();
        qc.invalidateQueries();
      }
    } catch (e: any) {
      setJoinError(e?.response?.data?.error || 'Could not request to join');
    } finally {
      setJoining(false);
    }
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
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
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

        <SectionTitle>Invite code</SectionTitle>
        <View style={styles.codeRow}>
          <TouchableOpacity onPress={copyCode} activeOpacity={0.7}>
            <Text style={styles.code}>{household.joinCode}</Text>
          </TouchableOpacity>
          <TouchableOpacity onPress={shareCode} style={styles.shareBtn} activeOpacity={0.7}>
            <Ionicons name="share-outline" size={18} color={colors.primary} />
            <Text style={styles.shareText}>Share</Text>
          </TouchableOpacity>
        </View>
        <Text style={styles.caption}>
          {copied ? 'Copied to clipboard!' : 'Share the code with family. When they enter it, you\'ll approve them on your device.'}
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
      </Card>

      <Card style={styles.card}>
        {myRequest && myRequest.status === 'pending' ? (
          <>
            <View style={styles.waitingRow}>
              <ActivityIndicator color={colors.primary} />
              <Text style={styles.waitingTitle}>Waiting for approval</Text>
            </View>
            <Text style={styles.caption}>
              A family member in “{myRequest.name}” needs to approve you on their device. This stays
              pending until they're online.
            </Text>
            <Button title="Cancel request" variant="ghost" onPress={cancelRequest} loading={canceling} />
          </>
        ) : (
          <>
            <SectionTitle>Join another household</SectionTitle>
            <Text style={styles.caption}>
              Enter a household's invite code. A member there approves you on their device; then your
              data becomes shared with them.
            </Text>
            <Input
              label="Invite code"
              value={joinCode}
              onChangeText={setJoinCode}
              autoCapitalize="characters"
              autoCorrect={false}
            />
            {joinError ? <Text style={styles.error}>{joinError}</Text> : null}
            <Button title="Request" onPress={join} loading={joining} disabled={!joinCode.trim()} />
          </>
        )}
      </Card>

      <Button title="Leave household" variant="danger" onPress={leave} loading={leaving} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  card: { marginBottom: spacing.md },
  caption: { fontSize: 12, color: colors.textMuted, marginTop: 4, marginBottom: spacing.sm, lineHeight: 17 },
  warn: { fontSize: 12, color: colors.warning ?? '#b26a00', marginBottom: spacing.sm },
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  code: {
    fontSize: 18, fontWeight: '700', letterSpacing: 3, color: colors.primary,
    backgroundColor: colors.primary + '18', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    overflow: 'hidden',
  },
  shareBtn: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 6 },
  shareText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
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
