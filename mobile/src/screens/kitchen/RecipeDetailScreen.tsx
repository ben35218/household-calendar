import React, { useLayoutEffect, useState } from 'react';
import { View, Text, StyleSheet, Image, TouchableOpacity, Share, Alert, Modal } from 'react-native';
import { KeyboardAvoidingView } from 'react-native-keyboard-controller';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { recipesApi, recipeScheduleApi, RecipeSchedule } from '../../api';
import { Button, Card, Screen, Divider, Badge, DateField, Input, CenteredLoader, ScreenTitle, HeaderIconButton } from '../../components/ui';
import { formatCalendarDate } from '../../lib/recurrence';
import { KitchenStackParamList } from '../../navigation/KitchenNavigator';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { colors, spacing } from '../../theme';

type Nav = NativeStackNavigationProp<KitchenStackParamList, 'RecipeDetail'>;
type Rt = RouteProp<KitchenStackParamList, 'RecipeDetail'>;

function featured(schedules: RecipeSchedule[]) {
  if (!schedules.length) return null;
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const upcoming = schedules.filter((s) => new Date(s.scheduledDate) >= now);
  if (upcoming.length) return { s: upcoming[0], upcoming: true };
  return { s: schedules[schedules.length - 1], upcoming: false };
}

export default function RecipeDetailScreen() {
  const navigation = useNavigation<Nav>();
  const { id } = useRoute<Rt>().params;
  const qc = useQueryClient();
  // Meals/recipes calendar colour (respects user overrides) — the section accent.
  const accent = useCalendarColors().colors.recipes;
  const [scheduleOpen, setScheduleOpen] = useState(false);
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [emailOpen, setEmailOpen] = useState(false);
  const [shareEmailAddr, setShareEmailAddr] = useState('');
  const [shareSent, setShareSent] = useState(false);

  const recipeQ = useQuery({ queryKey: ['recipes', id], queryFn: async () => (await recipesApi.get(id)).data });
  const schedulesQ = useQuery({ queryKey: ['recipe-schedule', 'forRecipe', id], queryFn: async () => (await recipeScheduleApi.forRecipe(id)).data });
  const recipe = recipeQ.data;

  const schedule = useMutation({
    mutationFn: () => recipeScheduleApi.schedule({ recipeId: id, scheduledDate: date }),
    onSuccess: () => {
      setScheduleOpen(false);
      qc.invalidateQueries({ queryKey: ['recipe-schedule'] });
    },
  });

  // Share the recipe as self-contained text via the OS share sheet (mirrors the
  // trip share entry point) — recipes need no invite code, the content travels.
  const shareRecipe = () => {
    if (!recipe) return;
    const mins = (recipe.prepTimeMins || 0) + (recipe.cookTimeMins || 0);
    const meta = [mins ? `${mins} min` : '', recipe.servings ? `${recipe.servings} servings` : '']
      .filter(Boolean)
      .join(' · ');
    const lines = [
      recipe.title,
      ...(meta ? [meta] : []),
      ...(recipe.description ? ['', recipe.description] : []),
      '',
      'Ingredients:',
      ...(recipe.ingredients ?? []).map(
        (ing) => `• ${[ing.amount, ing.unit, ing.name].filter(Boolean).join(' ')}`,
      ),
      '',
      'Instructions:',
      ...(recipe.instructions ?? []).map((step, i) => `${i + 1}. ${step}`),
      '',
      'Shared from Household Calendar — https://householdcalendar.com',
    ];
    Share.share({ message: lines.join('\n') }, { subject: recipe.title });
  };

  // Server-sent styled recipe email — the share sheet path above is plain text.
  const emailShare = useMutation({
    mutationFn: () => recipesApi.shareEmail(id, shareEmailAddr.trim().toLowerCase()),
    onSuccess: () => {
      setShareEmailAddr('');
      setShareSent(true);
    },
  });

  const onShare = () =>
    Alert.alert('Share recipe', undefined, [
      { text: 'Share…', onPress: shareRecipe },
      { text: 'Email a styled copy', onPress: () => setEmailOpen(true) },
      { text: 'Cancel', style: 'cancel' },
    ]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Recipe',
      // Share sits tight to the title's right; the left spacer mirrors its
      // width so the title stays centered (same trick as the trip header).
      // The header title is static — long recipe names live in the body.
      headerTitle: () => (
        <View style={styles.headerTitleRow}>
          <View style={styles.titleSpacer} />
          <Text style={styles.headerTitleText} numberOfLines={1}>Recipe</Text>
          <View style={styles.titleActions}>
            <TouchableOpacity onPress={onShare} hitSlop={8}>
              <MaterialCommunityIcons name="share" size={22} color="#fff" />
            </TouchableOpacity>
          </View>
        </View>
      ),
      headerRight: () => (
        <HeaderIconButton icon="pencil" accessibilityLabel="Edit recipe" onPress={() => navigation.navigate('RecipeForm', { id })} />
      ),
    });
  }, [navigation, id, recipe]);

  if (recipeQ.isLoading || !recipe) {
    return <CenteredLoader color={accent} />;
  }

  const total = (recipe.prepTimeMins || 0) + (recipe.cookTimeMins || 0);
  const feat = featured(schedulesQ.data ?? []);

  return (
    <View style={{ flex: 1 }}>
      <Screen>
        {recipe.imageUrl ? <Image source={{ uri: recipe.imageUrl }} style={styles.hero} /> : null}

        <ScreenTitle style={styles.recipeTitle}>{recipe.title}</ScreenTitle>

        <View style={styles.metaRow}>
          {total ? <Badge label={`${total} min`} color={accent} /> : null}
          {recipe.servings ? <Badge label={`${recipe.servings} servings`} color={accent} /> : null}
          {recipe.tags?.map((t) => (
            <Badge key={t} label={t} />
          ))}
        </View>

        {recipe.description ? <Text style={styles.desc}>{recipe.description}</Text> : null}

        {/* Schedule card */}
        <Card style={styles.scheduleCard}>
          <View style={styles.scheduleRow}>
            <Ionicons name={feat ? 'calendar' : 'calendar-outline'} size={20} color={accent} />
            <View style={{ flex: 1 }}>
              <Text style={styles.scheduleLabel}>{feat ? (feat.upcoming ? 'Next scheduled' : 'Last scheduled') : 'Not yet scheduled'}</Text>
              {feat ? <Text style={styles.scheduleDate}>{formatCalendarDate(feat.s.scheduledDate)}</Text> : null}
            </View>
            <Button title="Schedule" color={accent} onPress={() => setScheduleOpen((o) => !o)} />
          </View>
          {scheduleOpen ? (
            <View style={styles.schedulePad}>
              <DateField label="Date" value={date} onChange={setDate} />
              <Button title="Add to Planner" color={accent} loading={schedule.isPending} onPress={() => schedule.mutate()} />
            </View>
          ) : null}
        </Card>

        {/* Ingredients */}
        <Card style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Ingredients</Text>
          <Divider />
          {recipe.ingredients?.map((ing, i) => (
            <View key={i} style={styles.ingRow}>
              <Text style={styles.ingAmount}>{[ing.amount, ing.unit].filter(Boolean).join(' ')}</Text>
              <Text style={styles.ingName}>{ing.name}</Text>
            </View>
          ))}
        </Card>

        {/* Instructions */}
        <Card style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>Instructions</Text>
          <Divider />
          {recipe.instructions?.map((step, i) => (
            <View key={i} style={styles.stepRow}>
              <View style={[styles.stepBadge, { backgroundColor: accent }]}>
                <Text style={styles.stepNum}>{i + 1}</Text>
              </View>
              <Text style={styles.stepText}>{step}</Text>
            </View>
          ))}
        </Card>
      </Screen>

      <View style={styles.actionBar}>
        <Button
          title="Start Cooking"
          color={accent}
          onPress={() => navigation.navigate('CookingMode', { id })}
          disabled={!recipe.instructions?.length}
        />
      </View>

      <Modal visible={emailOpen} transparent animationType="fade" onRequestClose={() => setEmailOpen(false)}>
        <KeyboardAvoidingView style={styles.flex} behavior="padding">
        <TouchableOpacity style={styles.modalOverlay} activeOpacity={1} onPress={() => setEmailOpen(false)}>
          <TouchableOpacity style={styles.emailSheet} activeOpacity={1}>
            <Text style={styles.emailTitle}>Email this recipe</Text>
            <Text style={styles.emailSub}>They'll get a styled copy from Household Calendar.</Text>
            <Input
              placeholder="Email address"
              value={shareEmailAddr}
              onChangeText={(v) => {
                setShareEmailAddr(v);
                setShareSent(false);
                emailShare.reset();
              }}
              keyboardType="email-address"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Button
              title="Send"
              color={accent}
              loading={emailShare.isPending}
              disabled={!shareEmailAddr.trim()}
              onPress={() => emailShare.mutate()}
            />
            {shareSent ? <Text style={styles.emailSent}>Recipe sent.</Text> : null}
            {emailShare.isError ? (
              <Text style={styles.emailErr}>
                {(emailShare.error as any)?.response?.data?.error || 'Could not send the email'}
              </Text>
            ) : null}
          </TouchableOpacity>
        </TouchableOpacity>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  headerTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8 },
  headerTitleText: { color: '#fff', fontSize: 17, fontWeight: '600', flexShrink: 1 },
  // Left spacer mirrors the share icon's width so the title stays centered.
  titleSpacer: { width: 30 },
  titleActions: { flexDirection: 'row', alignItems: 'center', width: 30 },
  hero: { width: '100%', height: 200, borderRadius: 12, marginBottom: spacing.md },
  recipeTitle: { marginBottom: spacing.sm },
  metaRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: spacing.md },
  desc: { fontSize: 15, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 21 },
  scheduleCard: { marginBottom: spacing.md },
  scheduleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  scheduleLabel: { fontSize: 12, color: colors.textMuted },
  scheduleDate: { fontSize: 15, fontWeight: '600', color: colors.text, marginTop: 2 },
  schedulePad: { marginTop: spacing.md, gap: spacing.sm },
  sectionCard: { padding: 0, paddingTop: spacing.md, marginBottom: spacing.md },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: colors.text, paddingHorizontal: spacing.md, marginBottom: spacing.sm },
  ingRow: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: 8 },
  ingAmount: { width: 80, fontSize: 14, fontWeight: '600', color: colors.textMuted },
  ingName: { flex: 1, fontSize: 15, color: colors.text },
  stepRow: { flexDirection: 'row', paddingHorizontal: spacing.md, paddingVertical: 8, gap: spacing.md },
  stepBadge: { width: 28, height: 28, borderRadius: 14, backgroundColor: colors.primary, alignItems: 'center', justifyContent: 'center' },
  stepNum: { color: '#fff', fontWeight: '700', fontSize: 13 },
  stepText: { flex: 1, fontSize: 15, color: colors.text, lineHeight: 22 },
  actionBar: {
    padding: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  flex: { flex: 1 },
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: spacing.lg },
  emailSheet: { backgroundColor: colors.surface, borderRadius: 14, padding: spacing.lg },
  emailTitle: { fontSize: 17, fontWeight: '700', color: colors.text, marginBottom: 4 },
  emailSub: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md },
  emailSent: { color: colors.success, fontSize: 13, textAlign: 'center', marginTop: spacing.sm },
  emailErr: { color: colors.error, fontSize: 13, textAlign: 'center', marginTop: spacing.sm },
});
