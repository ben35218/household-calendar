import React, { useLayoutEffect } from 'react';
import { View, Text, StyleSheet, Linking, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { peopleApi, Person } from '../../api';
import { openRecord } from '../../lib/e2ee';
import { Card, Screen, ListRow, EmptyState, HeaderIconButton, InfoCard } from '../../components/ui';
import { formatCalendarDate } from '../../lib/recurrence';
import { colors, spacing } from '../../theme';
import type { ProfileStackParamList } from '../../navigation/ProfileNavigator';

type Nav = NativeStackNavigationProp<ProfileStackParamList, 'PersonDetail'>;
type Rt = RouteProp<ProfileStackParamList, 'PersonDetail'>;

const TYPE_LABEL: Record<string, string> = { family: 'Family', friend: 'Friend', service: 'Professional' };

// A round icon + label used for the Call / Text / Email quick actions.
function ActionButton({ icon, label, onPress }: { icon: keyof typeof Ionicons.glyphMap; label: string; onPress: () => void }) {
  return (
    <TouchableOpacity style={styles.action} activeOpacity={0.8} onPress={onPress} accessibilityLabel={label}>
      <View style={styles.actionCircle}>
        <Ionicons name={icon} size={22} color={colors.primary} />
      </View>
      <Text style={styles.actionLabel}>{label}</Text>
    </TouchableOpacity>
  );
}

export default function PersonDetailScreen() {
  const nav = useNavigation<Nav>();
  const { id } = useRoute<Rt>().params;

  // Read the decrypted roster (shared ['people'] cache); fetch if not present so
  // the screen works from any entry point (People list or an item's service pro).
  const { data: people } = useQuery({
    queryKey: ['people'],
    queryFn: async () => {
      const rows = (await peopleApi.list()).data;
      return Promise.all(rows.map((p) => openRecord('Person', p))) as Promise<Person[]>;
    },
  });
  const person = people?.find((p) => p._id === id);

  useLayoutEffect(() => {
    nav.setOptions({
      title: 'Contact',
      headerRight: () => (
        <HeaderIconButton icon="pencil" accessibilityLabel="Edit contact" onPress={() => nav.navigate('PersonForm', { id })} />
      ),
    });
  }, [nav, id]);

  if (!person) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  const phone = person.phone?.trim();
  const email = person.email?.trim();
  const address = person.address?.trim();
  const subtitle = [TYPE_LABEL[person.type] || person.type, person.relationship].filter(Boolean).join(' · ');

  const call = () => phone && Linking.openURL(`tel:${phone}`);
  const text = () => phone && Linking.openURL(`sms:${phone}`);
  const mail = () => email && Linking.openURL(`mailto:${email}`);
  const map = () => address && Linking.openURL(`https://maps.apple.com/?q=${encodeURIComponent(address)}`);

  // A contact with nothing but a name/type is an empty shell — rather than show a
  // blank card, nudge the user to flesh it out.
  const hasDetails =
    !!(phone || email || address || person.birthday || person.businessName) ||
    !!person.interests?.length ||
    !!person.notes;

  return (
    <Screen>
      <Text style={styles.name}>{person.name}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}

      {!hasDetails ? (
        <EmptyState
          variant="inline"
          icon="person-add-outline"
          title="Add contact details"
          message="This contact only has a name. Add a phone number, email, birthday, and more."
          actionLabel="Add details"
          onAction={() => nav.navigate('PersonForm', { id })}
        />
      ) : null}

      {phone || email ? (
        <View style={styles.actions}>
          {phone ? <ActionButton icon="call" label="Call" onPress={call} /> : null}
          {phone ? <ActionButton icon="chatbubble" label="Text" onPress={text} /> : null}
          {email ? <ActionButton icon="mail" label="Email" onPress={mail} /> : null}
        </View>
      ) : null}

      {phone || email || address || person.birthday || person.businessName ? (
        <Card style={styles.infoCard}>
          {person.businessName ? <ListRow icon="business-outline" title="Business" subtitle={person.businessName} /> : null}
          {phone ? <ListRow icon="call-outline" title="Phone" subtitle={phone} onPress={call} /> : null}
          {email ? <ListRow icon="mail-outline" title="Email" subtitle={email} onPress={mail} /> : null}
          {address ? <ListRow icon="location-outline" title="Address" subtitle={address} onPress={map} /> : null}
          {person.birthday ? (
            <ListRow icon="gift-outline" title="Birthday" subtitle={formatCalendarDate(String(person.birthday).slice(0, 10))} />
          ) : null}
        </Card>
      ) : null}

      {person.interests?.length ? (
        <Card style={styles.textCard}>
          <Text style={styles.overline}>Interests</Text>
          <Text style={styles.body}>{person.interests.join(' · ')}</Text>
        </Card>
      ) : null}

      {person.notes ? (
        <Card style={styles.textCard}>
          <Text style={styles.overline}>Notes</Text>
          <Text style={styles.body}>{person.notes}</Text>
        </Card>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  name: { fontSize: 24, fontWeight: '700', color: colors.text },
  subtitle: { fontSize: 15, color: colors.textMuted, marginTop: 2, marginBottom: spacing.md },
  actions: { flexDirection: 'row', gap: spacing.lg, marginBottom: spacing.md },
  action: { alignItems: 'center', gap: 6 },
  actionCircle: {
    width: 52, height: 52, borderRadius: 26,
    borderWidth: 1.5, borderColor: colors.primary,
    alignItems: 'center', justifyContent: 'center',
  },
  actionLabel: { fontSize: 13, fontWeight: '600', color: colors.primary },
  infoCard: { padding: 0, paddingVertical: spacing.xs, marginBottom: spacing.md },
  textCard: { marginBottom: spacing.md },
  overline: { fontSize: 12, fontWeight: '700', color: colors.textMuted, letterSpacing: 0.5, marginBottom: spacing.xs },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
});
