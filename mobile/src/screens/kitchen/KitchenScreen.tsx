import React, { useLayoutEffect, useState } from 'react';
import { View, StyleSheet, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SegmentedControl } from '../../components/ui';
import InventoryPane from './InventoryPane';
import RecipesPane from './RecipesPane';
import PlannerPane from './PlannerPane';
import { colors, spacing } from '../../theme';
import type { KitchenStackParamList } from '../../navigation/KitchenNavigator';

type Pane = 'inventory' | 'recipes' | 'planner';
type Nav = NativeStackNavigationProp<KitchenStackParamList>;

export default function KitchenScreen() {
  const [pane, setPane] = useState<Pane>('inventory');
  const navigation = useNavigation<Nav>();

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () => (
        <View style={styles.headerBtns}>
          <TouchableOpacity onPress={() => navigation.navigate('FindRecipes')} style={styles.headerBtn}>
            <Ionicons name="search" size={22} color="#fff" />
          </TouchableOpacity>
          <TouchableOpacity onPress={() => navigation.navigate('MealPlannerSettings')} style={styles.headerBtn}>
            <Ionicons name="settings-outline" size={22} color="#fff" />
          </TouchableOpacity>
        </View>
      ),
    });
  }, [navigation]);

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
  headerBtns: { flexDirection: 'row', alignItems: 'center' },
  headerBtn: { paddingHorizontal: 4 },
});
