import React, { useLayoutEffect, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, ScrollView } from 'react-native';
import { useQuery } from '@tanstack/react-query';
import { useRoute, RouteProp, useNavigation } from '@react-navigation/native';
import { recipesApi } from '../../api';
import { Button } from '../../components/ui';
import { KitchenStackParamList } from '../../navigation/KitchenNavigator';
import { colors, spacing } from '../../theme';

type Rt = RouteProp<KitchenStackParamList, 'CookingMode'>;

// Step-by-step cooking overlay (web CookingModeOverlay) rebuilt as a screen.
export default function CookingModeScreen() {
  const { id } = useRoute<Rt>().params;
  const navigation = useNavigation();
  const [step, setStep] = useState(0);

  const recipeQ = useQuery({ queryKey: ['recipes', id], queryFn: async () => (await recipesApi.get(id)).data });
  const recipe = recipeQ.data;

  useLayoutEffect(() => {
    navigation.setOptions({ title: 'Cooking' });
  }, [navigation]);

  if (recipeQ.isLoading || !recipe) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color={colors.primary} />
      </View>
    );
  }

  const steps = recipe.instructions ?? [];
  const last = step >= steps.length - 1;

  return (
    <View style={styles.screen}>
      <View style={styles.progressRow}>
        <Text style={styles.progress}>
          Step {step + 1} of {steps.length}
        </Text>
        <View style={styles.bar}>
          <View style={[styles.barFill, { width: `${((step + 1) / Math.max(1, steps.length)) * 100}%` }]} />
        </View>
      </View>

      <ScrollView contentContainerStyle={styles.body}>
        <Text style={styles.stepText}>{steps[step]}</Text>
      </ScrollView>

      {/* Ingredient quick-reference */}
      {recipe.ingredients?.length ? (
        <ScrollView style={styles.ingPanel} contentContainerStyle={{ padding: spacing.md }}>
          <Text style={styles.ingHeader}>Ingredients</Text>
          {recipe.ingredients.map((ing, i) => (
            <Text key={i} style={styles.ingLine}>
              • {[ing.amount, ing.unit, ing.name].filter(Boolean).join(' ')}
            </Text>
          ))}
        </ScrollView>
      ) : null}

      <View style={styles.nav}>
        <Button title="Back" variant="ghost" disabled={step === 0} onPress={() => setStep((s) => Math.max(0, s - 1))} />
        <View style={{ flex: 1 }}>
          <Button
            title={last ? 'Finish' : 'Next'}
            onPress={() => (last ? navigation.goBack() : setStep((s) => s + 1))}
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
  ingPanel: { maxHeight: 160, backgroundColor: colors.surface, borderTopWidth: 1, borderTopColor: colors.border },
  ingHeader: { fontSize: 13, fontWeight: '700', color: colors.textMuted, textTransform: 'uppercase', marginBottom: spacing.sm },
  ingLine: { fontSize: 15, color: colors.text, paddingVertical: 2 },
  nav: { flexDirection: 'row', gap: spacing.sm, alignItems: 'center', padding: spacing.md, borderTopWidth: 1, borderTopColor: colors.border },
});
