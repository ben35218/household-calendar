import type { Item } from '../api';

// The single, flat route map for the whole app — the React-Navigation analogue
// of the web's one flat vue-router. Every screen is a sibling route, so any
// screen can navigate to any other (day view → detail, My Calendars → a feature
// flow, calendar avatar → profile), exactly like router.push(path) on web.
//
// Each feature navigator file re-exports its old `XStackParamList` name as an
// alias of this type, so existing screen imports keep resolving unchanged.
export type RootStackParamList = {
  // ----- Calendar -----
  CalendarHome: undefined;
  CalendarDay: { date: string };
  EventForm: { eventId?: string; date?: string };
  CalendarAssistant: undefined;
  CalendarSearch: undefined;
  Calendars: undefined;
  CalendarColors: undefined;
  Holidays: undefined;
  Events: undefined;
  Weather: undefined;

  // ----- Maintenance (item-centric) -----
  MaintenanceHome: undefined;
  TaskDetail: { id: string };
  TaskForm: { id?: string };
  TaskTemplates: undefined;
  ItemsList: undefined;
  ItemDetail: { id: string };
  ItemForm: { id?: string; prefill?: Partial<Item> };
  MaintenanceChat: { itemId: string; itemName?: string };

  // ----- Chores (separate flow) -----
  ChoresHome: undefined;
  ChoreDetail: { id: string };
  ChoreForm: { id?: string };
  ChoreTemplates: undefined;

  // ----- Kitchen / meal planner -----
  KitchenHome: undefined;
  InventoryItemForm: { id?: string };
  ReceiptScan: undefined;
  RecipeDetail: { id: string };
  RecipeForm: { id?: string };
  CookingMode: { id: string };
  RecipeAssistant: undefined;
  MealPlannerSettings: undefined;
  AddMeal: { date: string };

  // ----- Trips / vacations -----
  Vacations: undefined;
  TripForm: { id?: string };
  TripDetail: { id: string };
  TripItemForm: { tripId: string; itemId?: string; date?: string };
  TripSettle: { id: string };
  VacationAssistant: { tripId: string; tripName?: string };

  // ----- Profile -----
  ProfileHome: undefined;
  Account: undefined;
  People: undefined;
  PersonForm: { id?: string; isSelf?: boolean; type?: 'family' | 'friend' | 'service' };
  ContactImport: undefined;
  Household: undefined;
  Privacy: undefined;
  Paywall: undefined;
};
