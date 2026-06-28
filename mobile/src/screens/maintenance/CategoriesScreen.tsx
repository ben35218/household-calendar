import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { MaterialCommunityIcons, Ionicons } from '@expo/vector-icons';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { categoriesApi, Category } from '../../api';
import { Button, Card, Input } from '../../components/ui';
import { colors, spacing } from '../../theme';

const SWATCHES = ['#1976D2', '#388E3C', '#7B1FA2', '#F57C00', '#D32F2F', '#00897B', '#5E35B1', '#E91E63', '#0288D1', '#616161'];

const mdi = (icon?: string) => (icon || 'home').replace(/^mdi-/, '') as any;

// Mirrors client/src/components/CategoryManager.vue (via CategoriesView).
export default function CategoriesScreen() {
  const qc = useQueryClient();
  const { data: categories, isLoading } = useQuery({
    queryKey: ['categories'],
    queryFn: async () => (await categoriesApi.list()).data,
  });

  const [editing, setEditing] = useState<Category | null>(null);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ name: '', icon: 'mdi-home', color: '#1976D2' });
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  function openForm(cat?: Category) {
    setEditing(cat ?? null);
    setForm(cat ? { name: cat.name, icon: cat.icon || 'mdi-home', color: cat.color || '#1976D2' } : { name: '', icon: 'mdi-home', color: '#1976D2' });
    setOpen(true);
  }

  async function save() {
    setSaving(true);
    try {
      if (editing?._id) await categoriesApi.update(editing._id, form);
      else await categoriesApi.create(form);
      qc.invalidateQueries({ queryKey: ['categories'] });
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  async function doDelete(id: string) {
    await categoriesApi.delete(id);
    setDeleteId(null);
    qc.invalidateQueries({ queryKey: ['categories'] });
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.intro}>
        Categories organize maintenance tasks across your items. Changes here apply everywhere
        categories are used.
      </Text>

      <Card style={styles.listCard}>
        {(categories ?? []).map((cat) => (
          <View key={cat._id} style={styles.row}>
            <View style={[styles.avatar, { backgroundColor: cat.color || colors.primary }]}>
              <MaterialCommunityIcons name={mdi(cat.icon)} size={16} color="#fff" />
            </View>
            <Text style={styles.rowName}>{cat.name}</Text>
            {deleteId === cat._id ? (
              <View style={styles.confirm}>
                <Text style={styles.confirmText}>Delete?</Text>
                <TouchableOpacity onPress={() => setDeleteId(null)}><Text style={styles.no}>No</Text></TouchableOpacity>
                <TouchableOpacity onPress={() => doDelete(cat._id)}><Text style={styles.yes}>Yes</Text></TouchableOpacity>
              </View>
            ) : (
              <View style={styles.actions}>
                <TouchableOpacity onPress={() => openForm(cat)}><Ionicons name="pencil" size={18} color={colors.textMuted} /></TouchableOpacity>
                <TouchableOpacity onPress={() => setDeleteId(cat._id)}><Ionicons name="trash" size={18} color={colors.error} /></TouchableOpacity>
              </View>
            )}
          </View>
        ))}
        {(categories ?? []).length === 0 ? <Text style={styles.empty}>No categories yet.</Text> : null}
      </Card>

      {open ? (
        <Card style={styles.formCard}>
          <Text style={styles.formTitle}>{editing?._id ? 'Edit Category' : 'New Category'}</Text>
          <Input label="Name" value={form.name} onChangeText={(v) => setForm((f) => ({ ...f, name: v }))} />
          <Input label="Icon (MaterialCommunityIcons name, e.g. home)" value={form.icon} onChangeText={(v) => setForm((f) => ({ ...f, icon: v }))} autoCapitalize="none" />
          <Text style={styles.fieldLabel}>Color</Text>
          <View style={styles.swatches}>
            {SWATCHES.map((c) => (
              <TouchableOpacity
                key={c}
                style={[styles.swatch, { backgroundColor: c }, form.color === c && styles.swatchOn]}
                onPress={() => setForm((f) => ({ ...f, color: c }))}
              />
            ))}
          </View>
          <View style={styles.preview}>
            <View style={[styles.avatar, { backgroundColor: form.color }]}>
              <MaterialCommunityIcons name={mdi(form.icon)} size={16} color="#fff" />
            </View>
            <Text style={styles.previewText}>Preview</Text>
          </View>
          <View style={styles.formActions}>
            <Button title="Cancel" variant="ghost" onPress={() => setOpen(false)} />
            <Button title="Save" onPress={save} loading={saving} disabled={!form.name.trim()} />
          </View>
        </Card>
      ) : (
        <Button title="+ Add category" variant="ghost" onPress={() => openForm()} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  intro: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 18 },
  listCard: { padding: 0, marginBottom: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: 10, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.border },
  avatar: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center', marginRight: spacing.md },
  rowName: { flex: 1, fontSize: 15, color: colors.text },
  actions: { flexDirection: 'row', gap: spacing.md },
  confirm: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  confirmText: { color: colors.error, fontSize: 12 },
  no: { color: colors.textMuted, fontWeight: '600' },
  yes: { color: colors.error, fontWeight: '700' },
  empty: { padding: spacing.md, color: colors.textMuted },
  formCard: { marginBottom: spacing.md },
  formTitle: { fontSize: 15, fontWeight: '700', color: colors.text, marginBottom: spacing.sm },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 6 },
  swatches: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: spacing.md },
  swatch: { width: 30, height: 30, borderRadius: 15 },
  swatchOn: { borderWidth: 3, borderColor: colors.text },
  preview: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.md },
  previewText: { color: colors.textMuted },
  formActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: spacing.sm },
});
