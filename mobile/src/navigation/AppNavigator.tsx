import React from 'react';
import { TouchableOpacity, View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import StorageBanner from '../components/StorageBanner';
import { RootStackParamList } from './types';
import { colors } from '../theme';
import { ASSISTANT_NAME } from '../config';
import { useCalendarColors } from '../lib/calendarPrefs';
import { useSyncTimezone } from '../lib/useSyncTimezone';
import { useQuery } from '@tanstack/react-query';
import { loadForecast } from '../lib/weather';
import { weatherCardColors } from '../lib/weatherTheme';

// Calendar
import CalendarScreen from '../screens/calendar/CalendarScreen';
import CalendarDayScreen from '../screens/calendar/CalendarDayScreen';
import EventFormScreen from '../screens/calendar/EventFormScreen';
import CalendarAssistantScreen from '../screens/calendar/CalendarAssistantScreen';
import CalendarSearchScreen from '../screens/calendar/CalendarSearchScreen';
import CalendarsScreen from '../screens/calendar/CalendarsScreen';
import AddCalendarMenuScreen from '../screens/calendar/AddCalendarMenuScreen';
import AddCalendarScreen from '../screens/calendar/AddCalendarScreen';
import SubscribeCalendarScreen from '../screens/calendar/SubscribeCalendarScreen';
import AddHolidayCalendarScreen from '../screens/calendar/AddHolidayCalendarScreen';
import CalendarColorsScreen from '../screens/calendar/CalendarColorsScreen';
import PrintCalendarScreen from '../screens/calendar/PrintCalendarScreen';
import HolidaysScreen from '../screens/calendar/HolidaysScreen';
import BirthdaysScreen from '../screens/calendar/BirthdaysScreen';
import WeatherScreen from '../screens/calendar/WeatherScreen';
import InvitationsScreen from '../screens/calendar/InvitationsScreen';
import EventInviteesScreen from '../screens/calendar/EventInviteesScreen';
import EventTravelTimeScreen from '../screens/calendar/EventTravelTimeScreen';
import EventRepeatScreen from '../screens/calendar/EventRepeatScreen';

// Maintenance (item-centric)
import MaintenanceScreen from '../screens/maintenance/MaintenanceScreen';
import TaskDetailScreen from '../screens/maintenance/TaskDetailScreen';
import TaskFormScreen from '../screens/maintenance/TaskFormScreen';
import TaskTemplatesScreen from '../screens/maintenance/TaskTemplatesScreen';
import TaskTemplateReviewScreen from '../screens/maintenance/TaskTemplateReviewScreen';
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
import RecipesScreen from '../screens/kitchen/RecipesScreen';
import GroceryScheduleScreen from '../screens/kitchen/GroceryScheduleScreen';
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
import PersonDetailScreen from '../screens/profile/PersonDetailScreen';
import PersonFormScreen from '../screens/profile/PersonFormScreen';
import ContactImportScreen from '../screens/profile/ContactImportScreen';
import HouseholdScreen from '../screens/profile/HouseholdScreen';
import ComparePlansScreen from '../screens/plan/ComparePlansScreen';
import AiUsageScreen from '../screens/plan/AiUsageScreen';
import UpsellSheet from '../screens/plan/UpsellSheet';

const Stack = createNativeStackNavigator<RootStackParamList>();

// A header is tinted with its calendar's primary colour (Vacations purple,
// Maintenance blue, Chores orange, Meals teal, Holidays red, Weather blue);
// calendar-family screens use black.
const BLACK = '#000';
const hdr = (bg: string) => ({ headerStyle: { backgroundColor: bg }, headerTintColor: '#fff' as const });

// Weather's floating edit pencil. Reads the cached forecast so its fill tracks
// the current conditions in step with the forecast cards behind it.
function WeatherEditButton({ onPress }: { onPress: () => void }) {
  const weatherQ = useQuery({ queryKey: ['weather'], queryFn: () => loadForecast() });
  const { bg, border } = weatherCardColors(weatherQ.data?.current?.weatherCode);
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.weatherEditBtn, { backgroundColor: bg, borderColor: border }]}
      hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
      accessibilityRole="button"
      accessibilityLabel="Edit Weather calendar"
    >
      <Ionicons name="pencil" size={16} color="#fff" />
    </TouchableOpacity>
  );
}

// Header title with a bare pencil hugging its right edge, opening the
// calendar's Edit Calendar view. An invisible left spacer mirrors the pencil's
// width so the TITLE itself stays exactly centered (the header centers the
// whole group; without the spacer the pencil would push the title off-center).
const EDIT_BTN_W = 24;
function HeaderTitleWithEdit({ title, onEdit }: { title: string; onEdit: () => void }) {
  return (
    <View style={styles.headerTitleRow}>
      <View style={{ width: EDIT_BTN_W }} />
      <Text style={styles.headerTitleText} numberOfLines={1}>{title}</Text>
      <TouchableOpacity
        onPress={onEdit}
        style={styles.headerEditBtn}
        hitSlop={{ top: 10, bottom: 10, left: 4, right: 10 }}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${title} calendar`}
      >
        <Ionicons name="pencil" size={16} color="#fff" />
      </TouchableOpacity>
    </View>
  );
}

// Screen options for a feature-calendar home: the standard header plus the
// pencil that opens the calendar's Edit Calendar view.
const editableCalendarHome = (title: string, calendarId: string) =>
  ({ navigation }: { navigation: { navigate: (route: string, params?: object) => void } }) => ({
    ...hdr(colors.background),
    headerShadowVisible: false,
    title,
    headerTitleAlign: 'center' as const,
    headerTitle: () => (
      <HeaderTitleWithEdit title={title} onEdit={() => navigation.navigate('AddCalendar', { calendarId })} />
    ),
  });

// One flat stack rooted at the calendar (web's `/` → `/calendar`). The calendar
// home + events list hide the native header and render their own black top bar.
export default function AppNavigator() {
  // Subscribe so per-flow header colours update when the user recolours a calendar.
  const { colors: cal } = useCalendarColors();
  // Keep the stored timezone aligned with this device (drives 7am alert timing).
  useSyncTimezone();
  return (
    <View style={styles.root}>
      {/* Persistent cloud-purge countdown, above every screen (§6.2). */}
      <StorageBanner />
      <Stack.Navigator
      initialRouteName="CalendarHome"
      screenOptions={{
        headerStyle: { backgroundColor: colors.primary },
        headerTintColor: '#fff',
        // Chevron only — never show the previous screen's title (the headerless
        // CalendarHome would otherwise leak its route name as the label).
        headerBackButtonDisplayMode: 'minimal',
      }}
    >
      {/* Calendar family (black). The grid/agenda toggle lives inside
          CalendarHome (crossfading layers), not as a separate route. */}
      <Stack.Screen name="CalendarHome" component={CalendarScreen} options={{ headerShown: false }} />
      <Stack.Screen name="CalendarDay" component={CalendarDayScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Day' }} />
      <Stack.Screen name="EventForm" component={EventFormScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Event' }} />
      <Stack.Screen name="CalendarAssistant" component={CalendarAssistantScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: `${ASSISTANT_NAME} · Calendar` }} />
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
      <Stack.Screen
        name="Invitations"
        component={InvitationsScreen}
        options={({ navigation }) => ({
          ...hdr(colors.background),
          headerShadowVisible: false,
          presentation: 'modal',
          title: 'Invitations',
          headerLeft: () => (
            <TouchableOpacity onPress={() => navigation.goBack()} style={{ paddingHorizontal: 4 }}>
              <Ionicons name="close" size={26} color="#fff" />
            </TouchableOpacity>
          ),
        })}
      />
      <Stack.Screen name="EventInvitees" component={EventInviteesScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Invitees' }} />
      <Stack.Screen name="EventTravelTime" component={EventTravelTimeScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Travel Time' }} />
      <Stack.Screen name="EventRepeat" component={EventRepeatScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Repeat' }} />
      <Stack.Screen name="AddCalendarMenu" component={AddCalendarMenuScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Add Calendar' }} />
      <Stack.Screen name="AddCalendar" component={AddCalendarScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'New Calendar' }} />
      <Stack.Screen name="SubscribeCalendar" component={SubscribeCalendarScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Subscribe' }} />
      <Stack.Screen name="AddHolidayCalendar" component={AddHolidayCalendarScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Add Holidays' }} />
      <Stack.Screen name="CalendarColors" component={CalendarColorsScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Colours & Order' }} />
      <Stack.Screen name="PrintCalendar" component={PrintCalendarScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Print' }} />
      {/* Title is set by the screen itself from the selected holiday calendar. */}
      <Stack.Screen name="Holidays" component={HolidaysScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Holidays', headerTitleAlign: 'center' }} />
      <Stack.Screen name="Birthdays" component={BirthdaysScreen} options={editableCalendarHome('Birthdays', 'birthdays')} />
      {/* Transparent header: sky gradient runs edge-to-edge, only the back chevron
          and edit pencil float. headerStyle must be reset too, or the
          navigator-level red background still paints. */}
      <Stack.Screen
        name="Weather"
        component={WeatherScreen}
        options={({ navigation }) => ({
          headerTransparent: true,
          headerStyle: { backgroundColor: 'transparent' },
          headerShadowVisible: false,
          headerTintColor: '#fff',
          title: '',
          headerRight: () => (
            <WeatherEditButton onPress={() => navigation.navigate('AddCalendar', { calendarId: 'weather' })} />
          ),
        })}
      />

      {/* Maintenance (blue) */}
      <Stack.Screen name="MaintenanceHome" component={MaintenanceScreen} options={editableCalendarHome('Maintenance', 'maintenance')} />
      <Stack.Screen name="TaskDetail" component={TaskDetailScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Task' }} />
      <Stack.Screen name="TaskForm" component={TaskFormScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Task' }} />
      <Stack.Screen name="TaskTemplates" component={TaskTemplatesScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Task Templates' }} />
      <Stack.Screen name="TaskTemplateReview" component={TaskTemplateReviewScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Link Items' }} />
      <Stack.Screen name="ItemDetail" component={ItemDetailScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Item' }} />
      <Stack.Screen name="ItemForm" component={ItemFormScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Item' }} />
      <Stack.Screen name="MaintenanceChat" component={MaintenanceChatScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: `${ASSISTANT_NAME} · Maintenance` }} />

      {/* Chores (orange) */}
      <Stack.Screen name="ChoresHome" component={ChoresScreen} options={editableCalendarHome('Chores', 'chores')} />
      <Stack.Screen name="ChoreDetail" component={ChoreDetailScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Chore' }} />
      <Stack.Screen name="ChoreForm" component={ChoreFormScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Chore' }} />
      <Stack.Screen name="ChoreTemplates" component={ChoreTemplatesScreen} options={{ ...hdr(cal.chores), title: 'Chore Templates' }} />

      {/* Kitchen / meals (teal) */}
      <Stack.Screen name="KitchenHome" component={KitchenScreen} options={editableCalendarHome('Meals', 'recipes')} />
      <Stack.Screen name="Recipes" component={RecipesScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Recipes' }} />
      <Stack.Screen name="GrocerySchedule" component={GroceryScheduleScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Grocery Schedule' }} />
      <Stack.Screen name="RecipeDetail" component={RecipeDetailScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Recipe' }} />
      <Stack.Screen name="RecipeForm" component={RecipeFormScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Recipe' }} />
      <Stack.Screen name="CookingMode" component={CookingModeScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Cooking' }} />
      <Stack.Screen name="RecipeAssistant" component={FindRecipesScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: `${ASSISTANT_NAME} · Recipes` }} />
      <Stack.Screen name="MealPlannerSettings" component={MealPlannerSettingsScreen} options={{ ...hdr(cal.recipes), title: 'Grocery Sections' }} />
      <Stack.Screen name="AddMeal" component={AddMealScreen} options={{ headerStyle: { backgroundColor: colors.background }, headerTintColor: colors.text, headerShadowVisible: false, title: '' }} />

      {/* Trips (purple) */}
      <Stack.Screen name="Vacations" component={VacationsScreen} options={editableCalendarHome('Vacations', 'vacations')} />
      <Stack.Screen name="TripForm" component={TripFormScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Trip' }} />
      <Stack.Screen name="TripDetail" component={TripDetailScreen} options={{ ...hdr(cal.vacations), title: 'Trip' }} />
      <Stack.Screen name="TripItemForm" component={TripItemFormScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Booking' }} />
      <Stack.Screen name="TripSettle" component={TripSettleScreen} options={{ ...hdr(cal.vacations), title: 'Settle Up' }} />
      <Stack.Screen name="VacationAssistant" component={VacationAssistantScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: `${ASSISTANT_NAME} · Trips` }} />

      {/* Profile (app primary) */}
      <Stack.Screen name="ProfileHome" component={ProfileScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Profile' }} />
      <Stack.Screen name="Account" component={AccountScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Account' }} />
      <Stack.Screen name="People" component={PeopleScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Contacts' }} />
      <Stack.Screen name="PersonDetail" component={PersonDetailScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Contact' }} />
      <Stack.Screen name="PersonForm" component={PersonFormScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Person' }} />
      <Stack.Screen name="ContactImport" component={ContactImportScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Import Contacts' }} />
      <Stack.Screen name="Household" component={HouseholdScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Household' }} />
      {/* Plan & billing: the status hub now lives inline on ProfileHome; these
          are its drill-ins — catalog / usage — plus the upsell sheet the
          AI-surface nudges open as a modal. */}
      <Stack.Screen name="ComparePlans" component={ComparePlansScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'Plans' }} />
      <Stack.Screen name="AiUsage" component={AiUsageScreen} options={{ ...hdr(colors.background), headerShadowVisible: false, title: 'AI Usage' }} />
      <Stack.Screen
        name="Upsell"
        component={UpsellSheet}
        options={({ navigation }) => ({
          ...hdr(colors.background),
          headerShadowVisible: false,
          presentation: 'modal',
          title: 'Upgrade',
          headerLeft: () => (
            <TouchableOpacity onPress={() => navigation.goBack()} style={{ paddingHorizontal: 4 }}>
              <Ionicons name="close" size={26} color="#fff" />
            </TouchableOpacity>
          ),
        })}
      />
      </Stack.Navigator>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.background },
  headerTitleRow: { flexDirection: 'row', alignItems: 'center' },
  // Matches the native stack header's default title weight/size.
  headerTitleText: { color: '#fff', fontSize: 17, fontWeight: '600' },
  headerEditBtn: { width: EDIT_BTN_W, alignItems: 'flex-end', justifyContent: 'center' },
  // Weather's floating edit pencil — matches the forecast card's solid fill
  // (backgroundColor/borderColor applied dynamically in WeatherEditButton).
  weatherEditBtn: {
    width: 32,
    height: 32,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: StyleSheet.hairlineWidth,
  },
});
