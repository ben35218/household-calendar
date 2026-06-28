import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import * as Clipboard from 'expo-clipboard';
import { householdApi, HouseholdMember } from '../../api';
import { Button, Card, Input, SectionTitle } from '../../components/ui';
import { colors, spacing } from '../../theme';

// Mirrors client/src/views/HouseholdView.vue: rename, invite code, members,
// join another household, leave.
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

  useEffect(() => {
    if (household) setName(household.name);
  }, [household]);

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

  async function join() {
    const code = joinCode.trim().toUpperCase();
    if (!code) return;
    setJoining(true);
    setJoinError('');
    try {
      await householdApi.join(code);
      setJoinCode('');
      await refetch();
      qc.invalidateQueries();
    } catch (e: any) {
      setJoinError(e?.response?.data?.error || 'Could not join');
    } finally {
      setJoining(false);
    }
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
          <Text style={styles.code}>{household.joinCode}</Text>
          <Button title={copied ? 'Copied' : 'Copy'} variant="ghost" onPress={copyCode} />
        </View>
        <Text style={styles.caption}>Share this code with family so they can join your household.</Text>
      </Card>

      <Card style={styles.card}>
        <SectionTitle>Members ({household.members.length})</SectionTitle>
        {household.members.map((m: HouseholdMember) => {
          const display = [m.firstName, m.lastName].filter(Boolean).join(' ') || m.email || '?';
          const isOwner = String(m._id) === String(household.ownerId);
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
              {isOwner ? <Text style={styles.ownerChip}>Owner</Text> : null}
            </View>
          );
        })}
      </Card>

      <Card style={styles.card}>
        <SectionTitle>Join another household</SectionTitle>
        <Text style={styles.caption}>
          Enter a household's invite code to join it. Your current data comes with you and becomes
          shared with that household.
        </Text>
        <Input
          label="Invite code"
          value={joinCode}
          onChangeText={setJoinCode}
          autoCapitalize="characters"
          autoCorrect={false}
        />
        {joinError ? <Text style={styles.error}>{joinError}</Text> : null}
        <Button title="Join" onPress={join} loading={joining} disabled={!joinCode.trim()} />
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
  codeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  code: {
    fontSize: 18, fontWeight: '700', letterSpacing: 3, color: colors.primary,
    backgroundColor: colors.primary + '18', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8,
    overflow: 'hidden',
  },
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
  error: { color: colors.error, fontSize: 13, marginBottom: spacing.sm },
});
