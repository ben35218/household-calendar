import React, { useLayoutEffect, useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SegmentedControl, RoundIconButton } from '../../components/ui';
import InventoryPane from './InventoryPane';
import RecipesPane from './RecipesPane';
import PlannerPane from './PlannerPane';
import { useCalendarColors } from '../../lib/calendarPrefs';
import { colors, spacing } from '../../theme';
import type { KitchenStackParamList } from '../../navigation/KitchenNavigator';

type Pane = 'inventory' | 'recipes' | 'planner';
type Nav = NativeStackNavigationProp<KitchenStackParamList>;

export default function KitchenScreen() {
  const [pane, setPane] = useState<Pane>('planner');
  const navigation = useNavigation<Nav>();
  const accent = useCalendarColors().colors.recipes;

  // Contextual add button: recipes -> new recipe, food -> new inventory item.
  // The planner has no add action, so no button appears there.
  useLayoutEffect(() => {
    const target =
      pane === 'recipes' ? () => navigation.navigate('RecipeForm', {}) :
      pane === 'inventory' ? () => navigation.navigate('InventoryItemForm', {}) :
      null;
    navigation.setOptions({
      headerRight: target ? () => <RoundIconButton icon="add" onPress={target} bg={accent} /> : undefined,
    });
  }, [navigation, pane, accent]);

  return (
    <View style={styles.screen}>
      <View style={styles.segmentWrap}>
        <SegmentedControl<Pane>
          value={pane}
          onChange={setPane}
          options={[
            { label: 'Planner', value: 'planner' },
            { label: 'Recipes', value: 'recipes' },
            { label: 'Food', value: 'inventory' },
          ]}
        />
      </View>
      <View style={styles.body}>
        {pane === 'inventory' ? <InventoryPane /> : pane === 'recipes' ? <RecipesPane /> : <PlannerPane />}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background },
  segmentWrap: { padding: spacing.md, paddingBottom: spacing.sm },
  body: { flex: 1 },
});
