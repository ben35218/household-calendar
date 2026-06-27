import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { inventoryApi } from '../../api';
import { Button, Input, Select, Screen, DateField } from '../../components/ui';
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

  const [form, setForm] = useState({
    name: '',
    quantity: '',
    category: 'other',
    purchaseDate: todayStr(),
    expirationDate: '',
    notes: '',
  });
  const [error, setError] = useState('');

  const set = (patch: Partial<typeof form>) => setForm((f) => ({ ...f, ...patch }));

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
    const it = listQ.data.find((x) => x._id === id);
    if (it)
      setForm({
        name: it.name,
        quantity: it.quantity || '',
        category: it.category || 'other',
        purchaseDate: it.purchaseDate ? it.purchaseDate.slice(0, 10) : todayStr(),
        expirationDate: it.expirationDate ? it.expirationDate.slice(0, 10) : '',
        notes: it.notes || '',
      });
  }, [listQ.data, id, isEdit]);

  const save = useMutation({
    mutationFn: () => {
      const payload = {
        name: form.name.trim(),
        quantity: form.quantity,
        category: form.category,
        purchaseDate: form.purchaseDate,
        expirationDate: form.expirationDate || undefined,
        notes: form.notes,
      };
      return isEdit ? inventoryApi.update(id!, payload) : inventoryApi.create(payload);
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

  return (
    <Screen>
      <Input label="Name *" value={form.name} onChangeText={(v) => set({ name: v })} />
      <Input label="Quantity" value={form.quantity} onChangeText={(v) => set({ quantity: v })} placeholder="e.g. 2 lbs, 1 carton" />
      <Select label="Category" value={form.category} options={INVENTORY_CATEGORIES} onChange={(v) => set({ category: (v as string) ?? 'other' })} />
      <DateField label="Purchase Date" clearable value={form.purchaseDate} onChange={(v) => set({ purchaseDate: v })} />
      <DateField label="Expiration Date" clearable value={form.expirationDate} onChange={(v) => set({ expirationDate: v })} />
      <Input label="Notes" value={form.notes} onChangeText={(v) => set({ notes: v })} multiline />

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} />
        <View style={{ flex: 1 }}>
          <Button title={isEdit ? 'Save Changes' : 'Add Item'} loading={save.isPending} onPress={onSave} />
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  error: { color: colors.error, marginVertical: spacing.sm },
  footer: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.xl, alignItems: 'center' },
});
