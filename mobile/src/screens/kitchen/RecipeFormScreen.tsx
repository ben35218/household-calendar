import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { recipesApi, Recipe, Ingredient } from '../../api';
import { Button, Input, Screen, SectionTitle, Card } from '../../components/ui';
import StepIngredientLinker from '../../components/StepIngredientLinker';
import { takePhoto, pickImage } from '../../lib/media';
import { uploadFile } from '../../lib/upload';
import { KitchenStackParamList } from '../../navigation/KitchenNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<KitchenStackParamList, 'RecipeForm'>;
type Rt = RouteProp<KitchenStackParamList, 'RecipeForm'>;

interface FormState {
  title: string;
  description: string;
  sourceUrl: string;
  imageUrl: string;
  servings: string;
  prepTimeMins: string;
  cookTimeMins: string;
  tags: string;
  ingredients: Ingredient[];
  instructions: string[];
  // Per-ingredient stable client IDs (aligned to ingredients[]) + per-step links.
  lids: string[];
  linkedIds: string[][];
}

const EMPTY: FormState = {
  title: '',
  description: '',
  sourceUrl: '',
  imageUrl: '',
  servings: '',
  prepTimeMins: '',
  cookTimeMins: '',
  tags: '',
  ingredients: [],
  instructions: [],
  lids: [],
  linkedIds: [],
};

export default function RecipeFormScreen() {
  const navigation = useNavigation<Nav>();
  const { id } = useRoute<Rt>().params || {};
  const isEdit = !!id;
  const qc = useQueryClient();

  const [form, setForm] = useState<FormState>(EMPTY);
  const [urlInput, setUrlInput] = useState('');
  const [aiInput, setAiInput] = useState('');
  const [importer, setImporter] = useState<'url' | 'ai' | null>(null);
  const [error, setError] = useState('');

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const lidCounter = useRef(0);
  const makeLid = () => `_l${++lidCounter.current}`;

  // _lid -> [1-based step numbers it appears in] (recipe-wide).
  const assignmentsById = useMemo(() => {
    const map: Record<string, number[]> = {};
    form.lids.forEach((lid) => { map[lid] = []; });
    form.linkedIds.forEach((lids, stepIdx) => {
      lids.forEach((lid) => { if (map[lid]) map[lid].push(stepIdx + 1); });
    });
    return map;
  }, [form.lids, form.linkedIds]);

  const lidIngredients = form.ingredients.map((ing, i) => ({ ...ing, _lid: form.lids[i] }));

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit Recipe' : 'Add Recipe' });
  }, [navigation, isEdit]);

  const recipeQ = useQuery({
    queryKey: ['recipes', id],
    queryFn: async () => (await recipesApi.get(id!)).data,
    enabled: isEdit,
  });

  const populate = (data: Partial<Recipe>) =>
    setForm((f) => {
      const ingredients = data.ingredients ?? f.ingredients;
      const instructions = data.instructions ?? f.instructions;
      // Regenerate stable lids whenever the ingredient list is replaced.
      const lids = data.ingredients ? data.ingredients.map(() => makeLid()) : f.lids;
      // Build per-step linkedIds from incoming instructionIngredients (indices).
      let linkedIds = f.linkedIds;
      if (data.instructions) {
        const incoming = data.instructionIngredients;
        linkedIds = incoming
          ? instructions.map((_, si) => (incoming[si] || []).map((idx) => lids[idx]).filter(Boolean))
          : instructions.map(() => []);
      }
      return {
        ...f,
        title: data.title ?? f.title,
        description: data.description ?? f.description,
        imageUrl: data.imageUrl ?? f.imageUrl,
        sourceUrl: data.sourceUrl ?? f.sourceUrl,
        servings: data.servings != null ? String(data.servings) : f.servings,
        prepTimeMins: data.prepTimeMins != null ? String(data.prepTimeMins) : f.prepTimeMins,
        cookTimeMins: data.cookTimeMins != null ? String(data.cookTimeMins) : f.cookTimeMins,
        tags: data.tags ? data.tags.join(', ') : f.tags,
        ingredients,
        instructions,
        lids,
        linkedIds,
      };
    });

  useEffect(() => {
    if (recipeQ.data) populate(recipeQ.data);
  }, [recipeQ.data]);

  const fromUrl = useMutation({
    mutationFn: () => recipesApi.fromUrl(urlInput.trim()),
    onSuccess: (res) => {
      populate(res.data);
      setImporter(null);
      setUrlInput('');
    },
    onError: (e: any) => setError(e.response?.data?.error || 'Could not import from that URL.'),
  });

  const fromAi = useMutation({
    mutationFn: () => recipesApi.generateFromAi(aiInput.trim()),
    onSuccess: (res) => {
      populate(res.data);
      setImporter(null);
      setAiInput('');
    },
    onError: (e: any) => setError(e.response?.data?.error || 'AI generation failed.'),
  });

  const fromPhoto = useMutation({
    mutationFn: async (src: 'camera' | 'library') => {
      const file = src === 'camera' ? await takePhoto() : await pickImage();
      if (!file) return null;
      return uploadFile<Partial<Recipe>>('/recipes/from-photo', file, 'photo');
    },
    onSuccess: (data) => data && populate(data),
    onError: (e: any) => setError(e.response?.data?.error || 'Could not read that photo.'),
  });

  const save = useMutation({
    mutationFn: () => {
      // Keep only named ingredients / non-empty steps, then remap the _lid links
      // to indices in the pruned ingredient list.
      const keptIngIdx = form.ingredients.map((ing, i) => ({ ing, lid: form.lids[i] })).filter((x) => x.ing.name.trim());
      const lidToIdx: Record<string, number> = {};
      keptIngIdx.forEach((x, idx) => { lidToIdx[x.lid] = idx; });
      const keptSteps = form.instructions.map((s, i) => ({ s, links: form.linkedIds[i] || [] })).filter((x) => x.s.trim());
      const instructionIngredients = keptSteps.map((x) =>
        x.links.map((lid) => lidToIdx[lid]).filter((n) => n != null)
      );
      const payload = {
        title: form.title,
        description: form.description,
        sourceUrl: form.sourceUrl,
        imageUrl: form.imageUrl,
        servings: form.servings ? Number(form.servings) : null,
        prepTimeMins: form.prepTimeMins ? Number(form.prepTimeMins) : null,
        cookTimeMins: form.cookTimeMins ? Number(form.cookTimeMins) : null,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        ingredients: keptIngIdx.map((x) => x.ing),
        instructions: keptSteps.map((x) => x.s),
        instructionIngredients,
      };
      return isEdit ? recipesApi.update(id!, payload) : recipesApi.create(payload);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
      const newId = (res.data as Recipe)?._id;
      if (!isEdit && newId) navigation.replace('RecipeDetail', { id: newId });
      else navigation.goBack();
    },
    onError: (e: any) => setError(e.response?.data?.error || 'Save failed'),
  });

  const addIngredient = () =>
    set({ ingredients: [...form.ingredients, { amount: '', unit: '', name: '' }], lids: [...form.lids, makeLid()] });
  const removeIngredient = (i: number) => {
    const lid = form.lids[i];
    set({
      ingredients: form.ingredients.filter((_, j) => j !== i),
      lids: form.lids.filter((_, j) => j !== i),
      linkedIds: form.linkedIds.map((ls) => ls.filter((x) => x !== lid)),
    });
  };
  const addStep = () => set({ instructions: [...form.instructions, ''], linkedIds: [...form.linkedIds, []] });
  const removeStep = (i: number) =>
    set({ instructions: form.instructions.filter((_, j) => j !== i), linkedIds: form.linkedIds.filter((_, j) => j !== i) });
  const setStepLinks = (i: number, lids: string[]) =>
    set({ linkedIds: form.linkedIds.map((ls, j) => (j === i ? lids : ls)) });

  // AI auto-link: ask the server which ingredients each step uses.
  const autoLink = useMutation({
    mutationFn: () => recipesApi.computeIngredientTags(form.ingredients.filter((i) => i.name.trim()), form.instructions.filter((s) => s.trim())),
    onSuccess: (res) => {
      const namedLids = form.ingredients.map((ing, i) => ({ named: !!ing.name.trim(), lid: form.lids[i] })).filter((x) => x.named).map((x) => x.lid);
      const incoming = res.data.instructionIngredients || [];
      let si = -1;
      const linkedIds = form.instructions.map((s) => {
        if (!s.trim()) return [];
        si += 1;
        return (incoming[si] || []).map((idx) => namedLids[idx]).filter(Boolean);
      });
      set({ linkedIds });
    },
  });

  const onSave = () => {
    if (!form.title.trim()) {
      setError('Title is required');
      return;
    }
    setError('');
    save.mutate();
  };

  const onPhoto = () =>
    Alert.alert('Import from Photo', 'Scan a recipe card or cookbook page.', [
      { text: 'Take Photo', onPress: () => fromPhoto.mutate('camera') },
      { text: 'Choose Photo', onPress: () => fromPhoto.mutate('library') },
      { text: 'Cancel', style: 'cancel' },
    ]);

  if (isEdit && recipeQ.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const importing = fromUrl.isPending || fromAi.isPending || fromPhoto.isPending;

  return (
    <Screen>
      {/* Import bar */}
      {!isEdit ? (
        <Card style={styles.importCard}>
          <Text style={styles.importTitle}>Quick import</Text>
          <View style={styles.importBtns}>
            <Button title="From URL" variant="ghost" onPress={() => setImporter((x) => (x === 'url' ? null : 'url'))} />
            <Button title="From AI" variant="ghost" onPress={() => setImporter((x) => (x === 'ai' ? null : 'ai'))} />
            <Button title="Photo" variant="ghost" onPress={onPhoto} />
          </View>
          {importer === 'url' ? (
            <View style={styles.importPad}>
              <Input placeholder="https://…" value={urlInput} onChangeText={setUrlInput} autoCapitalize="none" />
              <Button title="Import" loading={fromUrl.isPending} disabled={!urlInput.trim()} onPress={() => fromUrl.mutate()} />
            </View>
          ) : null}
          {importer === 'ai' ? (
            <View style={styles.importPad}>
              <Input placeholder="Describe a dish, e.g. 'quick weeknight chicken curry'" value={aiInput} onChangeText={setAiInput} multiline />
              <Button title="Generate" loading={fromAi.isPending} disabled={!aiInput.trim()} onPress={() => fromAi.mutate()} />
            </View>
          ) : null}
          {importing && importer === null ? <ActivityIndicator color={colors.primary} style={{ marginTop: spacing.sm }} /> : null}
        </Card>
      ) : null}

      <Input label="Title *" value={form.title} onChangeText={(v) => set({ title: v })} />
      <Input label="Description" value={form.description} onChangeText={(v) => set({ description: v })} multiline />

      <View style={styles.cols}>
        <View style={styles.col}>
          <Input label="Servings" keyboardType="numeric" value={form.servings} onChangeText={(v) => set({ servings: v })} />
        </View>
        <View style={styles.col}>
          <Input label="Prep (min)" keyboardType="numeric" value={form.prepTimeMins} onChangeText={(v) => set({ prepTimeMins: v })} />
        </View>
        <View style={styles.col}>
          <Input label="Cook (min)" keyboardType="numeric" value={form.cookTimeMins} onChangeText={(v) => set({ cookTimeMins: v })} />
        </View>
      </View>
      <Input label="Tags (comma-separated)" value={form.tags} onChangeText={(v) => set({ tags: v })} />

      <SectionTitle>Ingredients</SectionTitle>
      {form.ingredients.map((ing, i) => (
        <View key={i} style={styles.ingRow}>
          <View style={styles.ingAmount}>
            <Input placeholder="1" value={ing.amount ?? ''} onChangeText={(v) => set({ ingredients: form.ingredients.map((x, j) => (j === i ? { ...x, amount: v } : x)) })} />
          </View>
          <View style={styles.ingUnit}>
            <Input placeholder="cup" value={ing.unit ?? ''} onChangeText={(v) => set({ ingredients: form.ingredients.map((x, j) => (j === i ? { ...x, unit: v } : x)) })} />
          </View>
          <View style={styles.ingName}>
            <Input placeholder="flour" value={ing.name} onChangeText={(v) => set({ ingredients: form.ingredients.map((x, j) => (j === i ? { ...x, name: v } : x)) })} />
          </View>
          <TouchableOpacity onPress={() => removeIngredient(i)} style={styles.removeBtn}>
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      ))}
      <Button title="+ Add Ingredient" variant="ghost" onPress={addIngredient} />

      <View style={styles.instrHead}>
        <SectionTitle>Instructions</SectionTitle>
        {form.ingredients.length && form.instructions.length ? (
          <Button title="Auto-link" variant="ghost" loading={autoLink.isPending} onPress={() => autoLink.mutate()} />
        ) : null}
      </View>
      {form.instructions.map((step, i) => (
        <View key={i}>
          <View style={styles.stepRow}>
            <Text style={styles.stepNum}>{i + 1}.</Text>
            <View style={{ flex: 1 }}>
              <Input placeholder={`Step ${i + 1}`} value={step} onChangeText={(v) => set({ instructions: form.instructions.map((x, j) => (j === i ? v : x)) })} multiline />
            </View>
            <TouchableOpacity onPress={() => removeStep(i)} style={styles.removeBtn}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          {form.ingredients.length ? (
            <StepIngredientLinker
              value={form.linkedIds[i] || []}
              ingredients={lidIngredients}
              assignmentsById={assignmentsById}
              stepNumber={i + 1}
              stepText={step}
              onChange={(lids) => setStepLinks(i, lids)}
            />
          ) : null}
        </View>
      ))}
      <Button title="+ Add Step" variant="ghost" onPress={addStep} />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} />
        <View style={{ flex: 1 }}>
          <Button title={isEdit ? 'Save Changes' : 'Create Recipe'} loading={save.isPending} onPress={onSave} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  importCard: { marginBottom: spacing.md },
  importTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  importBtns: { flexDirection: 'row', gap: spacing.sm },
  importPad: { marginTop: spacing.sm, gap: spacing.sm },
  cols: { flexDirection: 'row', gap: spacing.sm },
  col: { flex: 1 },
  ingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  ingAmount: { width: 56 },
  ingUnit: { width: 64 },
  ingName: { flex: 1 },
  instrHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  stepNum: { fontSize: 15, fontWeight: '700', color: colors.primary, paddingTop: 12 },
  removeBtn: { paddingTop: 12 },
  error: { color: colors.error, marginVertical: spacing.sm },
  footer: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.xl, alignItems: 'center' },
});
