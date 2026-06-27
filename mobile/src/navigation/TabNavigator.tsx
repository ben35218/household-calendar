import React from 'react';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Ionicons } from '@expo/vector-icons';
import DashboardNavigator from './DashboardNavigator';
import CalendarNavigator from './CalendarNavigator';
import MaintenanceNavigator from './MaintenanceNavigator';
import KitchenNavigator from './KitchenNavigator';
import TripsNavigator from './TripsNavigator';
import { colors } from '../theme';

export type TabParamList = {
  Dashboard: undefined;
  Calendar: undefined;
  Tasks: undefined;
  Kitchen: undefined;
  Trips: undefined;
};

const Tab = createBottomTabNavigator<TabParamList>();

const ICONS: Record<keyof TabParamList, keyof typeof Ionicons.glyphMap> = {
  Dashboard: 'home-outline',
  Calendar: 'calendar-outline',
  Tasks: 'checkbox-outline',
  Kitchen: 'restaurant-outline',
  Trips: 'briefcase-outline',
};

export default function TabNavigator() {
  return (
    <Tab.Navigator
      screenOptions={({ route }) => ({
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        tabBarIcon: ({ color, size }) => (
          <Ionicons name={ICONS[route.name]} size={size} color={color} />
        ),
      })}
    >
      <Tab.Screen name="Dashboard" component={DashboardNavigator} options={{ headerShown: false }} />
      <Tab.Screen name="Calendar" component={CalendarNavigator} options={{ headerShown: false }} />
      <Tab.Screen name="Tasks" component={MaintenanceNavigator} options={{ headerShown: false }} />
      <Tab.Screen name="Kitchen" component={KitchenNavigator} options={{ headerShown: false }} />
      <Tab.Screen name="Trips" component={TripsNavigator} options={{ headerShown: false }} />
    </Tab.Navigator>
  );
}
