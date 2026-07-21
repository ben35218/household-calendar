import type { InvitationEventSnapshot, Item, ProposedTask, Recipe } from '../api';
import type { RepeatRule } from '../lib/eventRepeat';
import type { AssistantId } from '../screens/chat/assistantTabs';

// The Meals screen's segmented panes; also usable as a KitchenHome route param
// to land on a specific pane.
export type KitchenPane = 'planner' | 'grocery';

// The decrypted event snapshot "Ask Calen" (event detail) hands the calendar
// assistant, so "cancel this appointment" resolves without a lookup.
export interface AssistantFocusEvent {
  _id: string;
  title: string;
  startDate?: string;
  allDay?: boolean;
  calendarType?: string;
  location?: string;
  phone?: string;
}

// A contact prefilled from device import (direct or AI-assisted), fed into
// PersonForm in review mode. All fields optional except type + name.
export interface PersonPrefill {
  type: 'family' | 'friend' | 'service';
  name: string;
  relationship?: string;
  businessName?: string;
  birthday?: string;
  address?: string;
  notes?: string;
  interests?: string[];
  phone?: string;
  email?: string;
  deviceContactId?: string;
}

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
  EventForm: { eventId?: string; date?: string; prefill?: Record<string, unknown> };
  // Read-only event detail (tapped from a calendar card). `date` is passed on to
  // the Edit form so it returns to the same day. Household-owned events only —
  // guest/collaborator copies still open read-only in EventForm.
  EventDetail: { eventId: string; date?: string };
  // Unified assistant view (Calendar / Chores / Task Plan swap in place). `initial`
  // picks which body opens; the switcher swaps the rest without navigating.
  // `focusEvent` scopes the calendar assistant to one event ("Ask Calen" on the
  // event detail screen) so cancel/reschedule requests need no lookup.
  Assistant: { initial?: AssistantId; focusEvent?: AssistantFocusEvent } | undefined;
  CalendarSearch: undefined;
  Calendars: undefined;
  // The "Add Calendar" chooser: pick what kind of calendar to add.
  AddCalendarMenu: undefined;
  // Create a custom calendar; `calendarId` switches the form to edit mode.
  // `holidayCountry` seeds the form as a new holiday calendar for that country.
  AddCalendar: { calendarId?: string; holidayCountry?: string } | undefined;
  // Subscribe to an external ICS/webcal calendar (paste URL → preview → save).
  SubscribeCalendar: undefined;
  // Pick a country to add its holiday calendar (Canadian Holidays, etc.).
  AddHolidayCalendar: undefined;
  CalendarColors: undefined;
  PrintCalendar: undefined;
  // Edit one country's holiday calendar (its national/regional/cultural toggles).
  Holidays: { calendarId: string };
  Birthdays: undefined;
  Weather: undefined;
  Invitations: undefined;
  // Manage one event's invitees. `snapshot` is the decrypted event content the
  // invite emails/.ics are built from; no `eventId` = a new-event draft whose
  // invitees queue in lib/inviteeDraft until the event is saved.
  EventInvitees: { eventId?: string; snapshot: InvitationEventSnapshot };
  // The event form's travel-time settings (switch / starting location / manual
  // duration). Edits flow back to the form via lib/travelDraft.
  EventTravelTime: { enabled: boolean; fromAddress: string; manualMinutes: number | null };
  // The event form's custom repeat rule (frequency / every N / weekday / month
  // patterns). Edits flow back to the form via lib/repeatDraft. `date` = the
  // event's start date, seeding pattern defaults.
  EventRepeat: { rule: RepeatRule; date: string };
  // The event's Location view. With `initial` (from the event form) the picked
  // location flows back via locationDraft; with `eventId` (e.g. Call to Cancel
  // needing a phone number) the checkmark saves straight onto the event.
  EventLocation: { eventId?: string; initial?: { location?: string; phone?: string; placeId?: string } } | undefined;
  // A phone call Calen placed: live status, outcome, summary, and the
  // confirm-cancellation actions. `id` is the PhoneCall record id.
  Interaction: { id: string };
  // Event Action — set up a Calen call to cancel or reschedule this appointment
  // (pick the action, answer the fee question, propose reschedule windows).
  // Carries the decrypted event snapshot: under E2EE the server (and this
  // screen, without re-decrypting) can't read the stored row.
  EventAction: {
    eventId: string;
    event: { title: string; startDate: string; phone: string; allDay?: boolean; calendarType?: string };
  };

  // ----- Maintenance (item-centric) -----
  MaintenanceHome: undefined;
  TaskDetail: { id: string };
  TaskForm: { id?: string; itemId?: string; categoryId?: string };
  // `mode: 'multi'` = bulk multi-select flow (→ TaskTemplateReview); default is
  // single tap-to-create. `categoryName` filters the list to one category when
  // browsing templates for a known item. `itemId` links the single-tap task to
  // that item and scopes the "in use" block to the item's property.
  TaskTemplates: { mode?: 'multi'; categoryName?: string; itemId?: string } | undefined;
  // Review step for the bulk flow: link each selected template (or a task Calen
  // staged in the AI plan chat) to an item — existing or auto-created — grouped
  // by category.
  TaskTemplateReview: { templateIds: string[] } | { proposedTasks: ProposedTask[] };
  ItemDetail: { id: string };
  ItemForm: { id?: string; prefill?: Partial<Item> };
  MaintenanceChat: { itemId: string; itemName?: string };

  // ----- Chores (separate flow) -----
  ChoresHome: undefined;
  ChoreDetail: { id: string };
  AddChore: undefined;
  ChoreForm: { id?: string; prefill?: Record<string, unknown> };
  ChoreTemplates: undefined;

  // ----- Kitchen / meal planner -----
  // `scrollToDate` (YYYY-MM-DD): open the Planner pane and scroll to that day —
  // used after scheduling a freshly-created recipe so the user lands on it.
  // `pane`: open a specific Meals pane — e.g. shopping-day rows on the
  // calendar jump straight to the Grocery pane.
  // `weekStart` (YYYY-MM-DD): a date within the shopping period to show — the
  // calendar's grocery icon passes its day so the pane opens on that period
  // rather than the current one.
  KitchenHome: { scrollToDate?: string; pane?: KitchenPane; weekStart?: string } | undefined;
  // The recipe library (list/search/manage); reached from the Meals view's
  // Recipes button rather than a segmented pane.
  Recipes: undefined;
  // Shopping cadence + day configuration (the Meals view's schedule card).
  GrocerySchedule: undefined;
  RecipeDetail: { id: string };
  // `initial` pre-fills a new recipe for review/save (e.g. an AI-generated
  // suggestion) without persisting anything until the user taps save.
  // `scheduleDate` (YYYY-MM-DD): when the recipe originated from the planner's
  // "Add recipe" for a date, schedule it to that date on save and return to Meals.
  RecipeForm: { id?: string; initial?: Partial<Recipe>; scheduleDate?: string };
  CookingMode: { id: string };
  RecipeAssistant: { scheduleDate?: string } | undefined;
  MealPlannerSettings: undefined;
  AddMeal: { date: string };

  // ----- Trips -----
  Trips: undefined;
  TripForm: { id?: string };
  TripDetail: { id: string };
  TripItemForm: { tripId: string; itemId?: string; date?: string };
  TripSettle: { id: string };
  TripAssistant: { tripId: string; tripName?: string };

  // ----- Profile -----
  ProfileHome: undefined;
  // `section` deep-links to a collapsible section on the Account screen.
  Account: { section?: 'account' | 'reminders' | 'security' } | undefined;
  // The dedicated Privacy & Data screen. `focus` deep-links intent: 'unlock'
  // (locked-data prompt — auto-presents Face ID) or 'recovery'.
  PrivacyData: { focus?: 'unlock' | 'recovery' } | undefined;
  // The recovery-code detail view — explains it + create/replace the code.
  RecoveryCode: undefined;
  // Signal-parity F4 — QR device linking. 'show' = the new (locked) device shows
  // its code; 'scan' = an existing (unlocked) device scans + hands over the keys.
  LinkDevice: { mode: 'show' | 'scan' };
  // Dual-control guardian recovery. 'setup' = arm/remove a guardian; 'recover' =
  // the locked user requests + finishes with their PIN; 'approve' = the guardian
  // hands over the PIN-locked key. See specs/features/guardian-recovery.md.
  GuardianRecovery: { mode?: 'setup' | 'recover' | 'approve' } | undefined;
  People: undefined;
  PersonDetail: { id: string };
  PersonForm: {
    id?: string;
    isSelf?: boolean;
    type?: 'family' | 'friend' | 'service';
    // Review-mode import: a queue of prefilled contacts to step through. The
    // form saves the one at `queueIndex`, then advances to the next.
    prefills?: PersonPrefill[];
    queueIndex?: number;
  };
  ContactImport: undefined;
  Household: undefined;

  // ----- Plan & billing (status hub is inlined on ProfileHome) -----
  ComparePlans: undefined; // the paywall proper (tier catalog + purchase)
  AiUsage: undefined;      // usage drill-in (per member / per feature)
  Upsell: { reason: 'quota' | 'warning' } | undefined; // focused upgrade sheet from the AI nudges
};
