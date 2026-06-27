import React, { useLayoutEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TouchableOpacity, Linking } from 'react-native';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import {
  itemsApi,
  manualsApi,
  tasksApi,
  odometerApi,
  Manual,
  ManualCandidate,
  ExtractedTask,
  Task,
} from '../../api';
import { Button, Card, Screen, Divider, ListRow, Input } from '../../components/ui';
import { recurrenceLabel, formatCalendarDate, mdiName } from '../../lib/recurrence';
import { itemTypeConfig } from '../../lib/itemTypes';
import { pickDocument } from '../../lib/media';
import { uploadFile } from '../../lib/upload';
import { API_URL } from '../../config';
import { getCachedToken } from '../../lib/secureToken';
import { MaintenanceStackParamList } from '../../navigation/MaintenanceNavigator';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<MaintenanceStackParamList, 'ItemDetail'>;
type Rt = RouteProp<MaintenanceStackParamList, 'ItemDetail'>;

function manualDownloadUrl(id: string) {
  return `${API_URL}/manuals/${id}/download?token=${getCachedToken()}`;
}

export default function ItemDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { id } = useRoute<Rt>().params;
  const qc = useQueryClient();

  const [odomReading, setOdomReading] = useState('');
  const [odomNotes, setOdomNotes] = useState('');
  const [lookup, setLookup] = useState<{ state: 'idle' | 'searching' | 'done' | 'error'; candidates: ManualCandidate[]; query?: string; error?: string }>({
    state: 'idle',
    candidates: [],
  });
  const [extract, setExtract] = useState<{ manualId: string; title: string; tasks: ExtractedTask[]; selected: Set<number> } | null>(null);

  const itemQ = useQuery({ queryKey: ['items', id], queryFn: async () => (await itemsApi.get(id)).data });
  const item = itemQ.data;
  const isVehicle = item?.type === 'vehicle';

  const tasksQ = useQuery({ queryKey: ['tasks', 'forItem', id], queryFn: async () => (await tasksApi.list({ item: id })).data });
  const odoQ = useQuery({
    queryKey: ['odometer', id],
    queryFn: async () => (await odometerApi.get(id)).data,
    enabled: isVehicle,
  });

  const refreshItem = () => qc.invalidateQueries({ queryKey: ['items', id] });

  const del = useMutation({
    mutationFn: () => itemsApi.delete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['items'] });
      navigation.goBack();
    },
  });

  const logOdo = useMutation({
    mutationFn: () => odometerApi.log(id, { reading: Number(odomReading), notes: odomNotes }),
    onSuccess: () => {
      setOdomReading('');
      setOdomNotes('');
      qc.invalidateQueries({ queryKey: ['odometer', id] });
      refreshItem();
    },
  });

  const upload = useMutation({
    mutationFn: async () => {
      const file = await pickDocument();
      if (!file) return null;
      return uploadFile('/manuals/items/' + id + '/upload', file, 'file');
    },
    onSuccess: (res) => {
      if (res) refreshItem();
    },
    onError: (e: any) => Alert.alert('Upload failed', e.response?.data?.error || 'Could not upload that file.'),
  });

  const runLookup = useMutation({
    mutationFn: () => manualsApi.autoLookup(id),
    onMutate: () => setLookup({ state: 'searching', candidates: [] }),
    onSuccess: (res) =>
      setLookup({ state: 'done', candidates: res.data.candidates || [], query: res.data.query }),
    onError: (e: any) => setLookup({ state: 'error', candidates: [], error: e.response?.data?.error || 'Search failed' }),
  });

  const saveCandidate = useMutation({
    mutationFn: (c: ManualCandidate) => manualsApi.fromUrl(id, { url: c.url, title: c.title || `${item?.name} Manual` }),
    onSuccess: () => {
      setLookup({ state: 'idle', candidates: [] });
      refreshItem();
    },
    onError: (e: any) => Alert.alert('Could not save', e.response?.data?.error || 'Try another or upload manually.'),
  });

  const delManual = useMutation({
    mutationFn: (mid: string) => manualsApi.delete(mid),
    onSuccess: refreshItem,
  });

  const runExtract = useMutation({
    mutationFn: (m: Manual) => manualsApi.extractTasks(m._id),
    onSuccess: (res, m) =>
      setExtract({
        manualId: m._id,
        title: res.data.manualTitle || m.title,
        tasks: res.data.tasks || [],
        selected: new Set((res.data.tasks || []).map((_, i) => i)),
      }),
    onError: (e: any) => Alert.alert('Extract failed', e.response?.data?.error || 'Could not extract tasks.'),
  });

  const createTasks = useMutation({
    mutationFn: () => {
      const tasks = extract!.tasks.filter((_, i) => extract!.selected.has(i));
      return manualsApi.createTasks(extract!.manualId, {
        tasks,
        itemId: id,
        currentKm: odoQ.data?.currentKm ?? undefined,
      });
    },
    onSuccess: () => {
      setExtract(null);
      qc.invalidateQueries({ queryKey: ['tasks'] });
    },
  });

  const confirmDelete = () =>
    Alert.alert('Delete item?', `Permanently delete "${item?.name}" and its manuals?`, [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => del.mutate() },
    ]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: item?.name || 'Item',
      headerRight: () => (
        <View style={styles.headerActions}>
          <TouchableOpacity onPress={() => navigation.navigate('ItemForm', { id })} style={styles.headerBtn}>
            <Ionicons name="create-outline" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={confirmDelete} style={styles.headerBtn}>
            <Ionicons name="trash-outline" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation, id, item?.name]);

  if (itemQ.isLoading || !item) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const cfg = itemTypeConfig(item.type);

  return (
    <Screen>
      {/* Specs */}
      <Card style={styles.infoCard}>
        {item.location ? <ListRow icon="location-outline" title="Location" subtitle={item.location} /> : null}
        {item.manufacturer ? <ListRow icon="business-outline" title="Manufacturer" subtitle={item.manufacturer} /> : null}
        {item.modelNumber ? <ListRow icon="barcode-outline" title="Model" subtitle={item.modelNumber} /> : null}
        {item.serialNumber ? <ListRow icon="finger-print-outline" title="Serial" subtitle={item.serialNumber} /> : null}
        {item.purchaseDate ? <ListRow icon="calendar-outline" title="Purchased" subtitle={formatCalendarDate(item.purchaseDate)} /> : null}
        {item.warrantyExpiry ? <ListRow icon="shield-outline" title="Warranty until" subtitle={formatCalendarDate(item.warrantyExpiry)} /> : null}
        {(item.customFields ?? []).filter((f) => f.value).map((f) => (
          <ListRow key={f.key} icon="ellipse-outline" title={f.key} subtitle={f.value} />
        ))}
      </Card>

      {item.notes ? (
        <Card style={styles.textCard}>
          <Text style={styles.overline}>Notes</Text>
          <Text style={styles.body}>{item.notes}</Text>
        </Card>
      ) : null}

      {/* Odometer (vehicles) */}
      {isVehicle ? (
        <Card style={styles.sectionCard}>
          <Text style={styles.cardTitle}>
            Odometer{odoQ.data?.currentKm != null ? ` · ${odoQ.data.currentKm.toLocaleString()} km` : ''}
          </Text>
          <Divider />
          {odoQ.data?.logs?.slice(0, 5).map((log) => (
            <ListRow
              key={log._id}
              icon="speedometer-outline"
              title={`${Number(log.reading).toLocaleString()} km`}
              subtitle={[formatCalendarDate(log.recordedAt), log.notes].filter(Boolean).join(' · ')}
            />
          ))}
          <View style={styles.pad}>
            <Input label="Current reading (km)" keyboardType="numeric" value={odomReading} onChangeText={setOdomReading} />
            <Input label="Notes (optional)" value={odomNotes} onChangeText={setOdomNotes} />
            <Button title="Log Reading" loading={logOdo.isPending} disabled={!odomReading} onPress={() => logOdo.mutate()} />
          </View>
        </Card>
      ) : null}

      {/* Manuals */}
      <Card style={styles.sectionCard}>
        <Text style={styles.cardTitle}>Manuals</Text>
        <Divider />
        {item.manuals?.map((m) => (
          <View key={m._id} style={styles.manualRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.manualTitle}>{m.title}</Text>
              <Text style={styles.manualSub}>
                {(m.fileSizeBytes / 1024 / 1024).toFixed(1)} MB · {m.source}
              </Text>
            </View>
            <TouchableOpacity onPress={() => Linking.openURL(manualDownloadUrl(m._id))} style={styles.iconBtn}>
              <Ionicons name="eye-outline" size={20} color={colors.primary} />
            </TouchableOpacity>
            <TouchableOpacity onPress={() => runExtract.mutate(m)} style={styles.iconBtn}>
              {runExtract.isPending && runExtract.variables?._id === m._id ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name="list-outline" size={20} color={colors.primary} />
              )}
            </TouchableOpacity>
            <TouchableOpacity onPress={() => delManual.mutate(m._id)} style={styles.iconBtn}>
              <Ionicons name="trash-outline" size={20} color={colors.error} />
            </TouchableOpacity>
          </View>
        ))}

        {/* Extracted tasks review */}
        {extract ? (
          <View style={styles.pad}>
            <Text style={styles.overline}>Tasks from {extract.title}</Text>
            {extract.tasks.length === 0 ? (
              <Text style={styles.body}>No maintenance schedule found.</Text>
            ) : (
              extract.tasks.map((t, i) => {
                const on = extract.selected.has(i);
                return (
                  <TouchableOpacity
                    key={i}
                    style={styles.extractRow}
                    onPress={() =>
                      setExtract((e) => {
                        if (!e) return e;
                        const sel = new Set(e.selected);
                        on ? sel.delete(i) : sel.add(i);
                        return { ...e, selected: sel };
                      })
                    }
                  >
                    <Ionicons name={on ? 'checkbox' : 'square-outline'} size={20} color={on ? colors.primary : colors.textMuted} />
                    <View style={{ flex: 1, marginLeft: spacing.sm }}>
                      <Text style={styles.body}>{t.title}</Text>
                      <Text style={styles.manualSub}>{recurrenceLabel(t.recurrence)}</Text>
                    </View>
                  </TouchableOpacity>
                );
              })
            )}
            {extract.tasks.length > 0 ? (
              <View style={styles.row}>
                <Button title="Cancel" variant="ghost" onPress={() => setExtract(null)} />
                <View style={{ flex: 1 }}>
                  <Button
                    title={`Create ${extract.selected.size} Task${extract.selected.size === 1 ? '' : 's'}`}
                    loading={createTasks.isPending}
                    disabled={extract.selected.size === 0}
                    onPress={() => createTasks.mutate()}
                  />
                </View>
              </View>
            ) : (
              <Button title="Close" variant="ghost" onPress={() => setExtract(null)} />
            )}
          </View>
        ) : null}

        {/* Lookup */}
        {lookup.state === 'searching' ? (
          <View style={styles.pad}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : null}
        {lookup.state === 'done' && lookup.candidates.length > 0 ? (
          <View style={styles.pad}>
            <Text style={styles.overline}>Found for {lookup.query}</Text>
            {lookup.candidates.map((c, i) => (
              <View key={i} style={styles.manualRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.manualTitle}>{c.title || c.domain}</Text>
                  <Text style={styles.manualSub} numberOfLines={1}>{c.domain}</Text>
                </View>
                <Button title="Save" variant="ghost" loading={saveCandidate.isPending && saveCandidate.variables === c} onPress={() => saveCandidate.mutate(c)} />
              </View>
            ))}
          </View>
        ) : null}
        {lookup.state === 'error' ? <Text style={[styles.body, styles.pad]}>{lookup.error}</Text> : null}

        <View style={styles.manualActions}>
          <Button title="Find" variant="ghost" loading={runLookup.isPending} onPress={() => runLookup.mutate()} />
          <Button title="Upload" variant="ghost" loading={upload.isPending} onPress={() => upload.mutate()} />
        </View>
      </Card>

      {/* Related tasks */}
      <Card style={styles.sectionCard}>
        <View style={styles.cardTitleRow}>
          <Text style={styles.cardTitle}>Maintenance Tasks</Text>
          <TouchableOpacity onPress={() => navigation.navigate('TaskForm', {})}>
            <Ionicons name="add-circle-outline" size={24} color={colors.primary} />
          </TouchableOpacity>
        </View>
        <Divider />
        {tasksQ.data?.length ? (
          tasksQ.data.map((t: Task) => (
            <ListRow
              key={t._id}
              icon="construct-outline"
              title={t.title}
              subtitle={recurrenceLabel(t.recurrence)}
              onPress={() => navigation.navigate('TaskDetail', { id: t._id })}
            />
          ))
        ) : (
          <Text style={[styles.body, styles.pad]}>No tasks linked</Text>
        )}
      </Card>

      <Button
        title="Ask the Maintenance Assistant"
        variant="ghost"
        onPress={() => navigation.navigate('MaintenanceChat', { itemId: id, itemName: item?.name })}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  headerActions: { flexDirection: 'row' },
  headerBtn: { paddingHorizontal: 6 },
  infoCard: { padding: 0, paddingVertical: spacing.xs, marginBottom: spacing.md },
  textCard: { marginBottom: spacing.md },
  sectionCard: { padding: 0, paddingTop: spacing.md, marginBottom: spacing.md },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: spacing.md },
  overline: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginBottom: spacing.sm },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  pad: { padding: spacing.md, gap: spacing.sm },
  manualRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 4 },
  manualTitle: { fontSize: 15, fontWeight: '500', color: colors.text },
  manualSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  manualActions: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, justifyContent: 'flex-end' },
  iconBtn: { padding: 6 },
  extractRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginTop: spacing.sm },
});
