import React, { useEffect, useState } from 'react';
import { Text, StyleSheet } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { inventoryApi, FormAssistField } from '../../api';
import { sealNew, sealUpdate, openRecord } from '../../lib/e2ee';

// Encrypted inventory content (category/dates/status stay plaintext).
const INV_ENC = (p: Record<string, unknown>) => ({ name: p.name, quantity: p.quantity, notes: p.notes });
import { Input, Select, Screen, DateField, useHeaderCheckButton } from '../../components/ui';
import FormAssist from '../../components/FormAssist';
import { useFormAssist } from '../../hooks/useFormAssist';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { INVENTORY_CATEGORIES } from './constants';
import { KitchenStackParamList } from '../../navigation/KitchenNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<KitchenStackParamList, 'InventoryItemForm'>;
type Rt = RouteProp<KitchenStackParamList, 'InventoryItemForm'>;

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

export default function InventoryItemFormScreen() {
  const navigation = useNavigation<Nav>();
  const { id } = useRoute<Rt>().params || {};
  const isEdit = !!id;
  const qc = useQueryClient();
  const accent = useCalendarColors().colors.recipes;

  const [form, setForm] = useState({
    name: '',
    quantity: '',
    category: 'other',
    purchaseDate: todayStr(),
    expirationDate: '',
    notes: '',
  });
  const [error, setError] = useState('');
  const assist = useFormAssist();

  const set = (patch: Partial<typeof form>) => {
    setForm((f) => ({ ...f, ...patch }));
    assist.clear(Object.keys(patch));
  };

  const assistFields: FormAssistField[] = [
    { name: 'name', type: 'text', label: 'Name' },
    { name: 'quantity', type: 'text', label: 'Quantity', description: 'e.g. "2 lbs", "1 carton"' },
    { name: 'category', type: 'select', label: 'Category', options: INVENTORY_CATEGORIES },
    { name: 'purchaseDate', type: 'date', label: 'Purchase date' },
    { name: 'expirationDate', type: 'date', label: 'Expiration date' },
    { name: 'notes', type: 'text', label: 'Notes' },
  ];

  const applyPatch = (patch: Record<string, unknown>) => {
    const next: Partial<typeof form> = {};
    const changedKeys: string[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (!(k in form)) continue;
      const val = v == null ? '' : String(v);
      if ((form as any)[k] !== val) changedKeys.push(k);
      (next as any)[k] = val;
    }
    setForm((f) => ({ ...f, ...next }));
    assist.mark(changedKeys);
  };

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit Item' : 'Add Item' });
  }, [navigation, isEdit]);

  // For edit we need the item; the list isn't always in cache, so fetch active list.
  const listQ = useQuery({
    queryKey: ['inventory', 'active'],
    queryFn: async () => (await inventoryApi.list({ status: 'active' })).data,
    enabled: isEdit,
  });
  useEffect(() => {
    if (!isEdit || !listQ.data) return;
    const found = listQ.data.find((x) => x._id === id);
    if (!found) return;
    let cancelled = false;
    openRecord('FoodInventory', found).then((it) => {
      if (cancelled) return;
      setForm({
        name: it.name,
        quantity: it.quantity || '',
        category: it.category || 'other',
        purchaseDate: it.purchaseDate ? it.purchaseDate.slice(0, 10) : todayStr(),
        expirationDate: it.expirationDate ? it.expirationDate.slice(0, 10) : '',
        notes: it.notes || '',
      });
    });
    return () => { cancelled = true; };
  }, [listQ.data, id, isEdit]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        name: form.name.trim(),
        quantity: form.quantity,
        category: form.category,
        purchaseDate: form.purchaseDate,
        expirationDate: form.expirationDate || undefined,
        notes: form.notes,
      };
      return isEdit
        ? inventoryApi.update(id!, await sealUpdate('FoodInventory', id!, payload, INV_ENC(payload)))
        : inventoryApi.create(await sealNew('FoodInventory', payload, INV_ENC(payload)));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      navigation.goBack();
    },
    onError: (e: any) => setError(e.response?.data?.error || 'Failed to save item'),
  });

  const onSave = () => {
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    setError('');
    save.mutate();
  };

  useHeaderCheckButton(navigation, { onPress: onSave, loading: save.isPending, color: accent });

  return (
    <Screen>
      <FormAssist
        formType="kitchen inventory item"
        title="AI Assistant"
        placeholder={'Describe the item, e.g. "2 cartons of eggs, expires next Friday"'}
        fields={assistFields}
        current={{ ...form }}
        onApply={applyPatch}
      />

      <Input label="Name *" value={form.name} onChangeText={(v) => set({ name: v })} highlight={assist.changed.has('name')} />
      <Input label="Quantity" value={form.quantity} onChangeText={(v) => set({ quantity: v })} placeholder="e.g. 2 lbs, 1 carton" highlight={assist.changed.has('quantity')} />
      <Select label="Category" value={form.category} options={INVENTORY_CATEGORIES} onChange={(v) => set({ category: (v as string) ?? 'other' })} highlight={assist.changed.has('category')} />
      <DateField label="Purchase Date" clearable value={form.purchaseDate} onChange={(v) => set({ purchaseDate: v })} highlight={assist.changed.has('purchaseDate')} />
      <DateField label="Expiration Date" clearable value={form.expirationDate} onChange={(v) => set({ expirationDate: v })} highlight={assist.changed.has('expirationDate')} />
      <Input label="Notes" value={form.notes} onChangeText={(v) => set({ notes: v })} multiline highlight={assist.changed.has('notes')} />

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.error, marginVertical: spacing.sm },
});
