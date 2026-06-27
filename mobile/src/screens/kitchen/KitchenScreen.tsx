import React, { useState } from 'react';
import { View, StyleSheet } from 'react-native';
import { SegmentedControl } from '../../components/ui';
import InventoryPane from './InventoryPane';
import RecipesPane from './RecipesPane';
import PlannerPane from './PlannerPane';
import { colors, spacing } from '../../theme';

type Pane = 'inventory' | 'recipes' | 'planner';

export default function KitchenScreen() {
  const [pane, setPane] = useState<Pane>('inventory');

  return (
    <View style={styles.screen}>
      <View style={styles.segmentWrap}>
        <SegmentedControl<Pane>
          value={pane}
          onChange={setPane}
          options={[
            { label: 'Inventory', value: 'inventory' },
            { label: 'Recipes', value: 'recipes' },
            { label: 'Planner', value: 'planner' },
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
