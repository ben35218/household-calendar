import React, { useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { settingsApi } from '../../api';
import { getHDK, sealUpdate, openRecord } from '../../lib/e2ee';
import { Button, Card, Input, DateField, Select } from '../../components/ui';
import PlacesAutocomplete from '../../components/PlacesAutocomplete';
import { colors, spacing } from '../../theme';

const TIMEZONES = [
  'America/Toronto', 'America/New_York', 'America/Chicago',
  'America/Denver', 'America/Los_Angeles', 'America/Vancouver',
  'Europe/London', 'Europe/Paris', 'Australia/Sydney',
].map((t) => ({ label: t, value: t }));

// Identity only: name, birthday, timezone, home address. Sign-in and security
// (email, password, passkey, recovery code) live on SecurityScreen.
export default function AccountScreen() {
  const qc = useQueryClient();

  const { data: settings, isLoading } = useQuery({
    queryKey: ['settings'],
    queryFn: async () => (await settingsApi.get()).data,
  });

  const [form, setForm] = useState({
    firstName: '', lastName: '', birthday: '', timezone: 'America/Toronto', homeAddress: '',
  });
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!settings) return;
    setForm({
      firstName: settings.firstName ?? '',
      lastName: settings.lastName ?? '',
      birthday: settings.birthday ? String(settings.birthday).slice(0, 10) : '',
      timezone: settings.timezone ?? 'America/Toronto',
      homeAddress: settings.homeAddress ?? '',
    });
    // Decrypt the sealed home location over the plaintext (§9.1 P5); dormant
    // without an HDK. Post-drop this is the only source of the address.
    if (settings.enc && getHDK() && settings.householdId) {
      openRecord('Household', { _id: String(settings.householdId), keyVersion: settings.keyVersion, enc: settings.enc } as any)
        .then((dec: any) => { if (dec.homeAddress) setForm((f) => ({ ...f, homeAddress: dec.homeAddress })); })
        .catch(() => { /* locked / wrong key */ });
    }
  }, [settings]);

  const set = (k: keyof typeof form) => (v: string) => setForm((f) => ({ ...f, [k]: v }));

  async function save() {
    setSaving(true);
    try {
      let body: Record<string, unknown> = {
        firstName: form.firstName,
        lastName: form.lastName,
        birthday: form.birthday || undefined,
        timezone: form.timezone,
        homeAddress: form.homeAddress,
      };
      // Seal the home location alongside the plaintext (§9.1 P5); no-op without an HDK.
      if (getHDK() && settings?.householdId) {
        body = await sealUpdate('Household', String(settings.householdId), body, { homeAddress: form.homeAddress });
      }
      await settingsApi.update(body);
      qc.invalidateQueries({ queryKey: ['settings'] });
      Alert.alert('Saved', 'Your account details were updated.');
    } catch (e: any) {
      Alert.alert('Error', e?.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  if (isLoading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <Text style={styles.cardNote}>Your identity and location.</Text>
        <Input label="First name" value={form.firstName} onChangeText={set('firstName')} />
        <Input label="Last name" value={form.lastName} onChangeText={set('lastName')} />
        <DateField label="Your birthday" value={form.birthday} onChange={set('birthday')} clearable />
        <Select
          label="Timezone"
          value={form.timezone}
          options={TIMEZONES}
          onChange={(v) => set('timezone')((v as string) ?? '')}
        />
        <PlacesAutocomplete
          label="Home address"
          value={form.homeAddress}
          onChangeText={set('homeAddress')}
          placeholder="123 Main St, Toronto, ON"
          type="address"
        />
        <Text style={styles.hint}>Used to calculate driving time to event locations and local weather.</Text>
        <Button title="Save" onPress={save} loading={saving} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  card: { marginBottom: spacing.md },
  cardNote: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 18 },
  hint: { fontSize: 12, color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 16 },
});
