import React, { useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { recipesApi, Recipe, Ingredient } from '../../api';
import { sealNew, sealUpdate, openRecord } from '../../lib/e2ee';

// Encrypted recipe content (imageUrl/sourceUrl/instructionIngredients stay plaintext).
const RECIPE_ENC = (p: Record<string, unknown>) => ({
  title: p.title, description: p.description, ingredients: p.ingredients,
  instructions: p.instructions, tags: p.tags,
  servings: p.servings, prepTimeMins: p.prepTimeMins, cookTimeMins: p.cookTimeMins,
});
import { Button, Input, Screen, SectionTitle, Card, useHeaderCheckButton } from '../../components/ui';
import StepIngredientLinker from '../../components/StepIngredientLinker';
import AssistantIcon from '../../components/AssistantIcon';
import { takePhoto, pickImage } from '../../lib/media';
import { uploadFile } from '../../lib/upload';
import { KitchenStackParamList } from '../../navigation/KitchenNavigator';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { colors, spacing, radius } from '../../theme';

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
  tags: string[];
  ingredients: Ingredient[];
  instructions: string[];
  // Per-step timer in minutes (parallel to instructions); '' = no timer.
  timers: string[];
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
  tags: [],
  ingredients: [],
  instructions: [],
  timers: [],
  lids: [],
  linkedIds: [],
};

export default function RecipeFormScreen() {
  const navigation = useNavigation<Nav>();
  const { id } = useRoute<Rt>().params || {};
  const isEdit = !!id;
  const qc = useQueryClient();
  // Meals/recipes calendar colour (respects user overrides) — the section accent.
  const accent = useCalendarColors().colors.recipes;

  const lidCounter = useRef(0);
  const makeLid = () => `_l${++lidCounter.current}`;

  // New recipes start with a single blank ingredient row; edits populate from data.
  const [form, setForm] = useState<FormState>(() =>
    isEdit ? EMPTY : { ...EMPTY, ingredients: [{ amount: '', unit: '', name: '' }], lids: [makeLid()] }
  );
  const [urlInput, setUrlInput] = useState('');
  const [tagInput, setTagInput] = useState('');
  const [aiInput, setAiInput] = useState('');
  const [importer, setImporter] = useState<'url' | null>(null);
  const [error, setError] = useState('');

  const set = (patch: Partial<FormState>) => setForm((f) => ({ ...f, ...patch }));

  const addTag = () => {
    const t = tagInput.trim();
    if (!t) return;
    if (!form.tags.includes(t)) set({ tags: [...form.tags, t] });
    setTagInput('');
  };
  const removeTag = (i: number) => set({ tags: form.tags.filter((_, j) => j !== i) });

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
      let timers = f.timers;
      if (data.instructions) {
        const incoming = data.instructionIngredients;
        linkedIds = incoming
          ? instructions.map((_, si) => (incoming[si] || []).map((idx) => lids[idx]).filter(Boolean))
          : instructions.map(() => []);
        const incomingTimers = data.instructionTimers;
        timers = instructions.map((_, si) => {
          const t = incomingTimers?.[si];
          return t != null && t > 0 ? String(t) : '';
        });
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
        tags: data.tags ? data.tags : f.tags,
        ingredients,
        instructions,
        timers,
        lids,
        linkedIds,
      };
    });

  useEffect(() => {
    if (!recipeQ.data) return;
    let cancelled = false;
    openRecord('Recipe', recipeQ.data).then((r) => { if (!cancelled) populate(r); }); // decrypt over plaintext
    return () => { cancelled = true; };
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
    mutationFn: async () => {
      // Keep only named ingredients / non-empty steps, then remap the _lid links
      // to indices in the pruned ingredient list.
      const keptIngIdx = form.ingredients.map((ing, i) => ({ ing, lid: form.lids[i] })).filter((x) => x.ing.name.trim());
      const lidToIdx: Record<string, number> = {};
      keptIngIdx.forEach((x, idx) => { lidToIdx[x.lid] = idx; });
      const keptSteps = form.instructions
        .map((s, i) => ({ s, links: form.linkedIds[i] || [], timer: form.timers[i] || '' }))
        .filter((x) => x.s.trim());
      const instructionIngredients = keptSteps.map((x) =>
        x.links.map((lid) => lidToIdx[lid]).filter((n) => n != null)
      );
      const instructionTimers = keptSteps.map((x) => (x.timer.trim() ? Number(x.timer) : null));
      const hasTimers = instructionTimers.some((t) => t != null);
      const payload = {
        title: form.title,
        description: form.description,
        sourceUrl: form.sourceUrl,
        imageUrl: form.imageUrl,
        servings: form.servings ? Number(form.servings) : null,
        prepTimeMins: form.prepTimeMins ? Number(form.prepTimeMins) : null,
        cookTimeMins: form.cookTimeMins ? Number(form.cookTimeMins) : null,
        tags: form.tags.map((t) => t.trim()).filter(Boolean),
        ingredients: keptIngIdx.map((x) => x.ing),
        instructions: keptSteps.map((x) => x.s),
        instructionIngredients,
        // Persist the timers array when any step has one; null clears a
        // previously-saved set so removing every timer sticks on update.
        instructionTimers: hasTimers ? instructionTimers : null,
      };
      return isEdit
        ? recipesApi.update(id!, await sealUpdate('Recipe', id!, payload, RECIPE_ENC(payload)))
        : recipesApi.create(await sealNew('Recipe', payload, RECIPE_ENC(payload)));
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
      const newId = (res.data as Recipe)?._id;
      if (!isEdit && newId) navigation.replace('RecipeDetail', { id: newId });
      else navigation.goBack();
    },
    onError: (e: any) => setError(e.response?.data?.error || 'Save failed'),
  });

  const del = useMutation({
    mutationFn: () => recipesApi.delete(id!),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['recipes'] });
      navigation.goBack();
    },
  });
  const confirmDelete = () =>
    Alert.alert('Delete Recipe', `Delete "${form.title || 'this recipe'}"? This cannot be undone.`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => del.mutate() },
    ]);

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
  const addStep = () =>
    set({ instructions: [...form.instructions, ''], linkedIds: [...form.linkedIds, []], timers: [...form.timers, ''] });
  const removeStep = (i: number) =>
    set({
      instructions: form.instructions.filter((_, j) => j !== i),
      linkedIds: form.linkedIds.filter((_, j) => j !== i),
      timers: form.timers.filter((_, j) => j !== i),
    });
  const setStepLinks = (i: number, lids: string[]) =>
    set({ linkedIds: form.linkedIds.map((ls, j) => (j === i ? lids : ls)) });
  const setStepTimer = (i: number, v: string) =>
    set({ timers: form.timers.map((t, j) => (j === i ? v.replace(/[^0-9]/g, '') : t)) });

  // AI edit: describe a change ("make it vegan", "double the servings") and let
  // the server rewrite the recipe, then repopulate the form from the result.
  const editWithAi = useMutation({
    mutationFn: () =>
      recipesApi.editWithAi(
        {
          title: form.title,
          description: form.description,
          servings: form.servings ? Number(form.servings) : null,
          prepTimeMins: form.prepTimeMins ? Number(form.prepTimeMins) : null,
          cookTimeMins: form.cookTimeMins ? Number(form.cookTimeMins) : null,
          tags: form.tags,
          ingredients: form.ingredients,
          instructions: form.instructions,
        },
        aiInput.trim()
      ),
    onSuccess: (res) => {
      populate(res.data);
      setAiInput('');
    },
    onError: (e: any) => setError(e.response?.data?.error || 'Failed to apply changes.'),
  });

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

  useHeaderCheckButton(navigation, { onPress: onSave, loading: save.isPending, color: accent });

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

  const importing = fromUrl.isPending || fromPhoto.isPending;

  return (
    <Screen>
      {/* AI Assistant — describe changes to apply, or tag ingredients to steps */}
      {isEdit ? (
        <View style={styles.aiCard}>
          <View style={styles.aiHeader}>
            <Ionicons name="sparkles" size={16} color={accent} />
            <Text style={styles.aiTitle}>AI Assistant</Text>
          </View>
          <Input
            value={aiInput}
            onChangeText={setAiInput}
            placeholder="Describe the changes you want, e.g. make it vegan, double the servings, add more spice"
            multiline
            editable={!editWithAi.isPending}
            style={styles.aiInput}
          />
          <View style={styles.aiActions}>
            <Button
              title="Apply changes"
              color={accent}
              loading={editWithAi.isPending}
              disabled={!aiInput.trim()}
              onPress={() => editWithAi.mutate()}
            />
            <TouchableOpacity
              style={[
                styles.tagBtn,
                { borderColor: accent },
                (autoLink.isPending || !form.ingredients.length || !form.instructions.length) && styles.tagBtnDisabled,
              ]}
              activeOpacity={0.8}
              disabled={autoLink.isPending || !form.ingredients.length || !form.instructions.length}
              onPress={() => autoLink.mutate()}
            >
              {autoLink.isPending ? (
                <ActivityIndicator size="small" color={accent} />
              ) : (
                <Text style={[styles.tagBtnText, { color: accent }]}>Tag ingredients to instructions</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      ) : null}

      {/* Import bar */}
      {!isEdit ? (
        <Card style={styles.importCard}>
          <Text style={styles.importTitle}>Quick import</Text>
          <View style={styles.importBtns}>
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: accent }, importer === 'url' && styles.iconBtnActive]}
              onPress={() => setImporter((x) => (x === 'url' ? null : 'url'))}
              accessibilityLabel="Import from URL"
            >
              <Ionicons name="link-outline" size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity style={[styles.iconBtn, { backgroundColor: accent }]} onPress={onPhoto} accessibilityLabel="Import from photo">
              <Ionicons name="camera-outline" size={20} color="#fff" />
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.iconBtn, { backgroundColor: accent }]}
              onPress={() => navigation.navigate('RecipeAssistant')}
              accessibilityLabel="AI Assistant"
            >
              <AssistantIcon size={20} color="#fff" />
            </TouchableOpacity>
          </View>
          {importer === 'url' ? (
            <View style={styles.importPad}>
              <Input placeholder="https://…" value={urlInput} onChangeText={setUrlInput} autoCapitalize="none" />
              <Button title="Import" color={accent} loading={fromUrl.isPending} disabled={!urlInput.trim()} onPress={() => fromUrl.mutate()} />
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
          <Input label="Prep (minutes)" keyboardType="numeric" value={form.prepTimeMins} onChangeText={(v) => set({ prepTimeMins: v })} />
        </View>
        <View style={styles.col}>
          <Input label="Cook (minutes)" keyboardType="numeric" value={form.cookTimeMins} onChangeText={(v) => set({ cookTimeMins: v })} />
        </View>
      </View>
      <Text style={styles.tagLabel}>Tags</Text>
      {form.tags.length ? (
        <View style={styles.chipsWrap}>
          {form.tags.map((t, i) => (
            <View key={i} style={styles.chip}>
              <Text style={styles.chipText}>{t}</Text>
              <TouchableOpacity onPress={() => removeTag(i)} accessibilityLabel={`Remove tag ${t}`}>
                <Ionicons name="close" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}
      <View style={styles.tagInputRow}>
        <View style={{ flex: 1 }}>
          <Input
            placeholder="Add a tag"
            value={tagInput}
            onChangeText={setTagInput}
            onSubmitEditing={addTag}
            returnKeyType="done"
            blurOnSubmit={false}
            autoCapitalize="none"
          />
        </View>
        <Button title="Add" color={accent} disabled={!tagInput.trim()} onPress={addTag} />
      </View>

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
      <Button title="+ Add Ingredient" color={accent} onPress={addIngredient} />

      <View style={styles.instrHead}>
        <SectionTitle>Instructions</SectionTitle>
        {!isEdit && form.ingredients.length && form.instructions.length ? (
          <Button title="Auto-link" color={accent} loading={autoLink.isPending} onPress={() => autoLink.mutate()} />
        ) : null}
      </View>
      {form.instructions.map((step, i) => (
        <View key={i} style={styles.stepBlock}>
          <View style={styles.stepRow}>
            <Text style={styles.stepNum}>{i + 1}.</Text>
            <View style={{ flex: 1 }}>
              <Input placeholder={`Step ${i + 1}`} value={step} onChangeText={(v) => set({ instructions: form.instructions.map((x, j) => (j === i ? v : x)) })} multiline />
            </View>
            <TouchableOpacity onPress={() => removeStep(i)} style={styles.removeBtn}>
              <Ionicons name="close" size={20} color={colors.textMuted} />
            </TouchableOpacity>
          </View>
          <View style={styles.timerRow}>
            <Ionicons name="timer-outline" size={16} color={accent} />
            <View style={styles.timerField}>
              <Input
                placeholder="Timer (minutes)"
                keyboardType="numeric"
                value={form.timers[i] || ''}
                onChangeText={(v) => setStepTimer(i, v)}
              />
            </View>
          </View>
          {form.ingredients.length ? (
            <StepIngredientLinker
              value={form.linkedIds[i] || []}
              ingredients={lidIngredients}
              assignmentsById={assignmentsById}
              stepNumber={i + 1}
              stepText={step}
              onChange={(lids) => setStepLinks(i, lids)}
              accent={accent}
            />
          ) : null}
        </View>
      ))}
      <View style={{ marginTop: spacing.md }}>
        <Button title="+ Add Step" color={accent} onPress={addStep} />
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      {isEdit ? (
        <View style={styles.deleteWrap}>
          <Button title="Delete recipe" variant="danger" loading={del.isPending} onPress={confirmDelete} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  aiCard: {
    backgroundColor: colors.primary + '14',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary + '55',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  aiHeader: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
  aiTitle: { fontSize: 15, fontWeight: '700', color: colors.text },
  aiInput: { minHeight: 68, textAlignVertical: 'top' },
  aiActions: { gap: spacing.sm, marginTop: spacing.sm },
  tagBtn: {
    backgroundColor: '#fff',
    borderWidth: 1,
    borderRadius: radius.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tagBtnDisabled: { opacity: 0.6 },
  tagBtnText: { fontSize: 16, fontWeight: '600' },
  importCard: { marginBottom: spacing.md },
  importTitle: { fontSize: 14, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  importBtns: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: spacing.sm },
  iconBtn: { backgroundColor: colors.primary, borderRadius: radius.md, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  iconBtnActive: { opacity: 0.75 },
  importPad: { marginTop: spacing.sm, gap: spacing.sm },
  cols: { flexDirection: 'row', gap: spacing.sm },
  col: { flex: 1 },
  tagLabel: { fontSize: 13, color: colors.textMuted, marginBottom: 6, fontWeight: '500' },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.sm },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, borderRadius: radius.md, paddingVertical: 6, paddingHorizontal: 10 },
  chipText: { color: colors.text, fontSize: 14 },
  tagInputRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm, marginBottom: spacing.md },
  ingRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 4 },
  ingAmount: { width: 56 },
  ingUnit: { width: 64 },
  ingName: { flex: 1 },
  instrHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  stepBlock: { marginBottom: spacing.lg },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  timerRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingLeft: 20, marginTop: spacing.xs },
  timerField: { width: 150 },
  stepNum: { fontSize: 15, fontWeight: '700', color: colors.primary, paddingTop: 12 },
  removeBtn: { paddingTop: 12 },
  error: { color: colors.error, marginVertical: spacing.sm },
  deleteWrap: { marginTop: spacing.md, marginBottom: spacing.xl },
});
