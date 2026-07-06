import React from 'react';
import { TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RootStackParamList } from './types';
import { colors } from '../theme';
import { useCalendarColors } from '../lib/calendarPrefs';
import { useSyncTimezone } from '../lib/useSyncTimezone';

// Calendar
import CalendarScreen from '../screens/calendar/CalendarScreen';
import CalendarDayScreen from '../screens/calendar/CalendarDayScreen';
import EventFormScreen from '../screens/calendar/EventFormScreen';
import CalendarAssistantScreen from '../screens/calendar/CalendarAssistantScreen';
import CalendarSearchScreen from '../screens/calendar/CalendarSearchScreen';
import CalendarsScreen from '../screens/calendar/CalendarsScreen';
import CalendarColorsScreen from '../screens/calendar/CalendarColorsScreen';
import HolidaysScreen from '../screens/calendar/HolidaysScreen';
import EventsScreen from '../screens/calendar/EventsScreen';
import WeatherScreen from '../screens/calendar/WeatherScreen';

// Maintenance (item-centric)
import MaintenanceScreen from '../screens/maintenance/MaintenanceScreen';
import TaskDetailScreen from '../screens/maintenance/TaskDetailScreen';
import TaskFormScreen from '../screens/maintenance/TaskFormScreen';
import TaskTemplatesScreen from '../screens/maintenance/TaskTemplatesScreen';
import ItemsListScreen from '../screens/maintenance/ItemsListScreen';
import ItemDetailScreen from '../screens/maintenance/ItemDetailScreen';
import ItemFormScreen from '../screens/maintenance/ItemFormScreen';
import MaintenanceChatScreen from '../screens/maintenance/MaintenanceChatScreen';

// Chores (separate flow)
import ChoresScreen from '../screens/maintenance/ChoresScreen';
import ChoreDetailScreen from '../screens/maintenance/ChoreDetailScreen';
import ChoreFormScreen from '../screens/maintenance/ChoreFormScreen';
import ChoreTemplatesScreen from '../screens/maintenance/ChoreTemplatesScreen';

// Kitchen
import KitchenScreen from '../screens/kitchen/KitchenScreen';
import InventoryItemFormScreen from '../screens/kitchen/InventoryItemFormScreen';
import ReceiptScanScreen from '../screens/kitchen/ReceiptScanScreen';
import RecipeDetailScreen from '../screens/kitchen/RecipeDetailScreen';
import RecipeFormScreen from '../screens/kitchen/RecipeFormScreen';
import CookingModeScreen from '../screens/kitchen/CookingModeScreen';
import FindRecipesScreen from '../screens/kitchen/FindRecipesScreen';
import MealPlannerSettingsScreen from '../screens/kitchen/MealPlannerSettingsScreen';
import AddMealScreen from '../screens/kitchen/AddMealScreen';

// Trips
import VacationsScreen from '../screens/trips/VacationsScreen';
import TripFormScreen from '../screens/trips/TripFormScreen';
import TripDetailScreen from '../screens/trips/TripDetailScreen';
import TripItemFormScreen from '../screens/trips/TripItemFormScreen';
import TripSettleScreen from '../screens/trips/TripSettleScreen';
import VacationAssistantScreen from '../screens/trips/VacationAssistantScreen';

// Profile
import ProfileScreen from '../screens/ProfileScreen';
import AccountScreen from '../screens/profile/AccountScreen';
import PeopleScreen from '../screens/profile/PeopleScreen';
import PersonFormScreen from '../screens/profile/PersonFormScreen';
import ContactImportScreen from '../screens/profile/ContactImportScreen';
import HouseholdScreen from '../screens/profile/HouseholdScreen';
import PrivacyScreen from '../screens/profile/PrivacyScreen';
import PaywallScreen from '../screens/PaywallScreen';

const Stack = createNativeStackNavigator<RootStackParamList>();

// A header is tinted with its calendar's primary colour (Vacations purple,
// Maintenance blue, Chores orange, Meals teal, Holidays red, Weather blue);
// calendar-family screens use black.
const BLACK = '#000';
const hdr = (bg: string) => ({ headerStyle: { backgroundColor: bg }, headerTintColor: '#fff' as const });

// One flat stack rooted at the calendar (web's `/` → `/calendar`). The calendar
// home + events list hide the native header and render their own black top bar.
export default function AppNavigator() {
  // Subscribe so per-flow header colours update when the user recolours a calendar.
  const { colors: cal } = useCalendarColors();
  // Keep the stored timezone aligned with this device (drives 7am alert timing).
  useSyncTimezone();
  return (
    <Stack.Navigator
      initialRouteName="CalendarHome"
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
        // Chevron only — never show the previous screen's title (the headerless
        // CalendarHome/Events would otherwise leak their route name as the label).
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      {/* Calendar family (black) */}
      <Stack.Screen name="CalendarHome" component={CalendarScreen} options={{ headerShown: false }} />
      <Stack.Screen name="Events" component={EventsScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CalendarDay" component={CalendarDayScreen} options={{ ...hdr(BLACK), title: 'Day' }} />
      <Stack.Screen name="EventForm" component={EventFormScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Event' }} />
      <Stack.Screen name="CalendarAssistant" component={CalendarAssistantScreen} options={{ ...hdr(BLACK), title: 'Calendar Assistant' }} />
      <Stack.Screen name="CalendarSearch" component={CalendarSearchScreen} options={{ ...hdr(BLACK), title: 'Search' }} />
      <Stack.Screen
        name="Calendars"
        component={CalendarsScreen}
        options={({ navigation }) => ({
          ...hdr(colors.background),
          headerShadowVisible: false,
          presentation: 'modal',
          title: 'Calendars',
          headerLeft: () => (
            <TouchableOpacity onPress={() => navigation.goBack()} style={{ paddingHorizontal: 4 }}>
              <Ionicons name="close" size={26} color="#fff" />
            </TouchableOpacity>
          ),
        })}
      />
      <Stack.Screen name="CalendarColors" component={CalendarColorsScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Calendar Colors' }} />
      <Stack.Screen name="Holidays" component={HolidaysScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Holidays' }} />
      <Stack.Screen name="Weather" component={WeatherScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Weather' }} />

      {/* Maintenance (blue) */}
      <Stack.Screen name="MaintenanceHome" component={MaintenanceScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Maintenance' }} />
      <Stack.Screen name="TaskDetail" component={TaskDetailScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Task' }} />
      <Stack.Screen name="TaskForm" component={TaskFormScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Task' }} />
      <Stack.Screen name="TaskTemplates" component={TaskTemplatesScreen} options={{ ...hdr(cal.maintenance), title: 'Task Templates' }} />
      <Stack.Screen name="ItemsList" component={ItemsListScreen} options={{ ...hdr(cal.maintenance), title: 'Items' }} />
      <Stack.Screen name="ItemDetail" component={ItemDetailScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Item' }} />
      <Stack.Screen name="ItemForm" component={ItemFormScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Item' }} />
      <Stack.Screen name="MaintenanceChat" component={MaintenanceChatScreen} options={{ ...hdr(cal.maintenance), title: 'Maintenance Assistant' }} />

      {/* Chores (orange) */}
      <Stack.Screen name="ChoresHome" component={ChoresScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Chores' }} />
      <Stack.Screen name="ChoreDetail" component={ChoreDetailScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Chore' }} />
      <Stack.Screen name="ChoreForm" component={ChoreFormScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Chore' }} />
      <Stack.Screen name="ChoreTemplates" component={ChoreTemplatesScreen} options={{ ...hdr(cal.chores), title: 'Chore Templates' }} />

      {/* Kitchen / meals (teal) */}
      <Stack.Screen name="KitchenHome" component={KitchenScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Meals' }} />
      <Stack.Screen name="InventoryItemForm" component={InventoryItemFormScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Item' }} />
      <Stack.Screen name="ReceiptScan" component={ReceiptScanScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Scan Receipt' }} />
      <Stack.Screen name="RecipeDetail" component={RecipeDetailScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Recipe' }} />
      <Stack.Screen name="RecipeForm" component={RecipeFormScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Recipe' }} />
      <Stack.Screen name="CookingMode" component={CookingModeScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Cooking' }} />
      <Stack.Screen name="RecipeAssistant" component={FindRecipesScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Recipe Assistant' }} />
      <Stack.Screen name="MealPlannerSettings" component={MealPlannerSettingsScreen} options={{ ...hdr(cal.recipes), title: 'Grocery Sections' }} />
      <Stack.Screen name="AddMeal" component={AddMealScreen} options={{ headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, headerShadowVisible: false, title: '' }} />

      {/* Trips (purple) */}
      <Stack.Screen name="Vacations" component={VacationsScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Vacations' }} />
      <Stack.Screen name="TripForm" component={TripFormScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Trip' }} />
      <Stack.Screen name="TripDetail" component={TripDetailScreen} options={{ ...hdr(cal.vacations), title: 'Trip' }} />
      <Stack.Screen name="TripItemForm" component={TripItemFormScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Booking' }} />
      <Stack.Screen name="TripSettle" component={TripSettleScreen} options={{ ...hdr(cal.vacations), title: 'Settle Up' }} />
      <Stack.Screen name="VacationAssistant" component={VacationAssistantScreen} options={{ ...hdr(cal.vacations), title: 'Vacation Assistant' }} />

      {/* Profile (app primary) */}
      <Stack.Screen name="ProfileHome" component={ProfileScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Profile' }} />
      <Stack.Screen name="Account" component={AccountScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Account' }} />
      <Stack.Screen name="People" component={PeopleScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Contacts' }} />
      <Stack.Screen name="PersonForm" component={PersonFormScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Person' }} />
      <Stack.Screen name="ContactImport" component={ContactImportScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Import Contacts' }} />
      <Stack.Screen name="Household" component={HouseholdScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Household' }} />
      <Stack.Screen name="Privacy" component={PrivacyScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Privacy' }} />
      <Stack.Screen name="Paywall" component={PaywallScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Plan' }} />
    </Stack.Navigator>
  );
}
