import React from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, RefreshControl } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../store/auth';
import { peopleApi, Person } from '../../api';
import { openRecord } from '../../lib/e2ee';
import * as replica from '../../lib/replica';
import { CALENDAR_COLORS } from '../../lib/calendar';
import { Card, CenteredLoader, EmptyState, Hint } from '../../components/ui';
import { colors, spacing } from '../../theme';
import type { CalendarStackParamList } from '../../navigation/CalendarNavigator';

type Nav = NativeStackNavigationProp<CalendarStackParamList>;

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

interface Upcoming {
  person: Person;
  month: number; // 0-based
  day: number;
  next: Date;
  daysUntil: number;
  turns: number | null;
}

// Everyone with a birthday on file, sorted by next occurrence from today.
function upcomingBirthdays(people: Person[]): Upcoming[] {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const out: Upcoming[] = [];
  for (const person of people) {
    const iso = person.birthday ? String(person.birthday).slice(0, 10) : '';
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
    if (!m) continue;
    const [, y, mo, d] = m.map(Number);
    let next = new Date(today.getFullYear(), mo - 1, d);
    if (next < today) next = new Date(today.getFullYear() + 1, mo - 1, d);
    const daysUntil = Math.round((next.getTime() - today.getTime()) / 86400000);
    // Some birthdays are stored without a real year; only show an age when the
    // year is plausible.
    const turns = y > 1900 && y <= today.getFullYear() ? next.getFullYear() - y : null;
    out.push({ person, month: mo - 1, day: d, next, daysUntil, turns });
  }
  return out.sort((a, b) => a.daysUntil - b.daysUntil || a.person.name.localeCompare(b.person.name));
}

function whenLabel(daysUntil: number): string {
  if (daysUntil === 0) return 'Today';
  if (daysUntil === 1) return 'Tomorrow';
  if (daysUntil < 30) return `in ${daysUntil} days`;
  return '';
}

// The Birthday calendar's drill-in from My Calendars: everyone's birthday from
// People, ordered by who's next. Rows open the person; birthdays themselves
// are edited there (or in Account for the self person).
export default function BirthdaysScreen() {
  const nav = useNavigation<Nav>();
  const { user } = useAuth();
  const selfId = String(user?._id ?? '');

  // Same offline-first fetch as PeopleScreen (shared query key, so the roster
  // cache is reused): sync the replica, decrypt content over plaintext.
  const { data: people, isLoading, refetch, isRefetching } = useQuery({
    queryKey: ['people'],
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

  if (isLoading || !people) {
    return <CenteredLoader color={CALENDAR_COLORS.birthdays} />;
  }

  const upcoming = upcomingBirthdays(people);

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={refetch} />}
    >
      <Hint>Birthdays come from your People. Add or edit a birthday on the person&apos;s card.</Hint>

      {upcoming.map(({ person, month, day, daysUntil, turns }) => {
        const isSelf = Boolean(person.accountId && String(person.accountId) === selfId);
        const when = whenLabel(daysUntil);
        return (
          <TouchableOpacity
            key={person._id}
            activeOpacity={0.7}
            onPress={() => nav.navigate('PersonForm', { id: person._id, isSelf: isSelf || undefined })}
          >
            <Card style={[styles.row, daysUntil === 0 && styles.todayRow]}>
              <View style={[styles.accent, { backgroundColor: CALENDAR_COLORS.birthdays }]} />
              <View style={styles.main}>
                <Text style={styles.name}>
                  {person.name}
                  {isSelf ? ' (you)' : ''}
                </Text>
                <Text style={styles.date}>
                  {MONTHS[month]} {day}
                  {turns != null ? ` · turns ${turns}` : ''}
                </Text>
              </View>
              {when ? <Text style={[styles.when, daysUntil === 0 && styles.whenToday]}>{when}</Text> : null}
              <Ionicons name="chevron-forward" size={16} color={colors.textMuted} />
            </Card>
          </TouchableOpacity>
        );
      })}

      {upcoming.length === 0 ? (
        <EmptyState
          variant="inline"
          mdiIcon="cake-variant"
          title="No birthdays yet"
          accent={CALENDAR_COLORS.birthdays}
        >
          <TouchableOpacity style={styles.emptyBtn} onPress={() => nav.navigate('People')}>
            <Ionicons name="people-outline" size={16} color={colors.primary} />
            <Text style={styles.emptyBtnText}>Add birthdays in People</Text>
          </TouchableOpacity>
        </EmptyState>
      ) : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  todayRow: { borderWidth: 1, borderColor: CALENDAR_COLORS.birthdays },
  accent: { width: 4, height: 36, borderRadius: 2 },
  main: { flex: 1 },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  date: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  when: { fontSize: 13, fontWeight: '600', color: colors.textMuted },
  whenToday: { color: CALENDAR_COLORS.birthdays },
  emptyBtn: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.md },
  emptyBtnText: { color: colors.primary, fontWeight: '600', fontSize: 14 },
});
