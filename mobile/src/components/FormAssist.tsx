import React, { useState } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { Button, Input } from './ui';
import { formAssistApi, FormAssistField } from '../api';
import { usePrivacyPrefs } from '../lib/privacyPrefs';
import { colors, spacing, radius } from '../theme';

// A drop-in "describe it and let AI fill the form" panel for the top of an
// add/edit screen. The screen supplies its field schema + current values; on
// success we hand back the patch so the screen can apply it and highlight the
// changed fields.
export default function FormAssist({
  formType,
  fields,
  current,
  onApply,
  disabled,
  includeContacts,
  title = 'Fill with AI',
  placeholder = 'Describe what you want to add…',
}: {
  formType: string;
  fields: FormAssistField[];
  current: Record<string, unknown>;
  onApply: (patch: Record<string, unknown>) => void;
  disabled?: boolean;
  includeContacts?: boolean;
  title?: string;
  placeholder?: string;
}) {
  const { prefs } = usePrivacyPrefs();
  const [prompt, setPrompt] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const run = async () => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setError('');
    setNote('');
    try {
      // Enforce the privacy prefs (Phase 5): only attach personal/contact context
      // when the user has allowed it.
      const { data } = await formAssistApi.fill({
        formType, fields, current, prompt: prompt.trim(),
        includeContacts: includeContacts && prefs.aiUsePersonalInfo,
      });
      const patch = data.patch || {};
      if (Object.keys(patch).length === 0) {
        setError("Couldn't find anything to fill from that. Try being more specific.");
      } else {
        onApply(patch);
        if (data.note) setNote(data.note);
      }
    } catch (e: any) {
      setError(e.response?.data?.error || 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Master switch (Phase 5): with AI disabled in Privacy settings, the panel
  // doesn't appear at all — nothing is ever sent to the AI provider.
  if (!prefs.aiEnabled) return null;

  return (
    <View style={styles.card}>
      <View style={styles.header}>
        <Ionicons name="sparkles" size={16} color={colors.primary} />
        <Text style={styles.title}>{title}</Text>
      </View>
      <Text style={styles.consent}>
        <Ionicons name="cloud-upload-outline" size={11} color={colors.textMuted} />
        {' '}Your description{includeContacts && prefs.aiUsePersonalInfo ? ' (and household contacts)' : ''} is sent to Anthropic to fill the form.
      </Text>
      <Input
        value={prompt}
        onChangeText={setPrompt}
        placeholder={placeholder}
        multiline
        editable={!disabled && !loading}
        style={styles.input}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
      {note ? <Text style={styles.note}>{note}</Text> : null}
      <Button
        title="Fill in the form"
        onPress={run}
        loading={loading}
        disabled={disabled || !prompt.trim()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.primary + '14',
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.primary + '55',
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  header: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: spacing.sm },
  title: { fontSize: 15, fontWeight: '700', color: colors.text },
  consent: { fontSize: 11, color: colors.textMuted, marginBottom: spacing.sm, lineHeight: 15 },
  input: { minHeight: 68, textAlignVertical: 'top' },
  error: { color: colors.error, marginBottom: spacing.sm, fontSize: 13 },
  note: { color: colors.textMuted, marginBottom: spacing.sm, fontSize: 13 },
});
