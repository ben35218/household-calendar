import React, { useLayoutEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, Alert, TouchableOpacity, Linking, Share } from 'react-native';
import { cacheDirectory, downloadAsync } from 'expo-file-system/legacy';
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
import AssistantIcon from '../../components/AssistantIcon';
import { useAiEnabled } from '../../lib/privacyPrefs';
import { recurrenceLabel, formatCalendarDate, mdiName } from '../../lib/recurrence';
import { itemTypeConfig } from '../../lib/itemTypes';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { pickDocument } from '../../lib/media';
import { uploadFile } from '../../lib/upload';
import { getHDK, newObjectId } from '../../lib/e2ee';
import { encryptFileForUpload, decryptDownloadedFile } from '../../lib/attachments';
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
  const aiEnabled = useAiEnabled();
  const { id } = useRoute<Rt>().params;
  const accent = useCalendarColors().colors.maintenance;
  const qc = useQueryClient();

  const [odomReading, setOdomReading] = useState('');
  const [odomNotes, setOdomNotes] = useState('');
  const [odoExpanded, setOdoExpanded] = useState(false);
  const [lookup, setLookup] = useState<{ state: 'idle' | 'searching' | 'done' | 'error'; candidates: ManualCandidate[]; query?: string; error?: string; quota?: boolean }>({
    state: 'idle',
    candidates: [],
  });
  const [extract, setExtract] = useState<{ manualId: string; title: string; tasks: ExtractedTask[]; selected: Set<number> } | null>(null);
  // Manual lookup shows only Claude's top pick by default; "See more options" reveals the rest.
  const [showAllManuals, setShowAllManuals] = useState(false);

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
      // E2EE (Phase 4c): when the household key is unlocked, encrypt the file
      // bytes on-device and upload the ciphertext + wrapped file key. Otherwise
      // upload plaintext as before (dual-write / non-E2EE households).
      if (getHDK()) {
        const manualId = await newObjectId();
        const sealed = await encryptFileForUpload('Manual', manualId, file.uri);
        if (sealed) {
          return uploadFile('/manuals/items/' + id + '/upload', { uri: sealed.uri, name: `${manualId}.bin`, type: 'application/octet-stream' }, 'file', {
            encrypted: true,
            _id: manualId,
            wrappedFileKey: sealed.wrappedFileKey,
            keyVersion: sealed.keyVersion,
            fileType: file.type || 'application/pdf',
            title: file.name,
          });
        }
      }
      return uploadFile('/manuals/items/' + id + '/upload', file, 'file');
    },
    onSuccess: (res) => {
      if (res) refreshItem();
    },
    onError: (e: any) => Alert.alert('Upload failed', e.response?.data?.error || 'Could not upload that file.'),
  });

  // Open a manual: encrypted ones are downloaded as ciphertext, decrypted
  // on-device to a temp file, and shared/opened; plaintext ones open directly.
  const openManual = useMutation({
    mutationFn: async (m: Manual) => {
      if (!m.encrypted) { await Linking.openURL(manualDownloadUrl(m._id)); return; }
      if (!getHDK() || !m.wrappedFileKey) throw new Error('Unlock your account to open this encrypted manual.');
      const cipherUri = `${cacheDirectory}dl-${m._id}.bin`;
      const dl = await downloadAsync(`${API_URL}/manuals/${m._id}/download`, cipherUri, {
        headers: { Authorization: `Bearer ${getCachedToken()}` },
      });
      const plainUri = await decryptDownloadedFile('Manual', m._id, m.keyVersion, m.wrappedFileKey, dl.uri, `${m.title || 'manual'}.pdf`);
      if (!plainUri) throw new Error('Could not decrypt this manual.');
      await Share.share({ url: plainUri });
    },
    onError: (e: any) => Alert.alert('Could not open manual', e?.message || 'Please try again.'),
  });

  // Preview a found candidate's PDF before committing to save it.
  const viewCandidate = async (c: ManualCandidate) => {
    try {
      await Linking.openURL(c.url);
    } catch {
      Alert.alert('Could not open', 'This link could not be opened. Try saving it instead.');
    }
  };

  const runLookup = useMutation({
    mutationFn: () => manualsApi.autoLookup(id),
    onMutate: () => {
      setShowAllManuals(false);
      setLookup({ state: 'searching', candidates: [] });
    },
    onSuccess: (res) =>
      setLookup({ state: 'done', candidates: res.data.candidates || [], query: res.data.query }),
    onError: (e: any) =>
      setLookup({
        state: 'error',
        candidates: [],
        quota: e.response?.data?.code === 'QUOTA_EXCEEDED',
        error: e.response?.data?.error || 'Search failed',
      }),
  });

  const saveCandidate = useMutation({
    mutationFn: (c: ManualCandidate) => manualsApi.fromUrl(id, { url: c.url, title: c.title || `${item?.name} Manual` }),
    onSuccess: () => {
      setShowAllManuals(false);
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
      headerTitle: () => (
        <View style={styles.headerTitleRow}>
          <View style={styles.titleSpacer} />
          <Text style={styles.headerTitleText} numberOfLines={1}>{item?.name || 'Item'}</Text>
          <View style={styles.titleActions}>
            <TouchableOpacity onPress={() => navigation.navigate('ItemForm', { id })} hitSlop={8}>
              <Ionicons name="pencil" size={17} color="#fff" />
            </TouchableOpacity>
          </View>
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
    <View style={styles.root}>
    <Screen>
      {/* Specs — hidden for vehicles (vehicle detail info is not shown here) */}
      {!isVehicle ? (
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
      ) : null}

      {item.notes ? (
        <Card style={styles.textCard}>
          <Text style={styles.overline}>Notes</Text>
          <Text style={styles.body}>{item.notes}</Text>
        </Card>
      ) : null}

      {/* Odometer (vehicles) */}
      {isVehicle ? (
        <Card style={styles.odoCard}>
          <TouchableOpacity style={styles.odoHeader} onPress={() => setOdoExpanded((v) => !v)}>
            <Text style={styles.odoTitle}>
              Odometer{odoQ.data?.currentKm != null ? ` · ${odoQ.data.currentKm.toLocaleString()} km` : ''}
            </Text>
            <Ionicons name={odoExpanded ? 'chevron-up' : 'chevron-down'} size={18} color={colors.textMuted} />
          </TouchableOpacity>
          {odoExpanded ? (
            <>
              <Divider />
              <View style={styles.odoForm}>
                <View style={styles.odoRow}>
                  <View style={{ flex: 1 }}>
                    <Input placeholder="Current reading (km)" keyboardType="numeric" value={odomReading} onChangeText={setOdomReading} />
                  </View>
                  <Button title="Log" color={accent} loading={logOdo.isPending} disabled={!odomReading} onPress={() => logOdo.mutate()} />
                </View>
                <Input placeholder="Notes (optional)" value={odomNotes} onChangeText={setOdomNotes} />
              </View>
              {odoQ.data?.logs?.length ? (
                <>
                  <Divider />
                  {odoQ.data.logs.slice(0, 5).map((log) => (
                    <ListRow
                      key={log._id}
                      icon="speedometer-outline"
                      title={`${Number(log.reading).toLocaleString()} km`}
                      subtitle={[formatCalendarDate(log.recordedAt), log.notes].filter(Boolean).join(' · ')}
                    />
                  ))}
                </>
              ) : null}
            </>
          ) : null}
        </Card>
      ) : null}

      {/* Manuals */}
      <Card style={styles.sectionCard}>
        <Text style={styles.cardTitle}>Manuals</Text>
        <Divider />
        {item.manuals?.map((m) => (
          <View key={m._id} style={styles.manualRow}>
            <View style={{ flex: 1 }}>
              <Text style={styles.manualTitle}>{m.encrypted ? '🔒 ' : ''}{m.title}</Text>
              <Text style={styles.manualSub}>
                {(m.fileSizeBytes / 1024 / 1024).toFixed(1)} MB · {m.source}
              </Text>
            </View>
            <TouchableOpacity onPress={() => openManual.mutate(m)} style={styles.iconBtn}>
              {openManual.isPending && openManual.variables?._id === m._id ? (
                <ActivityIndicator size="small" color={colors.primary} />
              ) : (
                <Ionicons name={m.encrypted ? 'lock-open-outline' : 'eye-outline'} size={20} color={colors.primary} />
              )}
            </TouchableOpacity>
            {aiEnabled ? (
              <TouchableOpacity
                onPress={() => runExtract.mutate(m)}
                style={styles.iconBtn}
                accessibilityLabel="Extract maintenance tasks with AI"
              >
                {runExtract.isPending && runExtract.variables?._id === m._id ? (
                  <ActivityIndicator size="small" color={colors.primary} />
                ) : (
                  <Ionicons name="download-outline" size={20} color={colors.primary} />
                )}
              </TouchableOpacity>
            ) : null}
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
                <Button title="Cancel" color={accent} onPress={() => setExtract(null)} />
                <View style={{ flex: 1 }}>
                  <Button
                    title={`Create ${extract.selected.size} Task${extract.selected.size === 1 ? '' : 's'}`}
                    color={accent}
                    loading={createTasks.isPending}
                    disabled={extract.selected.size === 0}
                    onPress={() => createTasks.mutate()}
                  />
                </View>
              </View>
            ) : (
              <Button title="Close" color={accent} onPress={() => setExtract(null)} />
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
            {/* Claude ranks its best pick to index 0; show only that until the user asks for more. */}
            {(showAllManuals ? lookup.candidates : lookup.candidates.slice(0, 1)).map((c, i) => (
              <View key={i} style={styles.manualRow}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.manualTitle} numberOfLines={2}>{c.title || c.domain}</Text>
                  {i === 0 && c.recommended ? <Text style={[styles.recommendedTag, { color: accent }]}>Recommended</Text> : null}
                  <Text style={styles.manualSub} numberOfLines={1}>{c.domain}</Text>
                </View>
                <View style={styles.candidateActions}>
                  <TouchableOpacity onPress={() => viewCandidate(c)} style={styles.iconBtn} accessibilityLabel="Preview manual">
                    <Ionicons name="eye-outline" size={20} color={accent} />
                  </TouchableOpacity>
                  <Button title="Save" color={accent} loading={saveCandidate.isPending && saveCandidate.variables === c} onPress={() => saveCandidate.mutate(c)} />
                </View>
              </View>
            ))}
            {!showAllManuals && lookup.candidates.length > 1 ? (
              <Button title="See more options" color={accent} onPress={() => setShowAllManuals(true)} />
            ) : null}
          </View>
        ) : null}
        {lookup.state === 'done' && lookup.candidates.length === 0 ? (
          <Text style={[styles.body, styles.pad]}>No manuals found for {lookup.query}. Try uploading one instead.</Text>
        ) : null}
        {lookup.state === 'error' && lookup.quota ? (
          <View style={styles.pad}>
            <Text style={styles.body}>{lookup.error}</Text>
            <Button title="See plans" color={accent} onPress={() => navigation.navigate('Paywall')} />
          </View>
        ) : null}
        {lookup.state === 'error' && !lookup.quota ? <Text style={[styles.body, styles.pad]}>{lookup.error}</Text> : null}

        <View style={styles.manualActions}>
          <Button title="Find" color={accent} loading={runLookup.isPending} onPress={() => runLookup.mutate()} />
          <Button title="Upload" color={accent} loading={upload.isPending} onPress={() => upload.mutate()} />
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

      <View style={styles.deleteWrap}>
        <Button title="Delete item" variant="danger" loading={del.isPending} onPress={confirmDelete} />
      </View>
    </Screen>
    {aiEnabled && (
      <TouchableOpacity
        style={[styles.fab, { backgroundColor: accent }]}
        activeOpacity={0.85}
        onPress={() => navigation.navigate('MaintenanceChat', { itemId: id, itemName: item?.name })}
      >
        <AssistantIcon size={26} color="#fff" />
      </TouchableOpacity>
    )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  headerTitleText: { color: '#fff', fontSize: 17, fontWeight: '600', flexShrink: 1 },
  // Left spacer mirrors the icon block's width so the title text stays centered on
  // screen while the pencil sits tight to its right.
  titleSpacer: { width: 25 },
  titleActions: { flexDirection: 'row', alignItems: 'center', width: 25 },
  fab: {
    position: 'absolute',
    right: spacing.lg,
    bottom: spacing.lg,
    width: 56,
    height: 56,
    borderRadius: 28,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  deleteWrap: { marginTop: spacing.sm, marginBottom: 96 },
  infoCard: { padding: 0, paddingVertical: spacing.xs, marginBottom: spacing.md },
  textCard: { marginBottom: spacing.md },
  sectionCard: { padding: 0, paddingTop: spacing.md, marginBottom: spacing.md },
  cardTitle: { fontSize: 16, fontWeight: '700', color: colors.text, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  cardTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingRight: spacing.md },
  overline: { fontSize: 12, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginBottom: spacing.sm },
  body: { fontSize: 15, color: colors.text, lineHeight: 21 },
  pad: { padding: spacing.md, gap: spacing.sm },
  odoCard: { padding: 0, marginBottom: spacing.md },
  odoHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: spacing.md, paddingHorizontal: spacing.md },
  odoTitle: { fontSize: 16, fontWeight: '700', color: colors.text },
  odoForm: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
  odoRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  manualRow: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: 4 },
  manualTitle: { fontSize: 15, fontWeight: '500', color: colors.text },
  manualSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  recommendedTag: { fontSize: 11, fontWeight: '700', color: colors.primary, textTransform: 'uppercase', marginTop: 2 },
  candidateActions: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  manualActions: { flexDirection: 'row', gap: spacing.sm, padding: spacing.md, justifyContent: 'flex-end' },
  iconBtn: { padding: 6 },
  extractRow: { flexDirection: 'row', alignItems: 'flex-start', paddingVertical: spacing.sm },
  row: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', marginTop: spacing.sm },
});
