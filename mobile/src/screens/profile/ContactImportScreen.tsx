import React, { useEffect, useMemo, useState } from 'react';
import { View, Text, FlatList, StyleSheet, TouchableOpacity, ActivityIndicator } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import * as Contacts from 'expo-contacts';
import { peopleApi } from '../../api';
import { Button, Input, SegmentedControl } from '../../components/ui';
import { colors, spacing } from '../../theme';

type Row = {
  key: string;
  name: string;
  phone?: string;
  email?: string;
  birthday?: string;
  selected: boolean;
  type: 'family' | 'friend';
};

// The mobile-native equivalent of web PeopleView's .vcf "Import Contacts": reads
// the device address book, lets the user pick + tag each as Family/Friend, then
// peopleApi.bulk (same endpoint as web).
export default function ContactImportScreen() {
  const nav = useNavigation();
  const qc = useQueryClient();

  const [status, setStatus] = useState<'loading' | 'denied' | 'ready'>('loading');
  const [rows, setRows] = useState<Row[]>([]);
  const [search, setSearch] = useState('');
  const [importing, setImporting] = useState(false);

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
        ],
      });
      const mapped: Row[] = data
        .filter((c) => c.name)
        .map((c) => {
          const bd = c.birthday;
          const birthday =
            bd && bd.year && bd.month != null && bd.day
              ? `${bd.year}-${String(bd.month + 1).padStart(2, '0')}-${String(bd.day).padStart(2, '0')}`
              : undefined;
          return {
            key: c.id ?? c.name!,
            name: c.name!,
            phone: c.phoneNumbers?.[0]?.number,
            email: c.emails?.[0]?.email,
            birthday,
            selected: false,
            type: 'family' as const,
          };
        });
      setRows(mapped);
      setStatus('ready');
    })();
  }, []);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => r.name.toLowerCase().includes(q));
  }, [rows, search]);

  const selectedCount = rows.filter((r) => r.selected).length;
  const allFilteredSelected = filtered.length > 0 && filtered.every((r) => r.selected);

  function setRow(key: string, patch: Partial<Row>) {
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  }

  function toggleAll() {
    const next = !allFilteredSelected;
    const keys = new Set(filtered.map((r) => r.key));
    setRows((rs) => rs.map((r) => (keys.has(r.key) ? { ...r, selected: next } : r)));
  }

  async function confirmImport() {
    setImporting(true);
    try {
      const selected = rows.filter((r) => r.selected);
      await peopleApi.bulk(
        selected.map((r) => ({
          type: r.type,
          name: r.name,
          phone: r.phone || undefined,
          email: r.email || undefined,
          birthday: r.birthday || undefined,
        }))
      );
      qc.invalidateQueries({ queryKey: ['people'] });
      nav.goBack();
    } finally {
      setImporting(false);
    }
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

  return (
    <View style={styles.container}>
      <View style={styles.toolbar}>
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
              <Text style={styles.rowName}>{item.name}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {[item.phone, item.email, item.birthday ? `🎂 ${item.birthday}` : null]
                  .filter(Boolean)
                  .join('  ·  ')}
              </Text>
            </View>
            {item.selected ? (
              <View style={styles.typeToggle}>
                <SegmentedControl
                  value={item.type}
                  options={[
                    { label: 'Family', value: 'family' },
                    { label: 'Friend', value: 'friend' },
                  ]}
                  onChange={(v) => setRow(item.key, { type: v })}
                />
              </View>
            ) : null}
          </View>
        )}
        ListEmptyComponent={<Text style={styles.emptyText}>No contacts found.</Text>}
      />

      <View style={styles.footer}>
        <Button
          title={`Import ${selectedCount} contact${selectedCount !== 1 ? 's' : ''}`}
          onPress={confirmImport}
          loading={importing}
          disabled={selectedCount === 0}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: spacing.lg, backgroundColor: colors.background },
  deniedText: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.md, lineHeight: 20 },
  toolbar: { padding: spacing.md, backgroundColor: colors.surface, borderBottomWidth: 1, borderBottomColor: colors.border },
  search: { marginBottom: 0 },
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
  rowName: { fontSize: 15, fontWeight: '600', color: colors.text },
  rowSub: { fontSize: 12, color: colors.textMuted, marginTop: 2 },
  typeToggle: { width: 150, marginLeft: spacing.sm },
  emptyText: { textAlign: 'center', color: colors.textMuted, marginTop: spacing.xl },
  footer: { padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border, backgroundColor: colors.surface },
});
