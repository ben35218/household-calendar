import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import VacationsScreen from '../screens/trips/VacationsScreen';
import TripFormScreen from '../screens/trips/TripFormScreen';
import TripDetailScreen from '../screens/trips/TripDetailScreen';
import TripItemFormScreen from '../screens/trips/TripItemFormScreen';
import TripSettleScreen from '../screens/trips/TripSettleScreen';
import VacationAssistantScreen from '../screens/trips/VacationAssistantScreen';
import { TRIP_PURPLE } from '../lib/tripTypes';

export type TripsStackParamList = {
  Vacations: undefined;
  TripForm: { id?: string };
  TripDetail: { id: string };
  TripItemForm: { tripId: string; itemId?: string; date?: string };
  TripSettle: { id: string };
  VacationAssistant: { tripId: string; tripName?: string };
};

const Stack = createNativeStackNavigator<TripsStackParamList>();

export default function TripsNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: TRIP_PURPLE },
        headerTintColor: '#fff',
      }}
    >
      <Stack.Screen name="Vacations" component={VacationsScreen} options={{ title: 'Vacations' }} />
      <Stack.Screen name="TripForm" component={TripFormScreen} options={{ title: 'Trip' }} />
      <Stack.Screen name="TripDetail" component={TripDetailScreen} options={{ title: 'Trip' }} />
      <Stack.Screen name="TripItemForm" component={TripItemFormScreen} options={{ title: 'Booking' }} />
      <Stack.Screen name="TripSettle" component={TripSettleScreen} options={{ title: 'Settle Up' }} />
      <Stack.Screen name="VacationAssistant" component={VacationAssistantScreen} options={{ title: 'Vacation Assistant' }} />
    </Stack.Navigator>
  );
}
