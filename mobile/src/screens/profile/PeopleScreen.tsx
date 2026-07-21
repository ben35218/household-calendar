import React, { useCallback, useLayoutEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActionSheetIOS, Platform, Alert, RefreshControl } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../../store/auth';
import { peopleApi, Person } from '../../api';
import { openRecord } from '../../lib/e2ee';
import { ensureSelfPerson } from '../../lib/selfPerson';
import * as replica from '../../lib/replica';
import { Card, Chip, RoundIconButton, CenteredLoader, EmptyState } from '../../components/ui';
import { colors, spacing } from '../../theme';
import type { ProfileStackParamList } from '../../navigation/ProfileNavigator';

type Nav = NativeStackNavigationProp<ProfileStackParamList>;

// Tabs map onto the plaintext Person.type used for roster grouping.
type TabKey = 'family' | 'friend' | 'service';
const TABS: { key: TabKey; label: string }[] = [
  { key: 'family', label: 'Family' },
  { key: 'friend', label: 'Friends' },
  { key: 'service', label: 'Professionals' },
];

// Contacts roster split across Family / Friends / Professionals tabs. The "You"
// card lives under Family; the header "+" adds into the active tab.
export default function PeopleScreen() {
  const nav = useNavigation<Nav>();
  const { user } = useAuth();
  const selfId = String(user?._id ?? '');
  const [tab, setTab] = useState<TabKey>('family');

  // Header "+" opens a menu: add a person manually (into the active tab) or
  // import from the device address book.
  const openAddMenu = useCallback(() => {
    const addManually = () => nav.navigate('PersonForm', { type: tab });
    const importContacts = () => nav.navigate('ContactImport');
    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options: ['Add', 'Import from Contacts', 'Cancel'], cancelButtonIndex: 2 },
        (i) => {
          if (i === 0) addManually();
          else if (i === 1) importContacts();
        }
      );
    } else {
      Alert.alert('Add contact', undefined, [
        { text: 'Add', onPress: addManually },
        { text: 'Import from Contacts', onPress: importContacts },
        { text: 'Cancel', style: 'cancel' },
      ]);
    }
  }, [nav, tab]);

  useLayoutEffect(() => {
    nav.setOptions({ headerRight: () => <RoundIconButton icon="add" onPress={openAddMenu} /> });
  }, [nav, openAddMenu]);

  const { data: people, isLoading, refetch, isRefetching } = useQuery({
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

  // Fallback seed of the encrypted "You" Person (the primary seed runs at app
  // boot — see hooks/useSelfPersonSeed). ensureSelfPerson guards on e2eeActive +
  // a held key and no-ops once a self-record exists, so this is just a belt-and-
  // suspenders retry for a session where boot seeding didn't land.
  React.useEffect(() => {
    if (!people || !user) return;
    ensureSelfPerson(user).then((created) => {
      if (created) qc.invalidateQueries({ queryKey: ['people'] });
    });
  }, [people, user, qc]);

  if (isLoading || !people) {
    return <CenteredLoader />;
  }

  const selfPerson = people.find((p) => p.accountId && String(p.accountId) === selfId);
  const roster = people.filter((p) => p.type === tab && p !== selfPerson);
  const showSelf = tab === 'family' && !!selfPerson;

  const emptyLabel = {
    family: 'No family members yet.',
    friend: 'No friends added yet.',
    service: 'No professionals added yet.',
  }[tab];

  return (
    <View style={styles.container}>
      <View style={styles.tabBar}>
        {TABS.map((t) => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, tab === t.key && styles.tabActive]}
            onPress={() => setTab(t.key)}
            activeOpacity={0.7}
          >
            <Text style={[styles.tabText, tab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
      >
        {showSelf ? (
          <PersonCard
            person={selfPerson!}
            self
            onPress={() => nav.navigate('Account')}
          />
        ) : null}
        {roster.map((p) => (
          <PersonCard key={p._id} person={p} onPress={() => nav.navigate('PersonDetail', { id: p._id })} />
        ))}
        {roster.length === 0 && !showSelf ? <Empty label={emptyLabel} /> : null}
      </ScrollView>
    </View>
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
        {isService && person.businessName ? <Text style={styles.personMeta}>🏢 {person.businessName}</Text> : null}
        {person.address ? <Text style={styles.personMeta}>📍 {person.address}</Text> : null}
        {!self && person.interests && person.interests.length > 0 ? (
          <View style={styles.tags}>
            {person.interests.map((i) => (
              <Chip key={i} label={i} />
            ))}
          </View>
        ) : null}
        {!self && person.notes ? <Text style={styles.personNotes}>{person.notes}</Text> : null}
      </Card>
    </TouchableOpacity>
  );
}

function Empty({ label }: { label: string }) {
  return <EmptyState variant="inline" message={label} />;
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  tabBar: {
    flexDirection: 'row', gap: spacing.sm,
    paddingHorizontal: spacing.md, paddingTop: spacing.sm, paddingBottom: spacing.xs,
    backgroundColor: colors.background,
  },
  tab: {
    flex: 1, alignItems: 'center', paddingVertical: 8, borderRadius: 8,
    backgroundColor: colors.surface,
  },
  tabActive: { backgroundColor: colors.primary },
  tabText: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  tabTextActive: { color: '#fff' },
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
});
