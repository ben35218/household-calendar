import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  FlatList,
  TouchableOpacity,
  RefreshControl,
  Image,
  Alert,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { recipesApi, Recipe } from '../../api';
import { Card, Input, Badge } from '../../components/ui';
import { KitchenStackParamList } from '../../navigation/KitchenNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<KitchenStackParamList, 'KitchenHome'>;

function totalMins(r: Recipe) {
  return (r.prepTimeMins || 0) + (r.cookTimeMins || 0);
}

export default function RecipesPane() {
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const [search, setSearch] = useState('');

  const recipesQ = useQuery({ queryKey: ['recipes'], queryFn: async () => (await recipesApi.list()).data });

  const del = useMutation({
    mutationFn: (id: string) => recipesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recipes'] }),
  });

  const filtered = (recipesQ.data ?? []).filter((r) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return r.title.toLowerCase().includes(q) || r.tags?.some((t) => t.toLowerCase().includes(q));
  });

  const confirmDelete = (r: Recipe) =>
    Alert.alert('Delete recipe?', `"${r.title}" will be permanently removed.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => del.mutate(r._id) },
    ]);

  if (recipesQ.isLoading) {
    return <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: spacing.xl }} />;
  }

  return (
    <View style={styles.pane}>
      <FlatList
        data={filtered}
        keyExtractor={(r) => r._id}
        contentContainerStyle={styles.content}
        ListHeaderComponent={<Input placeholder="Search recipes…" value={search} onChangeText={setSearch} />}
        refreshControl={<RefreshControl refreshing={recipesQ.isRefetching} onRefresh={recipesQ.refetch} />}
        ListEmptyComponent={<Text style={styles.empty}>No recipes yet. Tap + to add one.</Text>}
        renderItem={({ item }) => (
          <TouchableOpacity activeOpacity={0.8} onPress={() => navigation.navigate('RecipeDetail', { id: item._id })}>
            <Card style={styles.row}>
              {item.imageUrl ? (
                <Image source={{ uri: item.imageUrl }} style={styles.thumb} />
              ) : (
                <View style={[styles.thumb, styles.thumbPlaceholder]}>
                  <MaterialCommunityIcons name="silverware-fork-knife" size={24} color={colors.textMuted} />
                </View>
              )}
              <View style={{ flex: 1 }}>
                <Text style={styles.title} numberOfLines={1}>{item.title}</Text>
                <View style={styles.metaRow}>
                  {totalMins(item) ? <Text style={styles.meta}>{totalMins(item)} min</Text> : null}
                  {item.servings ? <Text style={styles.meta}>· {item.servings} servings</Text> : null}
                  {item.source && item.source !== 'manual' ? <Badge label={item.source.toUpperCase()} color={colors.primary} /> : null}
                </View>
              </View>
              <TouchableOpacity onPress={() => confirmDelete(item)} style={styles.delBtn}>
                <Ionicons name="trash-outline" size={20} color={colors.error} />
              </TouchableOpacity>
            </Card>
          </TouchableOpacity>
        )}
      />

      <TouchableOpacity style={styles.fab} activeOpacity={0.85} onPress={() => navigation.navigate('RecipeForm', {})}>
        <Ionicons name="add" size={28} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { flex: 1 },
  content: { padding: spacing.md, paddingBottom: 96 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.md },
  thumb: { width: 56, height: 56, borderRadius: 8 },
  thumbPlaceholder: { backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  meta: { fontSize: 13, color: colors.textMuted },
  delBtn: { padding: 4 },
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
