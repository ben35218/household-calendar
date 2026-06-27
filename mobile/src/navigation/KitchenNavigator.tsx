import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import KitchenScreen from '../screens/kitchen/KitchenScreen';
import InventoryItemFormScreen from '../screens/kitchen/InventoryItemFormScreen';
import ReceiptScanScreen from '../screens/kitchen/ReceiptScanScreen';
import RecipeDetailScreen from '../screens/kitchen/RecipeDetailScreen';
import RecipeFormScreen from '../screens/kitchen/RecipeFormScreen';
import CookingModeScreen from '../screens/kitchen/CookingModeScreen';
import { colors } from '../theme';

export type KitchenStackParamList = {
  KitchenHome: undefined;
  InventoryItemForm: { id?: string };
  ReceiptScan: undefined;
  RecipeDetail: { id: string };
  RecipeForm: { id?: string };
  CookingMode: { id: string };
};

const Stack = createNativeStackNavigator<KitchenStackParamList>();

export default function KitchenNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
      }}
    >
      <Stack.Screen name="KitchenHome" component={KitchenScreen} options={{ title: 'Kitchen' }} />
      <Stack.Screen name="InventoryItemForm" component={InventoryItemFormScreen} options={{ title: 'Item' }} />
      <Stack.Screen name="ReceiptScan" component={ReceiptScanScreen} options={{ title: 'Scan Receipt' }} />
      <Stack.Screen name="RecipeDetail" component={RecipeDetailScreen} options={{ title: 'Recipe' }} />
      <Stack.Screen name="RecipeForm" component={RecipeFormScreen} options={{ title: 'Recipe' }} />
      <Stack.Screen name="CookingMode" component={CookingModeScreen} options={{ title: 'Cooking' }} />
    </Stack.Navigator>
  );
}
