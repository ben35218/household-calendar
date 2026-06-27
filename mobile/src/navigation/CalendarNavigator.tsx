import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import CalendarScreen from '../screens/calendar/CalendarScreen';
import CalendarDayScreen from '../screens/calendar/CalendarDayScreen';
import EventFormScreen from '../screens/calendar/EventFormScreen';
import CalendarAssistantScreen from '../screens/calendar/CalendarAssistantScreen';
import { colors } from '../theme';

export type CalendarStackParamList = {
  CalendarHome: undefined;
  CalendarDay: { date: string };
  EventForm: { eventId?: string; date?: string };
  CalendarAssistant: undefined;
};

const Stack = createNativeStackNavigator<CalendarStackParamList>();

export default function CalendarNavigator() {
  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
      }}
    >
      <Stack.Screen name="CalendarHome" component={CalendarScreen} options={{ title: 'Calendar' }} />
      <Stack.Screen name="CalendarDay" component={CalendarDayScreen} options={{ title: 'Day' }} />
      <Stack.Screen name="EventForm" component={EventFormScreen} options={{ title: 'Event' }} />
      <Stack.Screen name="CalendarAssistant" component={CalendarAssistantScreen} options={{ title: 'Calendar Assistant' }} />
    </Stack.Navigator>
  );
}
