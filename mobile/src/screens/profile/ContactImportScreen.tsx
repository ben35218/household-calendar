import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
// expo-contacts 56 deprecated its function API on the package root; the same
// functions (getContactsAsync/requestPermissionsAsync/Fields) live under /legacy.
import * as Contacts from 'expo-contacts/legacy';
import { peopleApi, ImportContact, Person } from '../../api';
import { Button, Input, SegmentedControl, SwitchRow } from '../../components/ui';
import { usePrivacyPrefs } from '../../lib/privacyPrefs';
import { ASSISTANT_NAME } from '../../config';
import { colors, spacing } from '../../theme';
import type { PersonPrefill } from '../../navigation/types';
import type { ProfileStackParamList } from '../../navigation/ProfileNavigator';

type Nav = NativeStackNavigationProp<ProfileStackParamList>;
type Method = 'direct' | 'ai';
type ApplyMode = 'auto' | 'review';

type Row = {
  key: string; // device contact id
  name: string;
  phone?: string;
  email?: string;
  birthday?: string;
  company?: string;
  selected: boolean;
  type: 'family' | 'friend'; // direct-import manual tag (AI decides its own)
  alreadyImported: boolean;
};

// The mobile-native equivalent of web PeopleView's .vcf import. Reads the device
// address book, then offers two paths — Direct (you tag each) or AI-assisted
// (Calen categorizes + pre-fills, web-searching professionals) — and lets you
// import everything at once or review each in the person form first.
//
// AI-assisted classification necessarily ships contact names/companies to the
// model, so it is consent-gated (spec: ai-assistant.md) on BOTH the AI master
// switch and the "personal & contact info in prompts" toggle. With either off,
// only Direct import is offered — the app never surfaces an AI path the server
// (requireAiEnabled) would reject or that the user has opted out of.
export default function ContactImportScreen() {
  const nav = useNavigation<Nav>();
  const qc = useQueryClient();
  const { prefs } = usePrivacyPrefs();
  // AI-assisted import needs the master switch AND permission to put contact
  // details in prompts (that's exactly what classify does).
  const aiImportAllowed = prefs.aiEnabled && prefs.aiUsePersonalInfo;

  const [status, setStatus] = useState<'loading' | 'denied' | 'ready'>('loading');
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState('');
  const [method, setMethod] = useState<Method>('ai');
  // Web-search enrichment of professionals is opt-in (spec: ai-assistant.md).
  const [enrich, setEnrich] = useState(false);
  const [applyMode, setApplyMode] = useState<ApplyMode>('review');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      const { status: perm } = await Contacts.requestPermissionsAsync();
      if (perm !== 'granted') {
        setStatus('denied');
        return;
      }
      const { data } = await Contacts.getContactsAsync({
        fields: [
          Contacts.Fields.Name,
          Contacts.Fields.PhoneNumbers,
          Contacts.Fields.Emails,
          Contacts.Fields.Birthday,
          Contacts.Fields.Company,
        ],
      });
      // Device ids of contacts already pulled in, so we can flag re-imports.
      const existing = qc.getQueryData<Person[]>(['people']) || [];
      const imported = new Set(existing.map((p) => p.deviceContactId).filter(Boolean) as string[]);

      const mapped: Row[] = data
        .filter((c) => c.name)
        .map((c) => {
          const bd = c.birthday;
          const birthday =
            bd && bd.year && bd.month != null && bd.day
              ? `${bd.year}-${String(bd.month + 1).padStart(2, '0')}-${String(bd.day).padStart(2, '0')}`
              : undefined;
          const key = c.id ?? c.name!;
          return {
            key,
            name: c.name!,
            phone: c.phoneNumbers?.[0]?.number,
            email: c.emails?.[0]?.email,
            birthday,
            company: (c as any).company || undefined,
            selected: false,
            type: 'family' as const,
            alreadyImported: imported.has(key),
          };
        });
      setRows(mapped);
      setStatus('ready');
    })();
  }, [qc]);

  // Fall back to Direct if consent is revoked (or resolves late after mount).
  useEffect(() => {
    if (!aiImportAllowed && method === 'ai') setMethod('direct');
  }, [aiImportAllowed, method]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, search]);

  const selected = rows.filter((r) => r.selected);
  const selectedCount = selected.length;
  const dupCount = selected.filter((r) => r.alreadyImported).length;
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => r.selected);

  function setRow(key: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function toggleAll() {
    const next = !allFilteredSelected;
    const keys = new Set(filtered.map((r) => r.key));
    setRows((rs) => rs.map((r) => (keys.has(r.key) ? { ...r, selected: next } : r)));
  }

  // Turn selected rows into prefills — via the AI classifier or a direct 1:1 map.
  async function buildPrefills(): Promise<PersonPrefill[]> {
    if (method === 'direct' || !aiImportAllowed) {
      return selected.map((r) => ({
        type: r.type,
        name: r.name,
        birthday: r.birthday,
        phone: r.phone,
        email: r.email,
        deviceContactId: r.key,
      }));
    }
    const contacts: ImportContact[] = selected.map((r) => ({
      key: r.key,
      name: r.name,
      phone: r.phone,
      email: r.email,
      birthday: r.birthday,
      company: r.company,
    }));
    const { data } = await peopleApi.classify(contacts, enrich);
    const byKey = new Map(data.results.map((c) => [c.key, c]));
    return selected.map((r) => {
      const c = byKey.get(r.key);
      return {
        type: c?.type ?? 'friend',
        name: c?.name || r.name,
        relationship: c?.relationship,
        businessName: c?.businessName,
        birthday: c?.birthday || r.birthday,
        address: c?.address,
        notes: c?.notes,
        interests: c?.interests,
        phone: c?.phone || r.phone,
        email: c?.email || r.email,
        deviceContactId: r.key,
      };
    });
  }

  async function proceed() {
    if (!selectedCount) return;
    setBusy(true);
    try {
      const prefills = await buildPrefills();
      if (applyMode === 'review') {
        // Step through the person form for each, starting at the first.
        nav.replace('PersonForm', { prefills, queueIndex: 0 });
        return;
      }
      await peopleApi.bulk(prefills.map((p) => ({ ...p })));
      qc.invalidateQueries({ queryKey: ['people'] });
      nav.goBack();
    } catch (e: any) {
      Alert.alert('Import failed', e?.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  function onConfirm() {
    if (dupCount > 0) {
      Alert.alert(
        'Possible duplicates',
        `${dupCount} of the selected contact${dupCount !== 1 ? 's were' : ' was'} already imported before. Import ${dupCount !== 1 ? 'them' : 'it'} again anyway?`,
        [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Import anyway', onPress: proceed },
        ]
      );
      return;
    }
    proceed();
  }

  if (status === 'loading') {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  if (status === 'denied') {
    return (
      <View style={styles.center}>
        <Ionicons name="lock-closed-outline" size={40} color={colors.textMuted} />
        <Text style={styles.deniedText}>
          Contacts access is off. Enable it in Settings to import family and friends.
        </Text>
      </View>
    );
  }

  const busyLabel =
    method === 'ai' && aiImportAllowed && applyMode !== 'review'
      ? `${ASSISTANT_NAME} is sorting…`
      : applyMode === 'review'
      ? `Review ${selectedCount}`
      : `Import ${selectedCount} contact${selectedCount !== 1 ? 's' : ''}`;

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
        {aiImportAllowed ? (
          <View style={styles.selectorRow}>
            <SegmentedControl
              value={method}
              options={[
                { label: 'AI-assisted', value: 'ai' },
                { label: 'Direct', value: 'direct' },
              ]}
              onChange={(v) => setMethod(v as Method)}
            />
          </View>
        ) : null}
        <Text style={styles.selectorHint}>
          {!aiImportAllowed
            ? `AI-assisted sorting is off because ${
                prefs.aiEnabled
                  ? '“Use personal & contact info in prompts” is'
                  : '“Use AI features” is'
              } turned off in Privacy & data. Tag each contact yourself; details come straight from your phone.`
            : method === 'ai'
            ? `${ASSISTANT_NAME} sorts each into Family / Friends / Professionals from names and companies only — phone numbers, emails, and birthdays stay on your device.`
            : 'Tag each contact yourself; details come straight from your phone.'}
        </Text>
        {aiImportAllowed && method === 'ai' ? (
          <>
            <SwitchRow
              label="Look up professionals on the web"
              value={enrich}
              onValueChange={setEnrich}
              color={colors.primary}
            />
            <Text style={styles.selectorHint}>
              {enrich
                ? 'Business names, addresses, and phone numbers may be sent to a web search to verify and complete professional contacts.'
                : 'Professionals are sorted without any web lookup — nothing about them leaves the AI request.'}
            </Text>
          </>
        ) : null}
        <View style={styles.selectorRow}>
          <SegmentedControl
            value={applyMode}
            options={[
              { label: 'Review each', value: 'review' },
              { label: 'Import all', value: 'auto' },
            ]}
            onChange={(v) => setApplyMode(v as ApplyMode)}
          />
        </View>

        <Input value={search} onChangeText={setSearch} placeholder="Search contacts" style={styles.search} />
        <View style={styles.toolbarRow}>
          <TouchableOpacity onPress={toggleAll}>
            <Text style={styles.selectAll}>{allFilteredSelected ? 'Deselect all' : 'Select all'}</Text>
          </TouchableOpacity>
          <Text style={styles.count}>{selectedCount} selected</Text>
        </View>
      </View>

      <FlatList
        data={filtered}
        keyExtractor={(r) => r.key}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <View style={styles.row}>
            <TouchableOpacity onPress={() => setRow(item.key, { selected: !item.selected })} style={styles.check}>
              <Ionicons
                name={item.selected ? 'checkbox' : 'square-outline'}
                size={22}
                color={item.selected ? colors.primary : colors.textMuted}
              />
            </TouchableOpacity>
            <View style={styles.rowText}>
              <View style={styles.rowNameLine}>
                <Text style={styles.rowName} numberOfLines={1}>
                  {item.name}
                </Text>
                {item.alreadyImported ? <Text style={styles.importedBadge}>Imported</Text> : null}
              </View>
              <Text style={styles.rowSub} numberOfLines={1}>
                {[item.company, item.phone, item.email, item.birthday ? `🎂 ${item.birthday}` : null]
                  .filter(Boolean)
                  .join('  ·  ')}
              </Text>
            </View>
            {item.selected && method === 'direct' ? (
              <View style={styles.typeToggle}>
                <SegmentedControl
                  value={item.type}
                  options={[
                    { label: 'Family', value: 'family' },
                    { label: 'Friend', value: 'friend' },
                  ]}
                  onChange={(v) => setRow(item.key, { type: v as 'family' | 'friend' })}
                />
              </View>
            ) : null}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No contacts found.</Text>}
      />

      <View style={styles.footer}>
        {dupCount > 0 ? (
          <Text style={styles.dupWarn}>
            {dupCount} selected already imported — importing again may create duplicates.
          </Text>
        ) : null}
        <Button title={busyLabel} onPress={onConfirm} loading={busy} disabled={selectedCount === 0} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.background },
  deniedText: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.md, lineHeight: 20 },
  toolbar: { padding: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  selectorRow: { marginBottom: spacing.sm },
  selectorHint: { fontSize: 12, color: colors.textMuted, lineHeight: 17, marginBottom: spacing.md },
  search: { marginBottom: 0, marginTop: spacing.xs },
  toolbarRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: spacing.sm },
  selectAll: { color: colors.primary, fontWeight: '600', fontSize: 14 },
  count: { color: colors.textMuted, fontSize: 13 },
  list: { padding: spacing.md },
  row: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: colors.surface,
    borderRadius: 12, padding: spacing.sm, marginBottom: spacing.sm,
  },
  check: { padding: 4 },
  rowText: { flex: 1, minWidth: 0, marginLeft: spacing.sm },
  rowNameLine: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowName: { flexShrink: 1, fontSize: 15, fontWeight: '600', color: colors.text },
  importedBadge: {
    fontSize: 10, fontWeight: '700', color: colors.warning,
    backgroundColor: colors.warning + '22', paddingHorizontal: 6, paddingVertical: 1,
    borderRadius: 5, overflow: 'hidden',
  },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  typeToggle: { width: 150, marginLeft: spacing.sm },
  emptyText: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl },
  footer: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
  dupWarn: { fontSize: 12, color: colors.warning, marginBottom: spacing.sm, textAlign: 'center' },
});
