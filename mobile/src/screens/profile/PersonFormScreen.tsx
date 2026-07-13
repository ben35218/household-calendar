import React, { useLayoutEffect, useState } from 'react';
import { View, Text, StyleSheet, Alert, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { peopleApi, placesApi, Person, FormAssistField, PlacePrediction } from '../../api';
import { sealNew, sealUpdate } from '../../lib/e2ee';

// Encrypted person content (type/birthday stay plaintext during dual-write).
const PERSON_ENC = (p: Record<string, unknown>) => ({
  name: p.name, relationship: p.relationship, interests: p.interests,
  notes: p.notes, address: p.address, businessName: p.businessName, phone: p.phone, email: p.email,
  birthday: p.birthday, // encrypted now (§9.1 P6): cron gated (P3), calendar reads decrypted (P2)
});
import { Button, Input, DateField, Screen, SectionTitle, Select, useHeaderCheckButton } from '../../components/ui';
import { form as fs, GroupCard, CardDivider } from '../../components/formStyles';
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
  const { id, isSelf, type: initialType, prefills, queueIndex = 0 } = params || {};

  const people = qc.getQueryData<Person[]>(['people']) || [];
  const editing = id ? people.find((p) => p._id === id) : undefined;

  // Review-mode import: the contact currently being reviewed, and whether more
  // follow it in the queue.
  const prefill = prefills?.[queueIndex];
  const inQueue = !!prefills && prefills.length > 0;
  const hasNext = inQueue && queueIndex + 1 < prefills!.length;
  const src = editing || prefill; // shared field source for initial values

  const [type, setType] = useState<'family' | 'friend' | 'service'>(
    (src?.type as 'family' | 'friend' | 'service') || initialType || 'family'
  );
  const isService = type === 'service';
  const [form, setForm] = useState({
    name: src?.name ?? '',
    relationship: src?.relationship ?? '',
    businessName: src?.businessName ?? '',
    birthday: src?.birthday ? String(src.birthday).slice(0, 10) : '',
    address: src?.address ?? '',
    notes: src?.notes ?? '',
    phone: src?.phone ?? '',
    email: src?.email ?? '',
  });
  const [interests, setInterests] = useState<string[]>(src?.interests ? [...src.interests] : []);
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
    { name: 'businessName', type: 'text', label: 'Business name (for professionals)' },
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

  // In review mode, saving one contact advances to the next (or ends the queue).
  function advance() {
    if (hasNext) (nav as any).replace('PersonForm', { prefills, queueIndex: queueIndex + 1 });
    else nav.goBack();
  }

  async function save() {
    if (!form.name.trim()) return;
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        type,
        name: form.name.trim(),
        relationship: form.relationship.trim() || undefined,
        businessName: isService ? form.businessName.trim() || undefined : undefined,
        birthday: form.birthday || undefined,
        address: form.address.trim() || undefined,
        interests: interests.filter(Boolean),
        notes: form.notes.trim() || undefined,
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
        deviceContactId: prefill?.deviceContactId || undefined,
      };
      if (editing?._id) await peopleApi.update(editing._id, await sealUpdate('Person', editing._id, payload, PERSON_ENC(payload)));
      else await peopleApi.create(await sealNew('Person', payload, PERSON_ENC(payload)));
      qc.invalidateQueries({ queryKey: ['people'] });
      if (inQueue) advance();
      else nav.goBack();
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

  // Review-mode progress in the header title (e.g. "Review 2 of 5").
  useLayoutEffect(() => {
    if (inQueue) nav.setOptions({ title: `Review ${queueIndex + 1} of ${prefills!.length}` });
  }, [nav, inQueue, queueIndex, prefills]);

  return (
    <Screen>
      {!isSelf ? (
        <FormAssist
          formType="person / contact"
          placeholder={'Describe the person, e.g. "my sister Sarah, birthday June 3, loves hiking and photography"'}
          fields={assistFields}
          current={{ ...form, interests }}
          onApply={applyPatch}
        />
      ) : null}

      <GroupCard>
        <Input
          value={form.name}
          onChangeText={set('name')}
          placeholder="Name"
          editable={!isSelf}
          containerStyle={fs.headField}
          style={[fs.headInput, assist.changed.has('name') && fs.headInputHighlight]}
        />
        {!isSelf ? (
          <>
            <CardDivider />
            <Select
              inlineLabel="Type"
              value={type}
              options={[
                { label: 'Family', value: 'family' },
                { label: 'Friend', value: 'friend' },
                { label: 'Professional', value: 'service' },
              ]}
              onChange={(v) => v && setType(v as 'family' | 'friend' | 'service')}
              containerStyle={fs.dtFieldWrap}
              fieldStyle={fs.rowField}
              valueStyle={fs.dtValue}
              chevronIcon="chevron-expand"
            />
            <CardDivider />
            <Input
              value={form.relationship}
              onChangeText={set('relationship')}
              placeholder={
                isService
                  ? 'Service (e.g. plumber, dentist)'
                  : type === 'family'
                  ? 'Relationship (e.g. spouse, daughter)'
                  : 'How you know them (e.g. neighbor)'
              }
              containerStyle={fs.headField}
              style={[fs.headInput, assist.changed.has('relationship') && fs.headInputHighlight]}
            />
            {isService ? (
              <>
                <CardDivider />
                <Input
                  value={form.businessName}
                  onChangeText={set('businessName')}
                  placeholder="Business name (e.g. Joe's Plumbing)"
                  containerStyle={fs.headField}
                  style={[fs.headInput, assist.changed.has('businessName') && fs.headInputHighlight]}
                />
              </>
            ) : null}
            {!isService ? (
              <>
                <CardDivider />
                <DateField
                  inlineLabel="Birthday"
                  clearable
                  placeholder="None"
                  value={form.birthday}
                  onChange={set('birthday')}
                  highlight={assist.changed.has('birthday')}
                  containerStyle={fs.dtFieldWrap}
                  fieldStyle={fs.rowField}
                  valueStyle={fs.dtValue}
                  hideIcon
                />
              </>
            ) : null}
            <CardDivider />
            <PlacesAutocomplete
              value={form.address}
              onChangeText={set('address')}
              placeholder={isService ? 'Business address' : 'Address (optional)'}
              type={isService ? 'business' : 'address'}
              onSelect={isService ? onServiceSelect : undefined}
              containerStyle={fs.headField}
              inputStyle={[fs.headInput, assist.changed.has('address') && fs.headInputHighlight]}
            />
          </>
        ) : null}
      </GroupCard>
      {isSelf ? (
        <Text style={styles.hint}>Your name, birthday and home address are managed in Account.</Text>
      ) : null}

      {!isService ? (
        <>
          <SectionTitle>Interests / hobbies</SectionTitle>
          <GroupCard>
            <View style={styles.tagInputRow}>
              <Input
                value={interestDraft}
                onChangeText={setInterestDraft}
                placeholder="e.g. hockey, hiking"
                onSubmitEditing={addInterest}
                returnKeyType="done"
                containerStyle={[fs.headField, styles.tagInputWrap]}
                style={fs.headInput}
              />
              <TouchableOpacity onPress={addInterest} disabled={!interestDraft.trim()} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="add-circle" size={28} color={interestDraft.trim() ? colors.primary : colors.border} />
              </TouchableOpacity>
            </View>
            {interests.length > 0 ? (
              <>
                <CardDivider />
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
              </>
            ) : null}
          </GroupCard>
        </>
      ) : null}

      <SectionTitle>Notes for AI</SectionTitle>
      <Input
        value={form.notes}
        onChangeText={set('notes')}
        multiline
        numberOfLines={3}
        placeholder="Anything the assistant should know about them…"
        style={styles.notes}
        highlight={assist.changed.has('notes')}
      />

      {!isSelf ? (
        <GroupCard>
          <Input
            value={form.phone}
            onChangeText={set('phone')}
            placeholder="Phone (optional)"
            keyboardType="phone-pad"
            containerStyle={fs.headField}
            style={[fs.headInput, assist.changed.has('phone') && fs.headInputHighlight]}
          />
          <CardDivider />
          <Input
            value={form.email}
            onChangeText={set('email')}
            placeholder="Email (optional)"
            keyboardType="email-address"
            autoCapitalize="none"
            containerStyle={fs.headField}
            style={[fs.headInput, assist.changed.has('email') && fs.headInputHighlight]}
          />
        </GroupCard>
      ) : null}

      {inQueue ? (
        <View style={fs.footer}>
          <Button title={hasNext ? 'Skip this contact' : 'Skip & finish'} variant="ghost" onPress={advance} />
        </View>
      ) : null}

      {canDelete ? (
        <View style={fs.footer}>
          <Button title="Delete" variant="danger" onPress={remove} />
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  hint: { fontSize: 12, color: colors.textMuted, marginTop: -spacing.sm, marginBottom: spacing.md },
  tagInputRow: { flexDirection: 'row', alignItems: 'center', paddingRight: 14 },
  tagInputWrap: { flex: 1 },
  tags: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 14 },
  tag: {
    flexDirection: 'row', alignItems: 'center', gap: 4,
    borderWidth: 1, borderColor: colors.primary, borderRadius: 16,
    paddingHorizontal: 10, paddingVertical: 4,
  },
  tagText: { color: colors.primary, fontSize: 13, fontWeight: '500' },
  notes: { height: 80, textAlignVertical: 'top' },
});
