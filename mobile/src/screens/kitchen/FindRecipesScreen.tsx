import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator, Switch } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQuery } from '@tanstack/react-query';
import { inventoryApi, recipesApi } from '../../api';
import { Button, Card, Chip, Input } from '../../components/ui';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { colors, spacing } from '../../theme';
import type { KitchenStackParamList } from '../../navigation/KitchenNavigator';

type Suggestion = {
  title: string;
  description?: string;
  time?: string;
  usedIngredients?: string[];
  needsOther?: string[];
};
type IngredientMode = 'focus' | 'included' | 'strict';

// Always start from "What are you in the mood for?" free text. Optionally toggle
// on "Use my ingredients" to build AI suggestions around selected inventory items.
export default function FindRecipesScreen() {
  const nav = useNavigation<NativeStackNavigationProp<KitchenStackParamList>>();
  const accent = useCalendarColors().colors.recipes;
  const { data: items, isLoading } = useQuery({
    queryKey: ['inventory', 'active'],
    queryFn: async () => (await inventoryApi.list({ status: 'active' })).data,
  });

  const [useIngredients, setUseIngredients] = useState(false);
  const [queryText, setQueryText] = useState('');
  const [selected, setSelected] = useState<string[]>([]);
  const [ingredientMode, setIngredientMode] = useState<IngredientMode>('focus');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[] | null>(null);
  const [savingIdx, setSavingIdx] = useState<number | null>(null);
  const [savedIds, setSavedIds] = useState<Record<number, string>>({});

  const all = items ?? [];
  const toggle = (id: string) =>
    setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  const selectedNames = all.filter((i) => selected.includes(i._id)).map((i) => i.name);

  async function suggest() {
    setError('');
    setBusy(true);
    setSavedIds({});
    try {
      const params = useIngredients
        ? { query: queryText.trim(), itemNames: selectedNames, ingredientMode }
        : { query: queryText.trim() };
      const { data } = await inventoryApi.suggestRecipes(params);
      setSuggestions((data as { recipes: Suggestion[] }).recipes);
    } catch (e: any) {
      setError(e?.response?.data?.error || 'Failed to suggest recipes');
    } finally {
      setBusy(false);
    }
  }

  async function saveSuggestion(s: Suggestion, i: number) {
    setSavingIdx(i);
    try {
      const description = [
        `Recipe: ${s.title}.`,
        s.description,
        s.usedIngredients?.length ? `Main ingredients: ${s.usedIngredients.join(', ')}.` : '',
        s.needsOther?.length ? `Also needs: ${s.needsOther.join(', ')}.` : '',
        s.time ? `Estimated time: ${s.time}.` : '',
      ].filter(Boolean).join(' ');
      const { data } = await recipesApi.generateFromAi(description);
      if (data._id) setSavedIds((m) => ({ ...m, [i]: data._id as string }));
    } finally {
      setSavingIdx(null);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={accent} />
      </View>
    );
  }

  // ── Results: generate ──
  if (suggestions) {
    return (
      <ScrollView style={styles.container} contentContainerStyle={styles.content}>
        <ResultsHeader title="Recipe Suggestions" onBack={() => setSuggestions(null)} />
        {suggestions.map((r, i) => (
          <Card key={i} style={styles.card}>
            <Text style={styles.recipeTitle}>{r.title}</Text>
            {r.description ? <Text style={styles.recipeDesc}>{r.description}</Text> : null}
            {r.time ? <Text style={styles.time}>⏱ {r.time}</Text> : null}
            <View style={styles.tags}>
              {(r.usedIngredients ?? []).map((ing) => <Chip key={ing} label={ing} color={colors.success} />)}
              {(r.needsOther ?? []).map((ing) => <Chip key={ing} label={ing} color={colors.textMuted} />)}
            </View>
            {savedIds[i] ? (
              <Button title="View Recipe" variant="ghost" onPress={() => nav.navigate('RecipeDetail', { id: savedIds[i] })} />
            ) : (
              <Button title="Save to Library" variant="ghost" loading={savingIdx === i} onPress={() => saveSuggestion(r, i)} />
            )}
          </Card>
        ))}
      </ScrollView>
    );
  }

  // ── Selector ──
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <Text style={styles.title}>What are you in the mood for?</Text>
        <Input
          placeholder="e.g. quick vegetarian pasta dinner"
          value={queryText}
          onChangeText={setQueryText}
          multiline
        />
      </Card>

      <Card style={styles.card}>
        <View style={styles.rowBetween}>
          <View style={styles.toggleText}>
            <Text style={styles.title}>Use my ingredients</Text>
            <Text style={styles.radioDesc}>Build suggestions around items in your inventory</Text>
          </View>
          <Switch
            value={useIngredients}
            onValueChange={setUseIngredients}
            trackColor={{ true: accent }}
          />
        </View>
      </Card>

      {useIngredients && (
        <>
          <Card style={styles.card}>
            <View style={styles.rowBetween}>
              <Text style={styles.title}>Choose ingredients to build around</Text>
              <View style={styles.miniActions}>
                <TouchableOpacity onPress={() => setSelected(all.map((i) => i._id))}><Text style={[styles.link, { color: accent }]}>All</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => setSelected([])}><Text style={styles.linkMuted}>None</Text></TouchableOpacity>
              </View>
            </View>
            {all.length === 0 ? (
              <Text style={styles.empty}>No items in your inventory yet.</Text>
            ) : (
              <View style={styles.tags}>
                {all.map((item) => (
                  <Chip key={item._id} label={item.name} color={accent} selected={selected.includes(item._id)} onPress={() => toggle(item._id)} />
                ))}
              </View>
            )}
            <Text style={styles.hint}>{selected.length} of {all.length} selected</Text>
          </Card>

          <Card style={styles.card}>
            <Text style={styles.title}>Ingredient Constraint</Text>
            {([
              { v: 'focus', t: 'Selected items are the focus', d: 'Built around these; common staples also allowed' },
              { v: 'included', t: 'Included, not the focus', d: 'Must use these as supporting ingredients' },
              { v: 'strict', t: 'Strictly inventory only', d: 'Use nothing outside the selected list' },
            ] as const).map((o) => (
              <TouchableOpacity key={o.v} style={styles.radioRow} onPress={() => setIngredientMode(o.v)}>
                <Ionicons name={ingredientMode === o.v ? 'radio-button-on' : 'radio-button-off'} size={20} color={accent} />
                <View style={styles.radioText}>
                  <Text style={styles.radioTitle}>{o.t}</Text>
                  <Text style={styles.radioDesc}>{o.d}</Text>
                </View>
              </TouchableOpacity>
            ))}
          </Card>
        </>
      )}

      {error ? <Text style={styles.errorText}>{error}</Text> : null}

      <Button
        title="Generate"
        onPress={suggest}
        loading={busy}
        color={accent}
        disabled={useIngredients ? selected.length === 0 : !queryText.trim()}
      />
    </ScrollView>
  );
}

function ResultsHeader({ title, onBack }: { title: string; onBack: () => void }) {
  return (
    <View style={styles.resultsHeader}>
      <TouchableOpacity onPress={onBack}><Ionicons name="arrow-back" size={22} color={colors.text} /></TouchableOpacity>
      <Text style={styles.resultsTitle}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  card: { marginBottom: spacing.md },
  title: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  rowBetween: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' },
  toggleText: { flex: 1, paddingRight: spacing.sm },
  miniActions: { flexDirection: 'row', gap: spacing.sm },
  link: { fontWeight: '600' },
  linkMuted: { color: colors.textMuted, fontWeight: '600' },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: 6 },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: 4 },
  empty: { fontSize: 13, color: colors.textMuted, paddingVertical: spacing.md, textAlign: 'center' },
  radioRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, paddingVertical: 8 },
  radioText: { flex: 1 },
  radioTitle: { fontSize: 14, color: colors.text },
  radioDesc: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  errorText: { color: colors.error, marginBottom: spacing.sm },
  resultsHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, marginBottom: spacing.md },
  resultsTitle: { fontSize: 18, fontWeight: '700', color: colors.text },
  recipeTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 4 },
  recipeDesc: { fontSize: 13, color: colors.textMuted, marginBottom: 6, lineHeight: 18 },
  time: { fontSize: 12, color: colors.textMuted, marginBottom: 6 },
});
