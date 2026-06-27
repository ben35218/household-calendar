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
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { itemsApi, Item } from '../../api';
import { Card } from '../../components/ui';
import { mdiName } from '../../lib/recurrence';
import { itemTypeConfig } from '../../lib/itemTypes';
import { takePhoto, pickImage } from '../../lib/media';
import { uploadFile } from '../../lib/upload';
import { MaintenanceStackParamList } from '../../navigation/MaintenanceNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<MaintenanceStackParamList, 'ItemsList'>;

export default function ItemsListScreen() {
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const [scanning, setScanning] = useState(false);

  const itemsQ = useQuery({ queryKey: ['items', 'list'], queryFn: async () => (await itemsApi.list()).data });

  const groups = useMemo(() => {
    const g: Record<string, Item[]> = {};
    for (const it of itemsQ.data ?? []) {
      const loc = it.location || 'Unsorted';
      (g[loc] ||= []).push(it);
    }
    return Object.entries(g).sort((a, b) => a[0].localeCompare(b[0]));
  }, [itemsQ.data]);

  const scan = async (mode: 'camera' | 'library') => {
    const file = mode === 'camera' ? await takePhoto() : await pickImage();
    if (!file) return;
    setScanning(true);
    try {
      const data = await uploadFile<Item & { _id?: string }>('/items/from-photo', file, 'photo');
      qc.invalidateQueries({ queryKey: ['items'] });
      // The endpoint returns extracted fields (no id yet); hand them to the form
      // pre-filled so the user can review + save (mirrors the web flow).
      navigation.navigate('ItemForm', { prefill: data });
    } catch (e: any) {
      Alert.alert('Scan failed', e.response?.data?.error || 'Could not extract details from that photo.');
    } finally {
      setScanning(false);
    }
  };

  const onAddPhoto = () =>
    Alert.alert('Add from Photo', 'Take a photo of a label or nameplate — AI fills in the details.', [
      { text: 'Take Photo', onPress: () => scan('camera') },
      { text: 'Choose from Library', onPress: () => scan('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);

  if (itemsQ.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={itemsQ.isRefetching} onRefresh={itemsQ.refetch} />}
      >
        <TouchableOpacity style={styles.scanBtn} onPress={onAddPhoto} disabled={scanning} activeOpacity={0.8}>
          {scanning ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <>
              <Ionicons name="camera-outline" size={20} color={colors.primary} />
              <Text style={styles.scanText}>Add from Photo</Text>
            </>
          )}
        </TouchableOpacity>

        {groups.length === 0 ? (
          <Text style={styles.empty}>No items yet. Add your appliances, vehicles, and systems.</Text>
        ) : (
          groups.map(([loc, items]) => (
            <View key={loc} style={styles.group}>
              <Text style={styles.groupTitle}>{loc}</Text>
              {items.map((it) => {
                const cfg = itemTypeConfig(it.type);
                return (
                  <TouchableOpacity
                    key={it._id}
                    activeOpacity={0.7}
                    onPress={() => navigation.navigate('ItemDetail', { id: it._id })}
                  >
                    <Card style={styles.row}>
                      <View style={[styles.avatar, { backgroundColor: cfg.color }]}>
                        <MaterialCommunityIcons name={mdiName(cfg.icon) as any} size={20} color="#fff" />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={styles.name}>{it.name}</Text>
                        <Text style={styles.sub}>
                          {[cfg.label, it.manufacturer, it.modelNumber].filter(Boolean).join(' · ')}
                        </Text>
                      </View>
                      <Ionicons name="chevron-forward" size={18} color={colors.textMuted} />
                    </Card>
                  </TouchableOpacity>
                );
              })}
            </View>
          ))
        )}
      </ScrollView>

      <TouchableOpacity
        style={styles.fab}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('ItemForm', {})}
      >
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: 96 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  scanBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.primary,
    borderRadius: 12,
    paddingVertical: 12,
    marginBottom: spacing.md,
  },
  scanText: { color: colors.primary, fontWeight: '600', fontSize: 15 },
  group: { marginBottom: spacing.lg },
  groupTitle: { fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginBottom: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.md },
  avatar: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  name: { fontSize: 16, fontWeight: '600', color: colors.text },
  sub: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
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
