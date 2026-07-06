import React, { useEffect, useLayoutEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView, TouchableOpacity, Vibration } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { Ionicons } from '@expo/vector-icons';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { recipesApi, Ingredient } from '../../api';
import { Button } from '../../components/ui';
import { KitchenStackParamList } from '../../navigation/KitchenNavigator';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { colors, spacing, radius } from '../../theme';

type Rt = RouteProp<KitchenStackParamList, 'CookingMode'>;

// A countdown started from a step's configured timer. Several can run at once.
interface CookTimer {
  id: string;
  label: string;
  remaining: number; // seconds
  done: boolean;
}

const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

// Step-by-step cooking overlay (web CookingModeOverlay) rebuilt as a screen.
export default function CookingModeScreen() {
  const { id } = useRoute<Rt>().params;
  const navigation = useNavigation();
  // Meals/recipes calendar colour (respects user overrides) — the section accent.
  const accent = useCalendarColors().colors.recipes;
  const [step, setStep] = useState(0);
  const [showAll, setShowAll] = useState(false);
  const [timers, setTimers] = useState<CookTimer[]>([]);

  const recipeQ = useQuery({ queryKey: ['recipes', id], queryFn: async () => (await recipesApi.get(id)).data });
  const recipe = recipeQ.data;

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Cooking' });
  }, [navigation]);

  // One shared ticker drives every active timer; it no-ops when none are running.
  useEffect(() => {
    const iv = setInterval(() => {
      setTimers((prev) => {
        if (!prev.some((t) => !t.done && t.remaining > 0)) return prev;
        return prev.map((t) => {
          if (t.done || t.remaining <= 0) return t;
          const remaining = t.remaining - 1;
          if (remaining <= 0) {
            Vibration.vibrate(800);
            return { ...t, remaining: 0, done: true };
          }
          return { ...t, remaining };
        });
      });
    }, 1000);
    return () => clearInterval(iv);
  }, []);

  if (recipeQ.isLoading || !recipe) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={accent} />
      </View>
    );
  }

  const steps = recipe.instructions ?? [];
  const last = step >= steps.length - 1;
  const allIngredients = recipe.ingredients ?? [];

  // Minutes configured for a given step, if any.
  const timerMinsFor = (i: number) => {
    const m = recipe.instructionTimers?.[i];
    return m != null && m > 0 ? m : null;
  };
  const stepTimerMins = timerMinsFor(step);

  // Ingredients tagged to the current step (fall back to "view all").
  const stepIdx = recipe.instructionIngredients?.[step] ?? [];
  const stepIngredients = showAll
    ? allIngredients
    : (stepIdx.map((idx) => allIngredients[idx]).filter(Boolean) as Ingredient[]);

  const startTimer = (i: number) => {
    const mins = timerMinsFor(i);
    if (!mins) return;
    const label = `Step ${i + 1}`;
    setTimers((prev) => {
      // Don't stack a second timer for the same step while one is still shown.
      if (prev.some((t) => t.label === label)) return prev;
      return [...prev, { id: `${i}-${Date.now()}`, label, remaining: Math.round(mins * 60), done: false }];
    });
  };
  const dismissTimer = (tid: string) => setTimers((prev) => prev.filter((t) => t.id !== tid));

  const goBackStep = () => {
    setStep((s) => Math.max(0, s - 1));
    setShowAll(false);
  };
  const advance = () => {
    // Kick off the leaving step's timer so it runs while later steps proceed.
    startTimer(step);
    setStep((s) => s + 1);
    setShowAll(false);
  };

  return (
    <View style={styles.screen}>
      <View style={styles.progressRow}>
        <Text style={styles.progress}>
          Step {step + 1} of {steps.length}
        </Text>
        <View style={styles.bar}>
          <View style={[styles.barFill, { backgroundColor: accent, width: `${((step + 1) / Math.max(1, steps.length)) * 100}%` }]} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.stepText}>{steps[step]}</Text>
        {stepTimerMins ? (
          <View style={styles.timerHint}>
            <Ionicons name="timer-outline" size={16} color={accent} />
            <Text style={[styles.timerHintText, { color: accent }]}>
              {stepTimerMins} min timer — starts when you continue
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* Running timers — several can count down at once */}
      {timers.length ? (
        <View style={styles.timersPanel}>
          {timers.map((t) => (
            <View key={t.id} style={[styles.timerChip, t.done && styles.timerChipDone]}>
              <Ionicons name={t.done ? 'alarm' : 'timer-outline'} size={16} color={t.done ? colors.error : accent} />
              <Text style={styles.timerChipLabel}>{t.label}</Text>
              <Text style={[styles.timerChipTime, t.done && styles.timerChipTimeDone]}>{t.done ? 'Done!' : fmt(t.remaining)}</Text>
              <TouchableOpacity onPress={() => dismissTimer(t.id)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Ionicons name="close" size={16} color={colors.textMuted} />
              </TouchableOpacity>
            </View>
          ))}
        </View>
      ) : null}

      {/* Ingredient reference — this step by default, with a view-all toggle */}
      {allIngredients.length ? (
        <View style={styles.ingPanel}>
          <View style={styles.ingHead}>
            <Text style={styles.ingHeader}>{showAll ? 'All ingredients' : 'For this step'}</Text>
            <TouchableOpacity onPress={() => setShowAll((v) => !v)}>
              <Text style={[styles.ingToggle, { color: accent }]}>{showAll ? 'This step' : 'View all ingredients'}</Text>
            </TouchableOpacity>
          </View>
          <ScrollView contentContainerStyle={{ paddingBottom: spacing.sm }}>
            {stepIngredients.length ? (
              stepIngredients.map((ing, i) => (
                <Text key={i} style={styles.ingLine}>
                  • {[ing.amount, ing.unit, ing.name].filter(Boolean).join(' ')}
                </Text>
              ))
            ) : (
              <Text style={styles.ingEmpty}>No ingredients tagged to this step.</Text>
            )}
          </ScrollView>
        </View>
      ) : null}

      <View style={styles.nav}>
        <TouchableOpacity
          style={[styles.backBtn, { borderColor: accent }, step === 0 && styles.backDisabled]}
          disabled={step === 0}
          onPress={goBackStep}
          accessibilityLabel="Previous step"
        >
          <Ionicons name="chevron-back" size={24} color={accent} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Button
            title={last ? 'Finish' : 'Next'}
            color={accent}
            onPress={() => (last ? navigation.goBack() : advance())}
          />
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.background },
  progressRow: { padding: spacing.md },
  progress: { fontSize: 14, color: colors.textMuted, marginBottom: spacing.sm },
  bar: { height: 4, backgroundColor: colors.border, borderRadius: 2 },
  barFill: { height: 4, backgroundColor: colors.primary, borderRadius: 2 },
  body: { padding: spacing.lg, flexGrow: 1, justifyContent: 'center' },
  stepText: { fontSize: 24, lineHeight: 34, color: colors.text, fontWeight: '500' },
  timerHint: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: spacing.lg },
  timerHintText: { fontSize: 14, fontWeight: '600' },
  timersPanel: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  timerChip: { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: 10, paddingVertical: 6, borderWidth: 1, borderColor: colors.border },
  timerChipDone: { borderColor: colors.error, backgroundColor: colors.error + '14' },
  timerChipLabel: { fontSize: 13, color: colors.text, fontWeight: '600' },
  timerChipTime: { fontSize: 14, color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  timerChipTimeDone: { color: colors.error },
  ingPanel: { maxHeight: 160, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border, padding: spacing.md },
  ingHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: spacing.sm },
  ingHeader: { fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase' },
  ingToggle: { fontSize: 13, fontWeight: '600' },
  ingLine: { fontSize: 15, color: colors.text, paddingVertical: 2 },
  ingEmpty: { fontSize: 14, color: colors.textMuted, fontStyle: 'italic' },
  nav: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
  backBtn: { borderWidth: 1, borderRadius: radius.md, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  backDisabled: { opacity: 0.4 },
});
