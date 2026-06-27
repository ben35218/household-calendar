import React, { useLayoutEffect, useMemo } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { calendarApi, CalendarEvent } from '../../api';
import { Card } from '../../components/ui';
import { itemsForDate, eventColor, CALENDAR_COLORS } from '../../lib/calendar';
import { zonedTimeLabel } from '../../lib/tz';
import { mdiName } from '../../lib/recurrence';
import { CalendarStackParamList } from '../../navigation/CalendarNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<CalendarStackParamList, 'CalendarDay'>;
type Rt = RouteProp<CalendarStackParamList, 'CalendarDay'>;

// Fetch a tight window around the date so the aggregate is cheap.
function windowFor(dateStr: string) {
  const d = new Date(dateStr + 'T12:00:00');
  const from = new Date(d);
  from.setDate(from.getDate() - 7);
  const to = new Date(d);
  to.setDate(to.getDate() + 7);
  return { from: from.toISOString(), to: to.toISOString() };
}

function Row({ icon, color, title, subtitle, onPress }: { icon: string; color: string; title: string; subtitle?: string; onPress?: () => void }) {
  const Wrapper: any = onPress ? TouchableOpacity : View;
  return (
    <Wrapper onPress={onPress} activeOpacity={0.7}>
      <Card style={[styles.row, { borderLeftColor: color, borderLeftWidth: 4 }]}>
        <MaterialCommunityIcons name={icon as any} size={20} color={color} />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{title}</Text>
          {subtitle ? <Text style={styles.rowSub}>{subtitle}</Text> : null}
        </View>
        {onPress ? <Ionicons name="chevron-forward" size={16} color={colors.textMuted} /> : null}
      </Card>
    </Wrapper>
  );
}

export default function CalendarDayScreen() {
  const navigation = useNavigation<Nav>();
  const { date } = useRoute<Rt>().params;

  const range = useMemo(() => windowFor(date), [date]);
  const calQ = useQuery({
    queryKey: ['calendar', range.from, range.to],
    queryFn: async () => (await calendarApi.get(range)).data,
  });

  const day = useMemo(() => itemsForDate(calQ.data, date), [calQ.data, date]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: new Date(date + 'T12:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }),
      headerRight: () => (
        <TouchableOpacity onPress={() => navigation.navigate('EventForm', { date })} style={{ paddingHorizontal: 4 }}>
          <Ionicons name="add" size={26} color="#fff" />
        </TouchableOpacity>
      ),
    });
  }, [navigation, date]);

  if (calQ.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const empty =
    !day.events.length && !day.tasks.length && !day.chores.length && !day.recipes.length && !day.trips.length && !day.birthdays.length && !day.grocery;

  const eventTime = (e: CalendarEvent) => (e.allDay ? 'All day' : zonedTimeLabel(e.startDate));

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      {empty ? <Text style={styles.empty}>Nothing scheduled.</Text> : null}

      {day.trips.map((t) => (
        <Row key={`trip-${t.id}`} icon="bag-suitcase" color={t.color} title={t.name} subtitle="Trip" />
      ))}
      {day.birthdays.map((b) => (
        <Row key={`bday-${b.id}`} icon="cake-variant" color={CALENDAR_COLORS.birthdays} title={b.name} subtitle="Birthday" />
      ))}
      {day.events.map((e) => (
        <Row
          key={e._id}
          icon="calendar"
          color={eventColor(e)}
          title={e.title}
          subtitle={[eventTime(e), e.location].filter(Boolean).join(' · ')}
          onPress={() => navigation.navigate('EventForm', { eventId: e._id, date })}
        />
      ))}
      {day.tasks.map((t) => (
        <Row key={t._id} icon="wrench" color={CALENDAR_COLORS.maintenance} title={t.title} subtitle="Maintenance task" />
      ))}
      {day.chores.map((c) => (
        <Row key={c._id} icon={mdiName(c.icon)} color={CALENDAR_COLORS.chores} title={c.title} subtitle="Chore" />
      ))}
      {day.recipes.map((r, i) => (
        <Row key={`recipe-${i}`} icon="silverware-fork-knife" color={CALENDAR_COLORS.recipes} title={r.title} subtitle="Meal" />
      ))}
      {day.grocery ? <Row icon="cart" color="#F9A825" title="Grocery shopping" subtitle="Shopping day" /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { padding: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  rowTitle: { fontSize: 16, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl },
});
