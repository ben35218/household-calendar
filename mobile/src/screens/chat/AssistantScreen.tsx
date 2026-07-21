import React, { useState } from 'react';
import { useRoute, type RouteProp } from '@react-navigation/native';
import type { RootStackParamList } from '../../navigation/types';
import type { AssistantId } from './assistantTabs';
import CalendarAssistantScreen from '../calendar/CalendarAssistantScreen';
import ChoresAssistantScreen from '../maintenance/ChoresAssistantScreen';
import AiTaskPlanChatScreen from '../maintenance/AiTaskPlanChatScreen';
import TripPickerScreen from '../trips/TripPickerScreen';
import TripAssistantScreen from '../trips/TripAssistantScreen';

// Unified assistant view. Calendar, Chores, Task Plan and Trips are no longer
// separate routes — they're bodies swapped in place here, so the switcher hops
// between them without a navigation transition and the header stays "Calen".
// `initial` seeds which body opens (from the surface that launched the chat).
//
// Trips is a two-step body: without a chosen trip it shows the picker; once the
// user selects (or the picker hands back) a trip, it drops into that trip's
// assistant. Switching away from Trips remembers the selection so returning
// resumes it; "Change trip" clears it back to the picker.
export default function AssistantScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'Assistant'>>();
  const [active, setActive] = useState<AssistantId>(route.params?.initial ?? 'calendar');
  const [trip, setTrip] = useState<{ id: string; name?: string } | null>(null);

  if (active === 'chores') return <ChoresAssistantScreen onSelectAssistant={setActive} />;
  if (active === 'maintenance') return <AiTaskPlanChatScreen onSelectAssistant={setActive} />;
  if (active === 'trips') {
    return trip ? (
      <TripAssistantScreen
        key={trip.id}
        tripId={trip.id}
        tripName={trip.name}
        onSelectAssistant={setActive}
        onChangeTrip={() => setTrip(null)}
      />
    ) : (
      <TripPickerScreen onSelectAssistant={setActive} onPickTrip={(id, name) => setTrip({ id, name })} />
    );
  }
  return <CalendarAssistantScreen onSelectAssistant={setActive} focusEvent={route.params?.focusEvent} />;
}
