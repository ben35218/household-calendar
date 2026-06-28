import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { peopleApi, settingsApi, Person } from '../../api';
import { Button, Card, Input, DateField, SegmentedControl } from '../../components/ui';
import PlacesAutocomplete from '../../components/PlacesAutocomplete';
import { colors, spacing } from '../../theme';
import type { ProfileStackParamList } from '../../navigation/ProfileNavigator';

type R = RouteProp<ProfileStackParamList, 'PersonForm'>;

// Mirrors the add/edit dialog in client/src/views/PeopleView.vue. For the "You"
// card, name/birthday/address are managed in Account, so only interests + notes
// are editable here.
export default function PersonFormScreen() {
  const nav = useNavigation();
  const qc = useQueryClient();
  const { params } = useRoute<R>();
  const { id, isSelf } = params || {};

  const people = qc.getQueryData<Person[]>(['people']) || [];
  const editing = id ? people.find((p) => p._id === id) : undefined;

  const { data: settings } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await settingsApi.get()).data,
  });
  const homeAddress = settings?.homeAddress ?? '';

  const [type, setType] = useState<'family' | 'friend'>(
    (editing?.type as 'family' | 'friend') || 'family'
  );
  const [form, setForm] = useState({
    name: editing?.name ?? '',
    relationship: editing?.relationship ?? '',
    birthday: editing?.birthday ? String(editing.birthday).slice(0, 10) : '',
    address: editing?.address ?? (!editing && !isSelf ? homeAddress : ''),
    notes: editing?.notes ?? '',
    phone: editing?.phone ?? '',
    email: editing?.email ?? '',
  });
  const [interests, setInterests] = useState<string[]>(editing?.interests ? [...editing.interests] : []);
  const [interestDraft, setInterestDraft] = useState('');
  const [saving, setSaving] = useState(false);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));
  const canDelete = !!editing?._id && !editing.accountId;

  function addInterest() {
    const v = interestDraft.trim();
    if (v && !interests.includes(v)) setInterests((arr) => [...arr, v]);
    setInterestDraft('');
  }

  async function save() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        type,
        name: form.name.trim(),
        relationship: form.relationship.trim() || undefined,
        birthday: form.birthday || undefined,
        address: form.address.trim() || undefined,
        interests: interests.filter(Boolean),
        notes: form.notes.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
      };
      if (editing?._id) await peopleApi.update(editing._id, payload);
      else await peopleApi.create(payload);
      qc.invalidateQueries({ queryKey: ['people'] });
      nav.goBack();
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  function remove() {
    if (!editing?._id) return;
    Alert.alert(`Remove ${editing.name}?`, 'This will permanently remove them from your list.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Remove',
        style: 'destructive',
        onPress: async () => {
          await peopleApi.delete(editing._id);
          qc.invalidateQueries({ queryKey: ['people'] });
          nav.goBack();
        },
      },
    ]);
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        {!isSelf ? (
          <View style={styles.typeRow}>
            <SegmentedControl
              value={type}
              options={[
                { label: 'Family', value: 'family' },
                { label: 'Friend', value: 'friend' },
              ]}
              onChange={(v) => setType(v)}
            />
          </View>
        ) : null}

        <Input label="Name" value={form.name} onChangeText={set('name')} editable={!isSelf} />
        {isSelf ? (
          <Text style={styles.hint}>Your name, birthday and home address are managed in Account.</Text>
        ) : (
          <>
            <Input
              label={type === 'family' ? 'Relationship (e.g. spouse, daughter)' : 'How you know them (e.g. neighbor)'}
              value={form.relationship}
              onChangeText={set('relationship')}
            />
            <DateField label="Birthday (optional)" value={form.birthday} onChange={set('birthday')} clearable />
            <PlacesAutocomplete
              label="Address (optional)"
              value={form.address}
              onChangeText={set('address')}
              placeholder="123 Main St, Toronto, ON"
              type="address"
            />
          </>
        )}

        <Text style={styles.fieldLabel}>Interests / hobbies</Text>
        <View style={styles.tagInputRow}>
          <View style={styles.tagInputWrap}>
            <Input
              value={interestDraft}
              onChangeText={setInterestDraft}
              placeholder="e.g. hockey, hiking"
              onSubmitEditing={addInterest}
              returnKeyType="done"
            />
          </View>
          <Button title="Add" variant="ghost" onPress={addInterest} />
        </View>
        {interests.length > 0 ? (
          <View style={styles.tags}>
            {interests.map((i) => (
              <TouchableOpacity
                key={i}
                style={styles.tag}
                onPress={() => setInterests((arr) => arr.filter((x) => x !== i))}
              >
                <Text style={styles.tagText}>{i}</Text>
                <Ionicons name="close" size={14} color={colors.primary} />
              </TouchableOpacity>
            ))}
          </View>
        ) : null}

        <Input
          label="Notes for AI (optional)"
          value={form.notes}
          onChangeText={set('notes')}
          multiline
          numberOfLines={3}
          style={styles.notes}
        />

        {!isSelf ? (
          <>
            <Input label="Phone (optional)" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" />
            <Input label="Email (optional)" value={form.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" />
          </>
        ) : null}
      </Card>

      <Button title="Save" onPress={save} loading={saving} disabled={!form.name.trim()} />
      {canDelete ? <Button title="Delete" variant="danger" onPress={remove} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  card: { marginBottom: spacing.md },
  typeRow: { marginBottom: spacing.md },
  hint: { fontSize: 12, color: colors.textMuted, marginTop: -4, marginBottom: spacing.sm },
  fieldLabel: { fontSize: 13, fontWeight: '600', color: colors.text, marginBottom: 4, marginTop: 4 },
  tagInputRow: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.sm },
  tagInputWrap: { flex: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.sm },
  tag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: colors.primary, borderRadius: 16,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  tagText: { color: colors.primary, fontSize: 13, fontWeight: '500' },
  notes: { height: 80, textAlignVertical: 'top' },
});
