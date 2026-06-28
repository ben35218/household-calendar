import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import ProfileScreen from '../screens/ProfileScreen';
import AccountScreen from '../screens/profile/AccountScreen';
import PeopleScreen from '../screens/profile/PeopleScreen';
import PersonFormScreen from '../screens/profile/PersonFormScreen';
import ContactImportScreen from '../screens/profile/ContactImportScreen';
import HouseholdScreen from '../screens/profile/HouseholdScreen';
import PaywallScreen from '../screens/PaywallScreen';
import { colors } from '../theme';

export type ProfileStackParamList = {
  ProfileHome: undefined;
  Account: undefined;
  People: undefined;
  PersonForm: { id?: string; isSelf?: boolean };
  ContactImport: undefined;
  Household: undefined;
  Paywall: undefined;
};

const Stack = createNativeStackNavigator<ProfileStackParamList>();

export default function ProfileNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
      }}
    >
      <Stack.Screen name="ProfileHome" component={ProfileScreen} options={{ title: 'Profile' }} />
      <Stack.Screen name="Account" component={AccountScreen} options={{ title: 'Account' }} />
      <Stack.Screen name="People" component={PeopleScreen} options={{ title: 'Family & friends' }} />
      <Stack.Screen name="PersonForm" component={PersonFormScreen} options={{ title: 'Person' }} />
      <Stack.Screen name="ContactImport" component={ContactImportScreen} options={{ title: 'Import Contacts' }} />
      <Stack.Screen name="Household" component={HouseholdScreen} options={{ title: 'Household' }} />
      <Stack.Screen name="Paywall" component={PaywallScreen} options={{ title: 'Upgrade' }} />
    </Stack.Navigator>
  );
}
