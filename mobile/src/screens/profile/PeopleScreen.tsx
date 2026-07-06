import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../store/auth';
import { peopleApi, householdApi, Person } from '../../api';
import { openRecord, getHDK, sealNew } from '../../lib/e2ee';
import * as replica from '../../lib/replica';
import { Card, Chip } from '../../components/ui';
import { colors, spacing } from '../../theme';
import type { ProfileStackParamList } from '../../navigation/ProfileNavigator';

type Nav = NativeStackNavigationProp<ProfileStackParamList>;

// Encrypted person content (mirrors PersonFormScreen); type stays plaintext for
// roster grouping. birthday is encrypted now (§9.1 P6).
const PERSON_ENC = (p: Record<string, unknown>) => ({
  name: p.name, relationship: p.relationship, interests: p.interests,
  notes: p.notes, address: p.address, phone: p.phone, email: p.email,
  birthday: p.birthday,
});

// Mirrors client/src/views/PeopleView.vue: a "You" card, Family Members, and
// Friends, each tappable to edit. (Contacts/VCF import is tracked as a
// native-contacts follow-up for this wave.)
export default function PeopleScreen() {
  const nav = useNavigation<Nav>();
  const { user } = useAuth();
  const selfId = String(user?._id ?? '');

  const { data: people, isLoading } = useQuery({
    queryKey: ['people'],
    // Offline-first (Phase 4b): fetch + sync the local replica, falling back to
    // the cached copy when the network is unavailable. Decrypt content over
    // plaintext (dual-write); no-op without an HDK.
    queryFn: async () => {
      try {
        const rows = (await peopleApi.list()).data;
        replica.upsert('Person', rows as any).catch(() => {});
        return Promise.all(rows.map((p) => openRecord('Person', p)));
      } catch (e) {
        const cached = await replica.getAll<Person>('Person');
        if (cached.length) return Promise.all(cached.map((p) => openRecord('Person', p)));
        throw e;
      }
    },
  });

  const qc = useQueryClient();
  const { data: household } = useQuery({
    queryKey: ['household'],
    queryFn: async () => (await householdApi.get()).data,
  });

  // Post-drop the server no longer creates a plaintext self-record (ensureSelf
  // no-ops once e2eeActive), so seed an *encrypted* one on first unlock. Dormant
  // pre-drop and when locked — never writes a plaintext self-record.
  React.useEffect(() => {
    if (!people || !household?.e2eeActive || !getHDK()) return;
    if (people.some((p) => p.accountId && String(p.accountId) === selfId)) return;
    const name = [user?.firstName, user?.lastName].filter(Boolean).join(' ').trim() || user?.firstName || '';
    if (!name) return;
    (async () => {
      const payload = { type: 'family', name, address: household.homeAddress || undefined };
      await peopleApi.createSelf(await sealNew('Person', payload, PERSON_ENC(payload)));
      qc.invalidateQueries({ queryKey: ['people'] });
    })().catch(() => {});
  }, [people, household, selfId, user, qc]);

  if (isLoading || !people) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const selfPerson = people.find((p) => p.accountId && String(p.accountId) === selfId);
  const family = people.filter((p) => p.type === 'family' && p !== selfPerson);
  const friends = people.filter((p) => p.type === 'friend');
  const providers = people.filter((p) => p.type === 'service');

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>
        This information helps the AI suggest family activities and who to get together with based on
        your calendar.
      </Text>

      <TouchableOpacity style={styles.importBtn} onPress={() => nav.navigate('ContactImport')}>
        <Ionicons name="people-circle-outline" size={18} color={colors.primary} />
        <Text style={styles.importBtnText}>Import from Contacts</Text>
      </TouchableOpacity>

      <View style={styles.sectionHeader}>
        <Text style={styles.sectionTitle}>Family Members</Text>
        <TouchableOpacity onPress={() => nav.navigate('PersonForm', {})}>
          <Text style={styles.addBtn}>+ Add Member</Text>
        </TouchableOpacity>
      </View>

      {selfPerson ? (
        <PersonCard
          person={selfPerson}
          self
          onPress={() => nav.navigate('PersonForm', { id: selfPerson._id, isSelf: true })}
        />
      ) : null}
      {family.map((p) => (
        <PersonCard key={p._id} person={p} onPress={() => nav.navigate('PersonForm', { id: p._id })} />
      ))}
      {family.length === 0 && !selfPerson ? <Empty label="No family members yet." /> : null}

      <View style={[styles.sectionHeader, { marginTop: spacing.lg }]}>
        <Text style={styles.sectionTitle}>Friends</Text>
        <TouchableOpacity onPress={() => nav.navigate('PersonForm', {})}>
          <Text style={styles.addBtn}>+ Add Friend</Text>
        </TouchableOpacity>
      </View>
      {friends.map((p) => (
        <PersonCard key={p._id} person={p} onPress={() => nav.navigate('PersonForm', { id: p._id })} />
      ))}
      {friends.length === 0 ? <Empty label="No friends added yet." /> : null}

      <View style={[styles.sectionHeader, { marginTop: spacing.lg }]}>
        <Text style={styles.sectionTitle}>Service Providers</Text>
        <TouchableOpacity onPress={() => nav.navigate('PersonForm', { type: 'service' })}>
          <Text style={styles.addBtn}>+ Add Provider</Text>
        </TouchableOpacity>
      </View>
      {providers.map((p) => (
        <PersonCard key={p._id} person={p} onPress={() => nav.navigate('PersonForm', { id: p._id })} />
      ))}
      {providers.length === 0 ? <Empty label="No service providers added yet." /> : null}
    </ScrollView>
  );
}

function PersonCard({ person, self, onPress }: { person: Person; self?: boolean; onPress: () => void }) {
  // Service providers get MaterialCommunityIcons' "account-tie" (a person in a
  // suit); everyone else uses the matching Ionicons person glyph.
  const isService = !self && person.type === 'service';
  const icon = self ? 'person-circle' : 'person';
  return (
    <TouchableOpacity activeOpacity={0.7} onPress={onPress}>
      <Card style={[styles.personCard, self && styles.selfCard]}>
        <View style={styles.personHead}>
          {isService ? (
            <MaterialCommunityIcons name="account-tie" size={20} color={colors.primary} />
          ) : (
            <Ionicons name={icon as any} size={20} color={colors.primary} />
          )}
          <Text style={styles.personName}>{person.name}</Text>
          {self ? <Text style={styles.youChip}>You</Text> : person.accountId ? <Text style={styles.memberChip}>Member</Text> : null}
        </View>
        {person.relationship ? <Text style={styles.personMeta}>{person.relationship}</Text> : null}
        {person.address ? <Text style={styles.personMeta}>📍 {person.address}</Text> : null}
        {person.interests && person.interests.length > 0 ? (
          <View style={styles.tags}>
            {person.interests.map((i) => (
              <Chip key={i} label={i} />
            ))}
          </View>
        ) : null}
        {person.notes ? <Text style={styles.personNotes}>{person.notes}</Text> : null}
        {self && !person.interests?.length && !person.notes ? (
          <Text style={styles.personNotes}>Add your interests and notes so the assistant can suggest plans for you.</Text>
        ) : null}
      </Card>
    </TouchableOpacity>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <Card style={styles.empty}>
      <Text style={styles.emptyText}>{label}</Text>
    </Card>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  intro: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 18 },
  importBtn: {
    flexDirection: 'row', alignItems: 'center', gap: 6, alignSelf: 'flex-start',
    borderWidth: 1, borderColor: colors.primary, borderRadius: 8,
    paddingHorizontal: 12, paddingVertical: 6, marginBottom: spacing.lg,
  },
  importBtnText: { color: colors.primary, fontWeight: '600', fontSize: 13 },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: spacing.sm },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  addBtn: { fontSize: 14, fontWeight: '600', color: colors.primary },
  personCard: { marginBottom: spacing.sm },
  selfCard: { borderWidth: 1, borderColor: colors.primary, backgroundColor: colors.primary + '0D' },
  personHead: { flexDirection: 'row', alignItems: 'center' },
  personName: { fontSize: 16, fontWeight: '600', color: colors.text, marginLeft: spacing.sm },
  youChip: {
    marginLeft: spacing.sm, fontSize: 11, fontWeight: '700', color: '#fff',
    backgroundColor: colors.primary, paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden',
  },
  memberChip: {
    marginLeft: spacing.sm, fontSize: 11, fontWeight: '600', color: colors.primary,
    backgroundColor: colors.primary + '18', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 6, overflow: 'hidden',
  },
  personMeta: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  personNotes: { fontSize: 13, color: colors.textMuted, marginTop: 6, lineHeight: 18 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  empty: { alignItems: 'center', paddingVertical: spacing.xl },
  emptyText: { fontSize: 14, color: colors.textMuted },
});
