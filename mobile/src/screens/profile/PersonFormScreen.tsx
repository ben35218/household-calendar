import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { peopleApi, placesApi, Person, FormAssistField, PlacePrediction } from '../../api';
import { sealNew, sealUpdate } from '../../lib/e2ee';

// Encrypted person content (type/birthday stay plaintext during dual-write).
const PERSON_ENC = (p: Record<string, unknown>) => ({
  name: p.name, relationship: p.relationship, interests: p.interests,
  notes: p.notes, address: p.address, phone: p.phone, email: p.email,
  birthday: p.birthday, // encrypted now (§9.1 P6): cron gated (P3), calendar reads decrypted (P2)
});
import { Button, Card, Input, DateField, SegmentedControl, useHeaderCheckButton } from '../../components/ui';
import FormAssist from '../../components/FormAssist';
import { useFormAssist } from '../../hooks/useFormAssist';
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
  const { id, isSelf, type: initialType } = params || {};

  const people = qc.getQueryData<Person[]>(['people']) || [];
  const editing = id ? people.find((p) => p._id === id) : undefined;

  const [type, setType] = useState<'family' | 'friend' | 'service'>(
    (editing?.type as 'family' | 'friend' | 'service') || initialType || 'family'
  );
  const isService = type === 'service';
  const [form, setForm] = useState({
    name: editing?.name ?? '',
    relationship: editing?.relationship ?? '',
    birthday: editing?.birthday ? String(editing.birthday).slice(0, 10) : '',
    address: editing?.address ?? '',
    notes: editing?.notes ?? '',
    phone: editing?.phone ?? '',
    email: editing?.email ?? '',
  });
  const [interests, setInterests] = useState<string[]>(editing?.interests ? [...editing.interests] : []);
  const [interestDraft, setInterestDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const assist = useFormAssist();

  const set = (k: keyof typeof form) => (v: string) => {
    setForm((f) => ({ ...f, [k]: v }));
    assist.clear([k]);
  };
  const canDelete = !!editing?._id && !editing.accountId;

  // Schema the AI form assistant fills. Names match the form-state keys, plus
  // `interests` which merges into the interest tag list.
  const assistFields: FormAssistField[] = [
    { name: 'name', type: 'text', label: 'Name' },
    { name: 'relationship', type: 'text', label: 'Relationship / how you know them' },
    { name: 'birthday', type: 'date', label: 'Birthday' },
    { name: 'address', type: 'text', label: 'Address' },
    { name: 'interests', type: 'multiselect', label: 'Interests / hobbies' },
    { name: 'notes', type: 'text', label: 'Notes' },
    { name: 'phone', type: 'text', label: 'Phone' },
    { name: 'email', type: 'text', label: 'Email' },
  ];

  const applyPatch = (patch: Record<string, unknown>) => {
    const nextForm: Partial<typeof form> = {};
    const changedKeys: string[] = [];
    for (const [k, v] of Object.entries(patch)) {
      if (k === 'interests') {
        if (Array.isArray(v)) {
          const additions = v.map((x) => String(x).trim()).filter(Boolean);
          setInterests((prev) => Array.from(new Set([...prev, ...additions])));
          changedKeys.push('interests');
        }
        continue;
      }
      if (!(k in form)) continue;
      const val = v == null ? '' : String(v);
      if ((form as any)[k] !== val) changedKeys.push(k);
      (nextForm as any)[k] = val;
    }
    setForm((f) => ({ ...f, ...nextForm }));
    assist.mark(changedKeys);
  };

  // For service contacts, picking a business from the address dropdown pulls its
  // phone number from Google Places details and fills the Phone field.
  async function onServiceSelect(p: PlacePrediction) {
    try {
      const { data } = await placesApi.getDetails(p.place_id);
      const phone = data?.result?.formatted_phone_number || data?.result?.international_phone_number;
      if (phone) {
        setForm((f) => ({ ...f, phone }));
        assist.mark(['phone']);
      }
    } catch {
      // Details lookup is best-effort; leave phone untouched on failure.
    }
  }

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
      if (editing?._id) await peopleApi.update(editing._id, await sealUpdate('Person', editing._id, payload, PERSON_ENC(payload)));
      else await peopleApi.create(await sealNew('Person', payload, PERSON_ENC(payload)));
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

  useHeaderCheckButton(nav, { onPress: save, loading: saving, color: colors.primary, disabled: !form.name.trim() });

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {!isSelf ? (
        <>
          <FormAssist
            formType="person / contact"
            title="AI Assistant"
            placeholder={'Describe the person, e.g. "my sister Sarah, birthday June 3, loves hiking and photography"'}
            fields={assistFields}
            current={{ ...form, interests }}
            onApply={applyPatch}
          />
          <TouchableOpacity style={styles.importRow} onPress={() => (nav as any).navigate('ContactImport')}>
            <Ionicons name="people-outline" size={18} color={colors.primary} />
            <Text style={styles.importText}>Import from Contacts</Text>
          </TouchableOpacity>
        </>
      ) : null}

      <Card style={styles.card}>
        {!isSelf ? (
          <View style={styles.typeRow}>
            <SegmentedControl
              value={type}
              options={[
                { label: 'Family', value: 'family' },
                { label: 'Friend', value: 'friend' },
                { label: 'Service', value: 'service' },
              ]}
              onChange={(v) => setType(v)}
            />
          </View>
        ) : null}

        <Input label="Name" value={form.name} onChangeText={set('name')} editable={!isSelf} highlight={assist.changed.has('name')} />
        {isSelf ? (
          <Text style={styles.hint}>Your name, birthday and home address are managed in Account.</Text>
        ) : (
          <>
            <Input
              label={
                isService
                  ? 'Service / business (e.g. plumber, dentist)'
                  : type === 'family'
                  ? 'Relationship (e.g. spouse, daughter)'
                  : 'How you know them (e.g. neighbor)'
              }
              value={form.relationship}
              onChangeText={set('relationship')}
              highlight={assist.changed.has('relationship')}
            />
            {!isService ? (
              <DateField label="Birthday (optional)" value={form.birthday} onChange={set('birthday')} clearable highlight={assist.changed.has('birthday')} />
            ) : null}
            <PlacesAutocomplete
              label={isService ? 'Address or business name (optional)' : 'Address (optional)'}
              value={form.address}
              onChangeText={set('address')}
              placeholder={isService ? "e.g. Joe's Plumbing or 123 Main St" : '123 Main St, Toronto, ON'}
              type={isService ? 'business' : 'address'}
              onSelect={isService ? onServiceSelect : undefined}
              highlight={assist.changed.has('address')}
            />
          </>
        )}

        {!isService ? (
          <>
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
          </>
        ) : null}

        <Input
          label="Notes for AI (optional)"
          value={form.notes}
          onChangeText={set('notes')}
          multiline
          numberOfLines={3}
          style={styles.notes}
          highlight={assist.changed.has('notes')}
        />

        {!isSelf ? (
          <>
            <Input label="Phone (optional)" value={form.phone} onChangeText={set('phone')} keyboardType="phone-pad" highlight={assist.changed.has('phone')} />
            <Input label="Email (optional)" value={form.email} onChangeText={set('email')} keyboardType="email-address" autoCapitalize="none" highlight={assist.changed.has('email')} />
          </>
        ) : null}
      </Card>

      {canDelete ? <Button title="Delete" variant="danger" onPress={remove} /> : null}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  card: { marginBottom: spacing.md },
  importRow: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: spacing.sm,
    paddingVertical: spacing.sm, marginBottom: spacing.md,
  },
  importText: { color: colors.primary, fontSize: 15, fontWeight: '600' },
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
