import React, { useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  SectionList,
  ScrollView,
  TouchableOpacity,
  RefreshControl,
  Image,
  Animated,
  PanResponder,
  Modal,
  Pressable,
} from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { recipesApi, Recipe } from '../../api';
import { openRecord } from '../../lib/e2ee';
import * as replica from '../../lib/replica';
import { Card, Input, Badge, RoundIconButton } from '../../components/ui';
import { KitchenStackParamList } from '../../navigation/KitchenNavigator';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { colors, radius, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<KitchenStackParamList, 'Recipes'>;

// Recipes with no tags collect under this pseudo-category.
const UNTAGGED = 'Untagged';

function totalMins(r: Recipe) {
  return (r.prepTimeMins || 0) + (r.cookTimeMins || 0);
}

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={[styles.chip, active && styles.chipActive]}>
      <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    </TouchableOpacity>
  );
}

// Width of the red Delete action revealed when a row is swiped left.
const ACTION_WIDTH = 88;

// A list row that reveals a red Delete action when swiped left. Built on
// PanResponder/Animated (no gesture-handler dependency). Swiping past halfway
// snaps the action open; tapping it (or swiping fully) calls onDelete.
function SwipeableRow({ children, onDelete }: { children: React.ReactNode; onDelete: () => void }) {
  const translateX = useRef(new Animated.Value(0)).current;
  const openRef = useRef(false);

  const snap = (open: boolean) => {
    openRef.current = open;
    Animated.spring(translateX, {
      toValue: open ? -ACTION_WIDTH : 0,
      useNativeDriver: true,
      bounciness: 0,
    }).start();
  };

  const pan = useRef(
    PanResponder.create({
      // Only claim the gesture for a deliberate horizontal drag, so vertical
      // scrolling and taps still pass through to the list / row.
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dx) > 12 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
      onPanResponderMove: (_, g) => {
        const base = openRef.current ? -ACTION_WIDTH : 0;
        const x = Math.max(-ACTION_WIDTH, Math.min(0, base + g.dx));
        translateX.setValue(x);
      },
      onPanResponderRelease: (_, g) => {
        const base = openRef.current ? -ACTION_WIDTH : 0;
        snap(base + g.dx < -ACTION_WIDTH / 2);
      },
      onPanResponderTerminate: () => snap(openRef.current),
    })
  ).current;

  return (
    <View style={styles.swipeWrap}>
      <View style={styles.swipeAction}>
        <TouchableOpacity
          style={styles.swipeActionBtn}
          onPress={() => {
            snap(false);
            onDelete();
          }}
          activeOpacity={0.8}
        >
          <Ionicons name="trash-outline" size={22} color="#fff" />
          <Text style={styles.swipeActionText}>Delete</Text>
        </TouchableOpacity>
      </View>
      <Animated.View style={{ transform: [{ translateX }] }} {...pan.panHandlers}>
        {children}
      </Animated.View>
    </View>
  );
}

// The recipe library, a standalone screen reached from the Meals view's
// Recipes button (it used to be a segmented pane inside KitchenScreen).
export default function RecipesScreen() {
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const accent = useCalendarColors().colors.recipes;
  const [search, setSearch] = useState('');
  const [selectedTag, setSelectedTag] = useState<string | null>(null);
  // The recipe awaiting delete confirmation (drives the confirm modal).
  const [pendingDelete, setPendingDelete] = useState<Recipe | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => <RoundIconButton icon="add" onPress={() => navigation.navigate('RecipeForm', {})} bg={accent} />,
    });
  }, [navigation, accent]);

  const recipesQ = useQuery({
    queryKey: ['recipes'],
    // Offline-first (Phase 4b): sync the replica, fall back to cache offline,
    // then decrypt content over the plaintext rows.
    queryFn: async () => {
      const rows = await replica.syncedList<Recipe>('Recipe', async () => (await recipesApi.list()).data);
      return Promise.all(rows.map((r) => openRecord('Recipe', r)));
    },
  });

  const del = useMutation({
    mutationFn: (id: string) => recipesApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['recipes'] }),
  });

  const recipes = recipesQ.data ?? [];

  // Chip list is derived from the full recipe set (not the search results) so the
  // available categories stay stable while searching. Alphabetical, Untagged last.
  const tags = useMemo(() => {
    const set = new Set<string>();
    let hasUntagged = false;
    for (const r of recipes) {
      if (r.tags?.length) r.tags.forEach((t) => set.add(t));
      else hasUntagged = true;
    }
    const sorted = Array.from(set).sort((a, b) => a.localeCompare(b));
    if (hasUntagged) sorted.push(UNTAGGED);
    return sorted;
  }, [recipes]);

  // Sections are grouped by tag over the search-filtered recipes; a recipe with
  // multiple tags appears in each of its sections. A selected chip narrows to one.
  const sections = useMemo(() => {
    const q = search.trim().toLowerCase();
    const bySearch = recipes.filter((r) => {
      if (!q) return true;
      return r.title.toLowerCase().includes(q) || r.tags?.some((t) => t.toLowerCase().includes(q));
    });

    const map = new Map<string, Recipe[]>();
    for (const r of bySearch) {
      const rtags = r.tags?.length ? r.tags : [UNTAGGED];
      for (const t of rtags) {
        if (!map.has(t)) map.set(t, []);
        map.get(t)!.push(r);
      }
    }

    let entries = Array.from(map.entries()).sort((a, b) => {
      if (a[0] === UNTAGGED) return 1;
      if (b[0] === UNTAGGED) return -1;
      return a[0].localeCompare(b[0]);
    });
    if (selectedTag) entries = entries.filter(([t]) => t === selectedTag);
    return entries.map(([title, data]) => ({ title, data }));
  }, [recipes, search, selectedTag]);

  if (recipesQ.isLoading) {
    return <ActivityIndicator size="large" color={colors.primary} style={{ marginTop: spacing.xl }} />;
  }

  return (
    <View style={styles.pane}>
      <SectionList
        sections={sections}
        keyExtractor={(item, index) => `${item._id}-${index}`}
        contentContainerStyle={styles.content}
        stickySectionHeadersEnabled
        ListHeaderComponent={
          <View>
            <Input placeholder="Search recipes…" value={search} onChangeText={setSearch} />
            {tags.length > 0 ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips}>
                <Chip label="All" active={!selectedTag} onPress={() => setSelectedTag(null)} />
                {tags.map((t) => (
                  <Chip key={t} label={t} active={selectedTag === t} onPress={() => setSelectedTag((cur) => (cur === t ? null : t))} />
                ))}
              </ScrollView>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => <Text style={styles.sectionHeader}>{section.title}</Text>}
        refreshControl={<RefreshControl refreshing={recipesQ.isRefetching} onRefresh={recipesQ.refetch} />}
        ListEmptyComponent={<Text style={styles.empty}>No recipes yet. Tap + to add one.</Text>}
        renderItem={({ item }) => (
          <SwipeableRow onDelete={() => setPendingDelete(item)}>
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
              </Card>
            </TouchableOpacity>
          </SwipeableRow>
        )}
      />

      <Modal
        visible={!!pendingDelete}
        transparent
        animationType="fade"
        onRequestClose={() => setPendingDelete(null)}
      >
        <Pressable style={styles.dialogBackdrop} onPress={() => setPendingDelete(null)}>
          <Pressable style={styles.dialog} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.dialogTitle}>Delete recipe?</Text>
            <Text style={styles.dialogBody}>
              "{pendingDelete?.title}" will be permanently removed.
            </Text>
            <View style={styles.dialogActions}>
              <TouchableOpacity
                style={styles.dialogCancel}
                onPress={() => setPendingDelete(null)}
                activeOpacity={0.7}
              >
                <Text style={styles.dialogCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.dialogDelete}
                onPress={() => {
                  if (pendingDelete) del.mutate(pendingDelete._id);
                  setPendingDelete(null);
                }}
                activeOpacity={0.8}
              >
                <Text style={styles.dialogDeleteText}>Delete</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  pane: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md, paddingBottom: 96 },
  chips: { gap: spacing.xs, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
  chipActive: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 13, color: colors.text, fontWeight: '500' },
  chipTextActive: { color: '#fff' },
  sectionHeader: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', backgroundColor: colors.background, paddingVertical: 6 },
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.md },
  thumb: { width: 56, height: 56, borderRadius: 8 },
  thumbPlaceholder: { backgroundColor: colors.background, alignItems: 'center', justifyContent: 'center' },
  title: { fontSize: 16, fontWeight: '600', color: colors.text },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4, flexWrap: 'wrap' },
  meta: { fontSize: 13, color: colors.textMuted },
  empty: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl },

  // Swipe-to-delete. The red action sits behind the card and is uncovered as
  // the card slides left; the card keeps its own marginBottom for row spacing.
  swipeWrap: { position: 'relative' },
  swipeAction: {
    position: 'absolute',
    top: 0,
    bottom: spacing.sm,
    right: 0,
    width: ACTION_WIDTH,
    backgroundColor: colors.error,
    borderRadius: radius.lg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  swipeActionBtn: { flex: 1, alignSelf: 'stretch', alignItems: 'center', justifyContent: 'center' },
  swipeActionText: { color: '#fff', fontSize: 12, fontWeight: '600', marginTop: 2 },

  // Centered "Delete recipe?" confirmation dialog.
  dialogBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  dialog: {
    width: '100%',
    maxWidth: 340,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },
  dialogTitle: { fontSize: 18, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  dialogBody: { fontSize: 15, color: colors.textMuted, lineHeight: 21, marginBottom: spacing.lg },
  dialogActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
  dialogCancel: {
    paddingVertical: 10,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
  },
  dialogCancelText: { fontSize: 15, fontWeight: '600', color: colors.text },
  dialogDelete: {
    paddingVertical: 10,
    paddingHorizontal: spacing.lg,
    borderRadius: radius.md,
    backgroundColor: colors.error,
  },
  dialogDeleteText: { fontSize: 15, fontWeight: '700', color: '#fff' },
});
