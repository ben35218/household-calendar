import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Modal,
  Pressable,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { inventoryApi, InventoryItem } from '../../api';
import { openRecord } from '../../lib/e2ee';
import * as replica from '../../lib/replica';
import { Card, SegmentedControl, Input, Badge } from '../../components/ui';
import { daysUntilExpiry, expiryColor, expiryLabel } from './constants';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { useAiEnabled } from '../../lib/privacyPrefs';
import { KitchenStackParamList } from '../../navigation/KitchenNavigator';
import { colors, radius, spacing } from '../../theme';

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
  const aiEnabled = useAiEnabled();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>('active');
  const [search, setSearch] = useState('');
  // The item whose action sheet is open (three-dot / long-press menu).
  const [menuItem, setMenuItem] = useState<InventoryItem | null>(null);
  // "Mark Used" is tinted with the Meals calendar colour (user-overridable).
  const mealsColor = useCalendarColors().colors.recipes;

  const activeQ = useQuery({
    queryKey: ['inventory', 'active'],
    // Offline-first (Phase 4b): sync the replica, fall back to cache offline,
    // then decrypt content over the plaintext rows.
    queryFn: async () => {
      const rows = await replica.syncedList<InventoryItem>('FoodInventory', async () => (await inventoryApi.list({ status: 'active' })).data);
      return Promise.all(rows.map((r) => openRecord('FoodInventory', r)));
    },
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

  const rowActions = (item: InventoryItem) => setMenuItem(item);

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
          {aiEnabled && (
            <TouchableOpacity style={styles.scanBtn} onPress={() => navigation.navigate('ReceiptScan')}>
              <Ionicons name="scan-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
          )}
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

      <Modal
        visible={!!menuItem}
        transparent
        animationType="fade"
        onRequestClose={() => setMenuItem(null)}
      >
        <Pressable style={styles.sheetBackdrop} onPress={() => setMenuItem(null)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.sheetTitle} numberOfLines={2}>{menuItem?.name}</Text>
            <TouchableOpacity
              style={[styles.sheetPrimary, { backgroundColor: mealsColor }]}
              activeOpacity={0.8}
              onPress={() => {
                if (menuItem) consume.mutate({ id: menuItem._id, action: 'used' });
                setMenuItem(null);
              }}
            >
              <Text style={styles.sheetPrimaryText}>Mark Used</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetRow}
              activeOpacity={0.7}
              onPress={() => {
                if (menuItem) consume.mutate({ id: menuItem._id, action: 'thrown_out' });
                setMenuItem(null);
              }}
            >
              <Text style={styles.sheetRowText}>Throw Out</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetRow}
              activeOpacity={0.7}
              onPress={() => {
                const id = menuItem?._id;
                setMenuItem(null);
                if (id) navigation.navigate('InventoryItemForm', { id });
              }}
            >
              <Text style={styles.sheetRowText}>Edit</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.sheetRow}
              activeOpacity={0.7}
              onPress={() => {
                if (menuItem) del.mutate(menuItem._id);
                setMenuItem(null);
              }}
            >
              <Text style={styles.sheetRowText}>Delete</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.sheetCancel} activeOpacity={0.7} onPress={() => setMenuItem(null)}>
              <Text style={styles.sheetCancelText}>Cancel</Text>
            </TouchableOpacity>
          </Pressable>
        </Pressable>
      </Modal>
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

  // Bottom action sheet opened from the three-dot / long-press menu.
  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.md,
    paddingBottom: spacing.xl,
  },
  sheetTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.text,
    textAlign: 'center',
    paddingVertical: spacing.sm,
    marginBottom: spacing.sm,
  },
  // The primary, most-frequent action — solid fill (tinted with the Meals
  // calendar colour, set inline) to draw attention.
  sheetPrimary: {
    paddingVertical: 14,
    borderRadius: radius.md,
    alignItems: 'center',
    marginBottom: spacing.sm,
  },
  sheetPrimaryText: { fontSize: 16, fontWeight: '700', color: '#fff' },
  sheetRow: {
    paddingVertical: 14,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  sheetRowText: { fontSize: 16, color: colors.text, fontWeight: '500' },
  sheetCancel: { marginTop: spacing.sm, paddingVertical: 14, alignItems: 'center' },
  sheetCancelText: { fontSize: 16, fontWeight: '600', color: colors.textMuted },
});
