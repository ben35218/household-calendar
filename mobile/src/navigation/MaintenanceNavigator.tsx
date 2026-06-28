import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import MaintenanceScreen from '../screens/maintenance/MaintenanceScreen';
import TaskDetailScreen from '../screens/maintenance/TaskDetailScreen';
import TaskFormScreen from '../screens/maintenance/TaskFormScreen';
import TaskTemplatesScreen from '../screens/maintenance/TaskTemplatesScreen';
import ChoreDetailScreen from '../screens/maintenance/ChoreDetailScreen';
import ChoreFormScreen from '../screens/maintenance/ChoreFormScreen';
import ChoreTemplatesScreen from '../screens/maintenance/ChoreTemplatesScreen';
import ItemsListScreen from '../screens/maintenance/ItemsListScreen';
import ItemDetailScreen from '../screens/maintenance/ItemDetailScreen';
import ItemFormScreen from '../screens/maintenance/ItemFormScreen';
import MaintenanceChatScreen from '../screens/maintenance/MaintenanceChatScreen';
import CategoriesScreen from '../screens/maintenance/CategoriesScreen';
import type { Item } from '../api';
import { colors } from '../theme';

export type MaintenanceStackParamList = {
  MaintenanceHome: undefined;
  TaskDetail: { id: string };
  TaskForm: { id?: string };
  TaskTemplates: undefined;
  ChoreDetail: { id: string };
  ChoreForm: { id?: string };
  ChoreTemplates: undefined;
  ItemsList: undefined;
  ItemDetail: { id: string };
  ItemForm: { id?: string; prefill?: Partial<Item> };
  MaintenanceChat: { itemId: string; itemName?: string };
  Categories: undefined;
};

const Stack = createNativeStackNavigator<MaintenanceStackParamList>();

export default function MaintenanceNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
      }}
    >
      <Stack.Screen name="MaintenanceHome" component={MaintenanceScreen} options={{ title: 'Maintenance' }} />
      <Stack.Screen name="TaskDetail" component={TaskDetailScreen} options={{ title: 'Task' }} />
      <Stack.Screen name="TaskForm" component={TaskFormScreen} options={{ title: 'Task' }} />
      <Stack.Screen name="TaskTemplates" component={TaskTemplatesScreen} options={{ title: 'Task Templates' }} />
      <Stack.Screen name="ChoreDetail" component={ChoreDetailScreen} options={{ title: 'Chore' }} />
      <Stack.Screen name="ChoreForm" component={ChoreFormScreen} options={{ title: 'Chore' }} />
      <Stack.Screen name="ChoreTemplates" component={ChoreTemplatesScreen} options={{ title: 'Chore Templates' }} />
      <Stack.Screen name="ItemsList" component={ItemsListScreen} options={{ title: 'Items' }} />
      <Stack.Screen name="ItemDetail" component={ItemDetailScreen} options={{ title: 'Item' }} />
      <Stack.Screen name="ItemForm" component={ItemFormScreen} options={{ title: 'Item' }} />
      <Stack.Screen name="MaintenanceChat" component={MaintenanceChatScreen} options={{ title: 'Maintenance Assistant' }} />
      <Stack.Screen name="Categories" component={CategoriesScreen} options={{ title: 'Categories' }} />
    </Stack.Navigator>
  );
}
