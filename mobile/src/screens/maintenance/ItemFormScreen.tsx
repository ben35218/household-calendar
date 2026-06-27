import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { itemsApi, categoriesApi, Item, CustomField } from '../../api';
import { Button, Input, Select, Screen, SectionTitle, SwitchRow, Card, DateField } from '../../components/ui';
import { mdiName } from '../../lib/recurrence';
import { ITEM_TYPES, itemTypeConfig, TYPE_CATEGORY_MATCH, ItemField } from '../../lib/itemTypes';
import { MaintenanceStackParamList } from '../../navigation/MaintenanceNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<MaintenanceStackParamList, 'ItemForm'>;
type Rt = RouteProp<MaintenanceStackParamList, 'ItemForm'>;

// Core (non-custom) form fields written by `field.model`.
interface CoreForm {
  name: string;
  type: string;
  categoryId: string | null;
  location: string;
  manufacturer: string;
  modelNumber: string;
  serialNumber: string;
  purchaseDate: string;
  warrantyExpiry: string;
  notes: string;
  autoLookupManual: boolean;
}

const EMPTY: CoreForm = {
  name: '',
  type: 'other',
  categoryId: null,
  location: 'Home',
  manufacturer: '',
  modelNumber: '',
  serialNumber: '',
  purchaseDate: '',
  warrantyExpiry: '',
  notes: '',
  autoLookupManual: true,
};

export default function ItemFormScreen() {
  const navigation = useNavigation<Nav>();
  const { id, prefill } = useRoute<Rt>().params || {};
  const isEdit = !!id;
  const qc = useQueryClient();

  const [step, setStep] = useState<1 | 2>(isEdit || prefill ? 2 : 1);
  const [form, setForm] = useState<CoreForm>(EMPTY);
  const [customMap, setCustomMap] = useState<Record<string, string>>({});
  const [userFields, setUserFields] = useState<CustomField[]>([]);
  const [error, setError] = useState('');

  const set = (patch: Partial<CoreForm>) => setForm((f) => ({ ...f, ...patch }));
  const cfg = itemTypeConfig(form.type);

  // Keys this type renders as preset slots (so loaded customFields split correctly).
  const presetKeys = useMemo(
    () => new Set(cfg.fieldGroups.flatMap((g) => g.fields.filter((f) => f.customKey).map((f) => f.customKey!))),
    [cfg]
  );

  const categoriesQ = useQuery({ queryKey: ['categories', 'all'], queryFn: async () => (await categoriesApi.list()).data });

  const applyCustomFields = (fields: CustomField[] | undefined, keys: Set<string>) => {
    const map: Record<string, string> = {};
    const extra: CustomField[] = [];
    for (const cf of fields || []) {
      if (keys.has(cf.key)) map[cf.key] = cf.value;
      else extra.push(cf);
    }
    setCustomMap(map);
    setUserFields(extra);
  };

  // Prefill from a photo scan (route param) — review-and-save flow.
  useEffect(() => {
    if (!prefill) return;
    const typeValue = ITEM_TYPES.some((t) => t.value === prefill.type) ? prefill.type! : 'other';
    set({
      name: prefill.name ?? '',
      type: typeValue,
      location: prefill.location || 'Home',
      manufacturer: prefill.manufacturer ?? '',
      modelNumber: prefill.modelNumber ?? '',
      serialNumber: prefill.serialNumber ?? '',
      purchaseDate: prefill.purchaseDate ?? '',
      warrantyExpiry: prefill.warrantyExpiry ?? '',
      notes: prefill.notes ?? '',
    });
    const keys = new Set(
      itemTypeConfig(typeValue).fieldGroups.flatMap((g) => g.fields.filter((f) => f.customKey).map((f) => f.customKey!))
    );
    applyCustomFields(prefill.customFields, keys);
  }, [prefill]);

  const itemQ = useQuery({
    queryKey: ['items', id],
    queryFn: async () => (await itemsApi.get(id!)).data,
    enabled: isEdit,
  });

  useEffect(() => {
    if (!itemQ.data) return;
    const it = itemQ.data;
    const catId = it.categoryId && typeof it.categoryId === 'object' ? it.categoryId._id : (it.categoryId as string) || null;
    set({
      name: it.name ?? '',
      type: it.type ?? 'other',
      categoryId: catId,
      location: it.location ?? 'Home',
      manufacturer: it.manufacturer ?? '',
      modelNumber: it.modelNumber ?? '',
      serialNumber: it.serialNumber ?? '',
      purchaseDate: it.purchaseDate ? it.purchaseDate.slice(0, 10) : '',
      warrantyExpiry: it.warrantyExpiry ? it.warrantyExpiry.slice(0, 10) : '',
      notes: it.notes ?? '',
    });
    const keys = new Set(
      itemTypeConfig(it.type).fieldGroups.flatMap((g) => g.fields.filter((f) => f.customKey).map((f) => f.customKey!))
    );
    applyCustomFields(it.customFields, keys);
  }, [itemQ.data]);

  useEffect(() => {
    navigation.setOptions({ title: isEdit ? 'Edit Item' : 'Add Item' });
  }, [navigation, isEdit]);

  const selectType = (typeValue: string) => {
    set({ type: typeValue });
    const catName = TYPE_CATEGORY_MATCH[typeValue];
    if (catName && !form.categoryId) {
      const cat = categoriesQ.data?.find((c) => c.name === catName);
      if (cat) set({ type: typeValue, categoryId: cat._id });
    }
    setStep(2);
  };

  const save = useMutation({
    mutationFn: () => {
      const presetFields = Object.entries(customMap)
        .filter(([, v]) => v !== undefined && v !== '')
        .map(([key, value]) => ({ key, value }));
      const extra = userFields.filter((f) => f.key.trim());
      const payload: Record<string, unknown> = {
        name: form.name,
        type: form.type,
        location: form.location,
        notes: form.notes,
        autoLookupManual: form.autoLookupManual,
        customFields: [...presetFields, ...extra],
      };
      if (form.categoryId) payload.categoryId = form.categoryId;
      if (form.manufacturer) payload.manufacturer = form.manufacturer;
      if (form.modelNumber) payload.modelNumber = form.modelNumber;
      if (form.serialNumber) payload.serialNumber = form.serialNumber;
      if (form.purchaseDate) payload.purchaseDate = form.purchaseDate;
      if (form.warrantyExpiry) payload.warrantyExpiry = form.warrantyExpiry;
      return isEdit ? itemsApi.update(id!, payload) : itemsApi.create(payload);
    },
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['items'] });
      const newId = (res.data as Item)?._id;
      if (!isEdit && newId) navigation.replace('ItemDetail', { id: newId });
      else navigation.goBack();
    },
    onError: (e: any) => setError(e.response?.data?.error || 'Save failed'),
  });

  const onSave = () => {
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    setError('');
    save.mutate();
  };

  if (isEdit && itemQ.isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  // Step 1: type picker (new items only)
  if (step === 1) {
    return (
      <Screen>
        <Text style={styles.intro}>Choose a type to add an item:</Text>
        {ITEM_TYPES.map((t) => (
          <TouchableOpacity key={t.value} activeOpacity={0.7} onPress={() => selectType(t.value)}>
            <Card style={[styles.typeRow, { borderLeftColor: t.color, borderLeftWidth: 4 }]}>
              <View style={[styles.typeAvatar, { backgroundColor: t.color }]}>
                <MaterialCommunityIcons name={mdiName(t.icon) as any} size={24} color="#fff" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.typeLabel}>{t.label}</Text>
                <Text style={styles.typeDesc}>{t.description}</Text>
              </View>
            </Card>
          </TouchableOpacity>
        ))}
      </Screen>
    );
  }

  // Step 2: type-specific form
  return (
    <Screen>
      {!isEdit ? (
        <View style={styles.typeChipRow}>
          <View style={[styles.typeChip, { backgroundColor: cfg.color }]}>
            <MaterialCommunityIcons name={mdiName(cfg.icon) as any} size={16} color="#fff" />
            <Text style={styles.typeChipText}>{cfg.label}</Text>
          </View>
          <TouchableOpacity onPress={() => setStep(1)}>
            <Text style={styles.changeType}>Change type</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      <SectionTitle>Basic Info</SectionTitle>
      <Input label={`${cfg.label} Name *`} value={form.name} onChangeText={(v) => set({ name: v })} placeholder={cfg.namePlaceholder} />
      <Input label="Location" value={form.location} onChangeText={(v) => set({ location: v })} placeholder="e.g. Home, Garage" />
      <Select
        label="Category"
        clearable
        value={form.categoryId ?? undefined}
        options={(categoriesQ.data ?? []).map((c) => ({ label: c.name, value: c._id }))}
        onChange={(v) => set({ categoryId: (v as string) ?? null })}
      />

      {cfg.fieldGroups.map((group) => (
        <View key={group.title}>
          <SectionTitle>{group.title}</SectionTitle>
          {group.fields.map((field) => (
            <FieldRenderer
              key={field.model || field.customKey}
              field={field}
              coreValue={field.model ? (form as any)[field.model] : undefined}
              customValue={field.customKey ? customMap[field.customKey] : undefined}
              onChangeCore={(v) => field.model && set({ [field.model]: v } as any)}
              onChangeCustom={(v) => field.customKey && setCustomMap((m) => ({ ...m, [field.customKey!]: v }))}
            />
          ))}
        </View>
      ))}

      <SectionTitle>Notes & Additional Fields</SectionTitle>
      <Input label="Notes" value={form.notes} onChangeText={(v) => set({ notes: v })} multiline />
      {userFields.map((f, i) => (
        <View key={i} style={styles.customRow}>
          <View style={{ flex: 1 }}>
            <Input
              placeholder="Field Name"
              value={f.key}
              onChangeText={(v) => setUserFields((arr) => arr.map((x, j) => (j === i ? { ...x, key: v } : x)))}
            />
          </View>
          <View style={{ flex: 1 }}>
            <Input
              placeholder="Value"
              value={f.value}
              onChangeText={(v) => setUserFields((arr) => arr.map((x, j) => (j === i ? { ...x, value: v } : x)))}
            />
          </View>
          <TouchableOpacity onPress={() => setUserFields((arr) => arr.filter((_, j) => j !== i))} style={styles.removeBtn}>
            <MaterialCommunityIcons name="close" size={20} color={colors.textMuted} />
          </TouchableOpacity>
        </View>
      ))}
      <Button title="+ Add Field" variant="ghost" onPress={() => setUserFields((arr) => [...arr, { key: '', value: '' }])} />

      {!isEdit ? (
        <View style={{ marginTop: spacing.md }}>
          <SwitchRow
            label="Search for the product manual after saving"
            value={form.autoLookupManual}
            onValueChange={(v) => set({ autoLookupManual: v })}
          />
        </View>
      ) : null}

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={styles.footer}>
        <Button title="Cancel" variant="ghost" onPress={() => navigation.goBack()} />
        <View style={{ flex: 1 }}>
          <Button title={isEdit ? 'Save Changes' : `Add ${cfg.label}`} loading={save.isPending} onPress={onSave} />
        </View>
      </View>
    </Screen>
  );
}

function FieldRenderer({
  field,
  coreValue,
  customValue,
  onChangeCore,
  onChangeCustom,
}: {
  field: ItemField;
  coreValue?: string;
  customValue?: string;
  onChangeCore: (v: string) => void;
  onChangeCustom: (v: string) => void;
}) {
  const value = field.model ? coreValue : customValue;
  const onChange = field.model ? onChangeCore : onChangeCustom;

  if (field.type === 'date') {
    return (
      <DateField label={field.label} clearable value={value ?? ''} onChange={onChange} />
    );
  }
  if ((field.type === 'select' || field.type === 'autocomplete') && field.options) {
    return (
      <Select
        label={field.label}
        clearable
        value={value || undefined}
        options={field.options.map((o) => ({ label: o, value: o }))}
        onChange={(v) => onChange((v as string) ?? '')}
      />
    );
  }
  return (
    <Input
      label={field.label}
      value={value ?? ''}
      onChangeText={onChange}
      placeholder={field.placeholder}
      keyboardType={field.type === 'number' ? 'numeric' : 'default'}
      multiline={field.type === 'textarea'}
    />
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  intro: { fontSize: 15, color: colors.textMuted, marginBottom: spacing.md },
  typeRow: { flexDirection: 'row', alignItems: 'center', marginBottom: spacing.sm, gap: spacing.md },
  typeAvatar: { width: 44, height: 44, borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  typeLabel: { fontSize: 16, fontWeight: '700', color: colors.text },
  typeDesc: { fontSize: 13, color: colors.textMuted, marginTop: 2 },
  typeChipRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md, marginBottom: spacing.sm },
  typeChip: { flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  typeChipText: { color: '#fff', fontWeight: '600' },
  changeType: { color: colors.primary, fontWeight: '600' },
  customRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  removeBtn: { paddingTop: 12 },
  error: { color: colors.error, marginVertical: spacing.sm },
  footer: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.xl, alignItems: 'center' },
});
