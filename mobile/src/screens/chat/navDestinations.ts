import type { RootStackParamList } from '../../navigation/types';

// Maps a server-supplied nav-suggestion `view` id (from the suggest_navigation
// tool — see server/src/services/navDestinations.js) to a screen + params in the
// app. Keep the ids in sync with the server catalog. `ctx` carries values only
// known on the client, e.g. the current trip id for the trip assistant.
export type NavTarget = { route: keyof RootStackParamList; params?: object };

export function navTargetForView(view: string, ctx: { tripId?: string } = {}): NavTarget | null {
  switch (view) {
    // Calendar
    case 'view_calendar': return { route: 'CalendarHome' };
    case 'calendar_search': return { route: 'CalendarSearch' };
    case 'manage_calendars': return { route: 'Calendars' };
    case 'birthdays': return { route: 'Birthdays' };
    case 'weather': return { route: 'Weather' };
    // Chores
    case 'chores_list': return { route: 'ChoresHome' };
    case 'chore_templates': return { route: 'ChoreTemplates' };
    // Maintenance
    case 'maintenance_home': return { route: 'MaintenanceHome' };
    case 'task_templates': return { route: 'TaskTemplates' };
    // Trips (these need the current trip)
    case 'trips_list': return { route: 'Trips' };
    case 'open_trip': return ctx.tripId ? { route: 'TripDetail', params: { id: ctx.tripId } } : null;
    case 'add_booking': return ctx.tripId ? { route: 'TripItemForm', params: { tripId: ctx.tripId } } : null;
    default: return null;
  }
}
