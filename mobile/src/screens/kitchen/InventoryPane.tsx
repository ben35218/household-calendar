import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Alert,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { inventoryApi, InventoryItem } from '../../api';
import { Card, SegmentedControl, Input, Badge } from '../../components/ui';
import { daysUntilExpiry, expiryColor, expiryLabel } from './constants';
import { KitchenStackParamList } from '../../navigation/KitchenNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<KitchenStackParamList, 'KitchenHome'>;
type Tab = 'active' | 'history';

const ACTIVE_GROUPS = [
  { key: 'soon', label: 'Expiring Soon' },
  { key: 'week', label: 'This Week' },
  { key: 'fine', label: 'Fine' },
  { key: 'none', label: 'No Expiry Set' },
];

export default function InventoryPane() {
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('active');
  const [search, setSearch] = useState('');

  const activeQ = useQuery({
    queryKey: ['inventory', 'active'],
    queryFn: async () => (await inventoryApi.list({ status: 'active' })).data,
  });
  const historyQ = useQuery({
    queryKey: ['inventory', 'history'],
    queryFn: async () => {
      const [used, thrown] = await Promise.all([
        inventoryApi.list({ status: 'used' }),
        inventoryApi.list({ status: 'thrown_out' }),
      ]);
      return [...used.data, ...thrown.data].sort(
        (a, b) => new Date(b.statusDate || 0).getTime() - new Date(a.statusDate || 0).getTime()
      );
    },
  });

  const consume = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'used' | 'thrown_out' }) =>
      inventoryApi.consume(id, { action }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory'] }),
  });
  const del = useMutation({
    mutationFn: (id: string) => inventoryApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory'] }),
  });

  const filterBySearch = (list: InventoryItem[]) =>
    search ? list.filter((i) => i.name.toLowerCase().includes(search.toLowerCase())) : list;

  const activeGroups = useMemo(() => {
    const list = filterBySearch(activeQ.data ?? []);
    return ACTIVE_GROUPS.map((g) => ({
      ...g,
      items: list.filter((it) => {
        const d = daysUntilExpiry(it.expirationDate);
        if (g.key === 'none') return d === null;
        if (g.key === 'fine') return d !== null && d > 7;
        if (g.key === 'week') return d !== null && d > 2 && d <= 7;
        if (g.key === 'soon') return d !== null && d <= 2;
        return false;
      }),
    })).filter((g) => g.items.length > 0);
  }, [activeQ.data, search]);

  const rowActions = (item: InventoryItem) =>
    Alert.alert(item.name, undefined, [
      { text: 'Mark Used', onPress: () => consume.mutate({ id: item._id, action: 'used' }) },
      { text: 'Throw Out', onPress: () => consume.mutate({ id: item._id, action: 'thrown_out' }) },
      { text: 'Edit', onPress: () => navigation.navigate('InventoryItemForm', { id: item._id }) },
      { text: 'Delete', style: 'destructive', onPress: () => del.mutate(item._id) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  const loading = tab === 'active' ? activeQ.isLoading : historyQ.isLoading;

  return (
    <View style={styles.pane}>
      <View style={styles.toolbar}>
        <View style={styles.toolbarRow}>
          <View style={{ flex: 1 }}>
            <SegmentedControl<Tab>
              value={tab}
              onChange={setTab}
              options={[
                { label: 'Active', value: 'active' },
                { label: 'History', value: 'history' },
              ]}
            />
          </View>
          <TouchableOpacity style={styles.scanBtn} onPress={() => navigation.navigate('ReceiptScan')}>
            <Ionicons name="scan-outline" size={20} color={colors.primary} />
          </TouchableOpacity>
        </View>
        <View style={{ height: spacing.sm }} />
        <Input placeholder="Search…" value={search} onChangeText={setSearch} />
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: spacing.xl }} />
      ) : (
        <ScrollView
          contentContainerStyle={styles.content}
          refreshControl={
            <RefreshControl
              refreshing={tab === 'active' ? activeQ.isRefetching : historyQ.isRefetching}
              onRefresh={tab === 'active' ? activeQ.refetch : historyQ.refetch}
            />
          }
        >
          {tab === 'active' ? (
            activeGroups.length === 0 ? (
              <Text style={styles.empty}>No items. Tap + to add or scan a receipt.</Text>
            ) : (
              activeGroups.map((g) => (
                <View key={g.key} style={styles.group}>
                  <Text style={styles.groupTitle}>{g.label}</Text>
                  {g.items.map((it) => {
                    const d = daysUntilExpiry(it.expirationDate);
                    return (
                      <TouchableOpacity key={it._id} activeOpacity={0.7} onLongPress={() => rowActions(it)}>
                        <Card style={styles.row}>
                          <View style={{ flex: 1 }}>
                            <Text style={styles.name}>{it.name}</Text>
                            <Text style={styles.sub}>{[it.quantity, it.category].filter(Boolean).join(' · ')}</Text>
                          </View>
                          <Badge label={expiryLabel(d)} color={expiryColor(d)} />
                          <TouchableOpacity onPress={() => rowActions(it)} style={styles.menuBtn}>
                            <Ionicons name="ellipsis-horizontal" size={20} color={colors.textMuted} />
                          </TouchableOpacity>
                        </Card>
                      </TouchableOpacity>
                    );
                  })}
                </View>
              ))
            )
          ) : filterBySearch(historyQ.data ?? []).length === 0 ? (
            <Text style={styles.empty}>No history yet.</Text>
          ) : (
            filterBySearch(historyQ.data ?? []).map((it) => (
              <Card key={it._id} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{it.name}</Text>
                  <Text style={styles.sub}>{it.statusDate ? new Date(it.statusDate).toLocaleDateString() : ''}</Text>
                </View>
                <Badge label={it.status === 'used' ? 'Used' : 'Thrown out'} color={it.status === 'used' ? colors.success : colors.error} />
              </Card>
            ))
          )}
        </ScrollView>
      )}

      <TouchableOpacity style={styles.fab} activeOpacity={0.85} onPress={() => navigation.navigate('InventoryItemForm', {})}>
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { flex: 1 },
  toolbar: { padding: spacing.md, paddingBottom: 0 },
  toolbarRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  scanBtn: { width: 40, height: 40, borderRadius: 10, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  content: { padding: spacing.md, paddingBottom: 96 },
  group: { marginBottom: spacing.lg },
  groupTitle: { fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.sm },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  sub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  menuBtn: { padding: 4 },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: colors.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
});
