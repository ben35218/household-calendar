import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity, Alert } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { recipesApi, Recipe, Ingredient } from '../../api';
import { Button, Input, Screen, SectionTitle, Card } from '../../components/ui';
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

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit Recipe' : 'Add Recipe' });
  }, [navigation, isEdit]);

  const recipeQ = useQuery({
    queryKey: ['recipes', id],
    queryFn: async () => (await recipesApi.get(id!)).data,
    enabled: isEdit,
  });

  const populate = (data: Partial<Recipe>) =>
    setForm((f) => ({
      ...f,
      title: data.title ?? f.title,
      description: data.description ?? f.description,
      imageUrl: data.imageUrl ?? f.imageUrl,
      sourceUrl: data.sourceUrl ?? f.sourceUrl,
      servings: data.servings != null ? String(data.servings) : f.servings,
      prepTimeMins: data.prepTimeMins != null ? String(data.prepTimeMins) : f.prepTimeMins,
      cookTimeMins: data.cookTimeMins != null ? String(data.cookTimeMins) : f.cookTimeMins,
      tags: data.tags ? data.tags.join(', ') : f.tags,
      ingredients: data.ingredients ?? f.ingredients,
      instructions: data.instructions ?? f.instructions,
    }));

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
      const payload = {
        title: form.title,
        description: form.description,
        sourceUrl: form.sourceUrl,
        imageUrl: form.imageUrl,
        servings: form.servings ? Number(form.servings) : null,
        prepTimeMins: form.prepTimeMins ? Number(form.prepTimeMins) : null,
        cookTimeMins: form.cookTimeMins ? Number(form.cookTimeMins) : null,
        tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean),
        ingredients: form.ingredients.filter((i) => i.name.trim()),
        instructions: form.instructions.filter((s) => s.trim()),
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
          <TouchableOpacity onPress={() => set({ ingredients: form.ingredients.filter((_, j) => j !== i) })} style={styles.removeBtn}>
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      ))}
      <Button title="+ Add Ingredient" variant="ghost" onPress={() => set({ ingredients: [...form.ingredients, { amount: '', unit: '', name: '' }] })} />

      <SectionTitle>Instructions</SectionTitle>
      {form.instructions.map((step, i) => (
        <View key={i} style={styles.stepRow}>
          <Text style={styles.stepNum}>{i + 1}.</Text>
          <View style={{ flex: 1 }}>
            <Input placeholder={`Step ${i + 1}`} value={step} onChangeText={(v) => set({ instructions: form.instructions.map((x, j) => (j === i ? v : x)) })} multiline />
          </View>
          <TouchableOpacity onPress={() => set({ instructions: form.instructions.filter((_, j) => j !== i) })} style={styles.removeBtn}>
            <Ionicons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      ))}
      <Button title="+ Add Step" variant="ghost" onPress={() => set({ instructions: [...form.instructions, ''] })} />

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
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  stepNum: { fontSize: 15, fontWeight: '700', color: colors.primary, paddingTop: 12 },
  removeBtn: { paddingTop: 12 },
  error: { color: colors.error, marginVertical: spacing.sm },
  footer: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.xl, alignItems: 'center' },
});
