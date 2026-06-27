import React from 'react';
import { TouchableOpacity } from 'react-native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Ionicons } from '@expo/vector-icons';
import DashboardScreen from '../screens/DashboardScreen';
import ProfileNavigator from './ProfileNavigator';
import { colors } from '../theme';

// Profile moved off the bottom bar (to make room for the Trips tab) — it's now
// reached via the person icon in the Dashboard header.
export type DashboardStackParamList = {
  DashboardHome: undefined;
  ProfileStack: undefined;
};

const Stack = createNativeStackNavigator<DashboardStackParamList>();

export default function DashboardNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
      }}
    >
      <Stack.Screen
        name="DashboardHome"
        component={DashboardScreen}
        options={({ navigation }) => ({
          title: 'Dashboard',
          headerRight: () => (
            <TouchableOpacity onPress={() => navigation.navigate('ProfileStack')} style={{ paddingHorizontal: 4 }}>
              <Ionicons name="person-circle-outline" size={26} color="#fff" />
            </TouchableOpacity>
          ),
        })}
      />
      <Stack.Screen name="ProfileStack" component={ProfileNavigator} options={{ headerShown: false }} />
    </Stack.Navigator>
  );
}
