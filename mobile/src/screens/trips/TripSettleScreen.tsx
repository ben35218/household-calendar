import React, { useLayoutEffect } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { tripsApi } from '../../api';
import { Card, Divider } from '../../components/ui';
import { TRIP_PURPLE } from '../../lib/tripTypes';
import { TripsStackParamList } from '../../navigation/TripsNavigator';
import { colors, spacing } from '../../theme';

type Rt = RouteProp<TripsStackParamList, 'TripSettle'>;

function money(amount: number, cur?: string) {
  const c = cur || 'USD';
  try {
    return new Intl.NumberFormat(undefined, { style: 'currency', currency: c, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${c} ${Math.round(amount)}`;
  }
}

export default function TripSettleScreen() {
  const { id } = useRoute<Rt>().params;
  const navigation = useNavigation();

  const settleQ = useQuery({ queryKey: ['trips', id, 'settlement'], queryFn: async () => (await tripsApi.settlement(id)).data });

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Settle Up' });
  }, [navigation]);

  if (settleQ.isLoading || !settleQ.data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={TRIP_PURPLE} />
      </View>
    );
  }

  const { balances, payments, baseCurrency } = settleQ.data;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <Text style={styles.title}>Who owes whom</Text>
        <Divider />
        {balances.length === 0 ? (
          <View style={styles.allSettled}>
            <Ionicons name="checkmark-circle" size={20} color={colors.success} />
            <Text style={styles.settledText}>All settled up</Text>
          </View>
        ) : (
          balances.map((b, i) => (
            <View key={i} style={styles.balanceRow}>
              <Text style={styles.balanceText}>
                <Text style={styles.bold}>{b.fromName}</Text> owes <Text style={styles.bold}>{b.toName}</Text>
              </Text>
              <Text style={styles.amount}>{money(b.amount, baseCurrency)}</Text>
            </View>
          ))
        )}
        <Text style={styles.note}>Estimated, converted to {baseCurrency}.</Text>
      </Card>

      {payments && payments.length > 0 ? (
        <Card style={styles.card}>
          <Text style={styles.title}>Recorded payments</Text>
          <Divider />
          {payments.map((p) => (
            <View key={p._id} style={styles.balanceRow}>
              <Text style={styles.balanceText}>
                <Text style={styles.bold}>{p.fromName}</Text> paid <Text style={styles.bold}>{p.toName}</Text>
                {p.note ? ` · ${p.note}` : ''}
              </Text>
              <Text style={styles.amount}>{money(p.amount, p.currency || baseCurrency)}</Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Text style={styles.footer}>Recording new payments is available on the web app.</Text>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  content: { padding: spacing.md },
  card: { marginBottom: spacing.md },
  title: { fontSize: 16, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  balanceRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 8 },
  balanceText: { flex: 1, fontSize: 14, color: colors.text, marginRight: spacing.sm },
  bold: { fontWeight: '700' },
  amount: { fontSize: 14, fontWeight: '700', color: colors.text },
  allSettled: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  settledText: { fontSize: 14, color: colors.textMuted },
  note: { fontSize: 12, color: colors.textMuted, marginTop: spacing.sm },
  footer: { fontSize: 13, color: colors.textMuted, textAlign: 'center', marginTop: spacing.sm },
});
