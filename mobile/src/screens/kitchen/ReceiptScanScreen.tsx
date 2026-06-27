import React, { useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, TouchableOpacity } from 'react-native';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { inventoryApi, ReceiptExtraction } from '../../api';
import { Button, Input, Screen, SegmentedControl, Card, Select } from '../../components/ui';
import { INVENTORY_CATEGORIES } from './constants';
import { takePhoto, pickImage } from '../../lib/media';
import { uploadFile } from '../../lib/upload';
import { KitchenStackParamList } from '../../navigation/KitchenNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<KitchenStackParamList, 'ReceiptScan'>;
type Mode = 'photo' | 'text';

interface ReceiptRow {
  name: string;
  quantity?: string;
  category?: string;
  estimated_days_until_expiry?: number | null;
  selected: boolean;
}

export default function ReceiptScanScreen() {
  const navigation = useNavigation<Nav>();
  const qc = useQueryClient();
  const [mode, setMode] = useState<Mode>('photo');
  const [text, setText] = useState('');
  const [rows, setRows] = useState<ReceiptRow[] | null>(null);
  const [error, setError] = useState('');

  const apply = (data: ReceiptExtraction) =>
    setRows((data.items || []).map((i) => ({ ...i, selected: true })));

  const extractPhoto = useMutation({
    mutationFn: async (src: 'camera' | 'library') => {
      const file = src === 'camera' ? await takePhoto() : await pickImage();
      if (!file) return null;
      return uploadFile<ReceiptExtraction>('/inventory/from-receipt-photo', file, 'photo');
    },
    onSuccess: (data) => data && apply(data),
    onError: (e: any) => setError(e.response?.data?.error || 'Failed to extract items from photo'),
  });

  const extractText = useMutation({
    mutationFn: () => inventoryApi.fromText(text),
    onSuccess: (res) => apply(res.data),
    onError: (e: any) => setError(e.response?.data?.error || 'Failed to extract items'),
  });

  const saveBatch = useMutation({
    mutationFn: () => {
      const selected = (rows ?? []).filter((r) => r.selected);
      return inventoryApi.batch(
        selected.map((r) => ({
          name: r.name,
          quantity: r.quantity || '',
          category: r.category || 'other',
          purchaseDate: new Date().toISOString().slice(0, 10),
          estimated_days_until_expiry: r.estimated_days_until_expiry,
          source: mode === 'photo' ? 'receipt_photo' : 'receipt_text',
        }))
      );
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory'] });
      navigation.goBack();
    },
  });

  const busy = extractPhoto.isPending || extractText.isPending;

  // Review state
  if (rows) {
    const count = rows.filter((r) => r.selected).length;
    return (
      <Screen>
        <Text style={styles.heading}>Review items ({count} selected)</Text>
        {rows.map((r, i) => (
          <Card key={i} style={styles.reviewCard}>
            <TouchableOpacity
              style={styles.reviewHeader}
              onPress={() => setRows((rs) => rs!.map((x, j) => (j === i ? { ...x, selected: !x.selected } : x)))}
            >
              <Ionicons name={r.selected ? 'checkbox' : 'square-outline'} size={22} color={r.selected ? colors.primary : colors.textMuted} />
              <View style={styles.nameInput}>
                <Input
                  value={r.name}
                  onChangeText={(v) => setRows((rs) => rs!.map((x, j) => (j === i ? { ...x, name: v } : x)))}
                />
              </View>
              <TouchableOpacity onPress={() => setRows((rs) => rs!.filter((_, j) => j !== i))}>
                <Ionicons name="close" size={20} color={colors.textMuted} />
              </TouchableOpacity>
            </TouchableOpacity>
            <View style={styles.reviewRow}>
              <View style={{ flex: 1 }}>
                <Input
                  placeholder="Qty"
                  value={r.quantity || ''}
                  onChangeText={(v) => setRows((rs) => rs!.map((x, j) => (j === i ? { ...x, quantity: v } : x)))}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Select
                  value={r.category || 'other'}
                  options={INVENTORY_CATEGORIES}
                  onChange={(v) => setRows((rs) => rs!.map((x, j) => (j === i ? { ...x, category: (v as string) ?? 'other' } : x)))}
                />
              </View>
            </View>
          </Card>
        ))}
        <View style={styles.footer}>
          <Button title="Back" variant="ghost" onPress={() => setRows(null)} />
          <View style={{ flex: 1 }}>
            <Button title={`Add ${count} Item${count === 1 ? '' : 's'}`} loading={saveBatch.isPending} disabled={count === 0} onPress={() => saveBatch.mutate()} />
          </View>
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <SegmentedControl<Mode>
        value={mode}
        onChange={setMode}
        options={[
          { label: 'Photo', value: 'photo' },
          { label: 'Text', value: 'text' },
        ]}
      />
      <View style={{ height: spacing.md }} />

      {mode === 'photo' ? (
        <Card style={styles.photoCard}>
          <Ionicons name="receipt-outline" size={40} color={colors.textMuted} />
          <Text style={styles.hint}>Snap or pick a photo of your grocery receipt — AI extracts the items.</Text>
          {busy ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <View style={styles.photoBtns}>
              <Button title="Take Photo" onPress={() => extractPhoto.mutate('camera')} />
              <Button title="Choose Photo" variant="ghost" onPress={() => extractPhoto.mutate('library')} />
            </View>
          )}
        </Card>
      ) : (
        <>
          <Input
            label="Paste receipt text"
            value={text}
            onChangeText={setText}
            multiline
            style={{ minHeight: 160, textAlignVertical: 'top' }}
          />
          <Button title="Extract Items" loading={extractText.isPending} disabled={!text.trim()} onPress={() => extractText.mutate()} />
        </>
      )}

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  heading: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: spacing.md },
  photoCard: { alignItems: 'center', gap: spacing.md, paddingVertical: spacing.lg },
  hint: { textAlign: 'center', color: colors.textMuted, fontSize: 14 },
  photoBtns: { alignSelf: 'stretch', gap: spacing.sm },
  reviewCard: { marginBottom: spacing.sm },
  reviewHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  nameInput: { flex: 1 },
  reviewRow: { flexDirection: 'row', gap: spacing.sm },
  error: { color: colors.error, marginVertical: spacing.sm },
  footer: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.md, marginBottom: spacing.xl, alignItems: 'center' },
});
