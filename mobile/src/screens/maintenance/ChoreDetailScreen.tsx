import React, { useLayoutEffect } from 'react';
import { View, Text, StyleSheet, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { choresApi } from '../../api';
import { Button, Card, Screen, ListRow, CenteredLoader, IconAvatar, ScreenTitle, HeaderIconButton, InfoCard } from '../../components/ui';
import { recurrenceLabel, dueInLabel, mdiName } from '../../lib/recurrence';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { MaintenanceStackParamList } from '../../navigation/MaintenanceNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<MaintenanceStackParamList, 'ChoreDetail'>;
type Rt = RouteProp<MaintenanceStackParamList, 'ChoreDetail'>;

export default function ChoreDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { id } = useRoute<Rt>().params;
  const qc = useQueryClient();
  const accent = useCalendarColors().colors.chores;

  const choreQ = useQuery({
    queryKey: ['chores', id],
    queryFn: async () => (await choresApi.get(id)).data,
  });
  const chore = choreQ.data;

  const invalidate = () => qc.invalidateQueries({ queryKey: ['chores'] });

  const del = useMutation({
    mutationFn: () => choresApi.delete(id),
    onSuccess: () => {
      invalidate();
      navigation.goBack();
    },
  });

  const confirmDelete = () =>
    Alert.alert('Delete Chore', `Delete "${chore?.title}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => del.mutate() },
    ]);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <HeaderIconButton icon="pencil" accessibilityLabel="Edit chore" onPress={() => navigation.navigate('ChoreForm', { id })} />
      ),
    });
  }, [navigation, id, chore?.title]);

  if (choreQ.isLoading || !chore) {
    return <CenteredLoader color={accent} />;
  }

  const assignee =
    typeof chore.assignedTo === 'object' && chore.assignedTo ? chore.assignedTo.name : null;
  const instructions = chore.instructions || chore.description || '';

  return (
    <Screen>
      <View style={styles.titleRow}>
        <IconAvatar mdiIcon={mdiName(chore.icon)} size={48} radius={12} bg={accent} />
        <View style={{ flex: 1 }}>
          <ScreenTitle>{chore.title}</ScreenTitle>
        </View>
      </View>

      <InfoCard style={styles.infoCard}>
        <ListRow icon="person-outline" title={assignee || 'Unassigned'} />
        <ListRow icon="calendar-outline" title={dueInLabel(chore.nextDueDate)} />
        {chore.recurrence ? (
          <ListRow icon="repeat-outline" title={recurrenceLabel(chore.recurrence)} />
        ) : null}
      </InfoCard>

      {instructions ? (
        <Card style={styles.textCard}>
          <Text style={styles.overline}>Instructions</Text>
          <Text style={styles.body}>{instructions}</Text>
        </Card>
      ) : null}

      <View style={styles.deleteWrap}>
        <Button title="Delete chore" variant="danger" loading={del.isPending} onPress={confirmDelete} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.md },
  infoCard: { marginBottom: spacing.md },
  textCard: { marginBottom: spacing.md },
  deleteWrap: { marginTop: spacing.sm, marginBottom: spacing.xl },
  overline: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginBottom: 4 },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
});
