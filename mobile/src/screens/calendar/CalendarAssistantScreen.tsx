import React, { useEffect, useLayoutEffect } from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useChat } from '../../hooks/useChat';
import ChatScreen from '../chat/ChatScreen';
import { peopleApi, householdApi } from '../../api';
import { getHDK, openRecord } from '../../lib/e2ee';
import { loadCalendarSources } from '../../lib/calendarData';
import { loadForecast } from '../../lib/weather';

// Calendar Assistant — ports client/src/views/CalendarAssistantView.vue.
// navigateTo from the web (router paths) doesn't map to RN screens, so instead
// of navigating we just refresh the calendar so any changes the assistant made
// show up. (Deep-link mapping of navigateTo is a deferred polish item.)
export default function CalendarAssistantScreen() {
  const navigation = useNavigation();
  const qc = useQueryClient();

  // Ephemeral-consent (§9.1 P4c): post-drop send decrypted people + calendar
  // sources so the server needn't read stored plaintext. Dormant pre-drop.
  const ephemeralRef = React.useRef<Record<string, unknown> | null>(null);

  const chat = useChat({
    endpoint: '/calendar/chat',
    contextEndpoint: '/calendar/chat/context',
    buildBody: (messages) => ({ messages, ...(ephemeralRef.current || {}) }),
    onResult: () => qc.invalidateQueries({ queryKey: ['calendar'] }),
    toolLabels: {
      list_events: 'Checking your calendar…',
      open_create_event_form: 'Opening the event form…',
      open_edit_event_form: 'Opening the event…',
      open_delete_event_form: 'Opening the event…',
      call_business: 'Placing the call…',
      check_call_status: 'Checking the call…',
      get_weather_forecast: 'Checking the weather…',
    },
  });

  useEffect(() => {
    chat.loadContext();
    (async () => {
      try {
        let e2eeActive = false;
        try { e2eeActive = !!(await householdApi.get()).data.e2eeActive; } catch { /* solo/offline */ }
        if (!e2eeActive || !getHDK()) return;
        const now = new Date();
        const from = new Date(now.getFullYear() - 1, 0, 1).toISOString();
        const to = new Date(now.getFullYear() + 2, 0, 1).toISOString();
        const [calendarSources, peopleRows, weather] = await Promise.all([
          loadCalendarSources({ from, to }),
          peopleApi.list().then(({ data }) => Promise.all(data.map((p) => openRecord('Person', p as any)))),
          loadForecast().catch(() => null),
        ]);
        ephemeralRef.current = { people: peopleRows, calendarSources, ...(weather ? { weather } : {}) };
      } catch { /* non-fatal — server falls back to its DB read */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    navigation.setOptions({
      headerRight: () =>
        chat.messages.length > 0 ? (
          <TouchableOpacity onPress={chat.clear} disabled={chat.loading}>
            <Text style={styles.clear}>Clear</Text>
          </TouchableOpacity>
        ) : undefined,
    });
  }, [navigation, chat.messages.length, chat.loading, chat.clear]);

  return (
    <ChatScreen
      chat={chat}
      emptyIcon="calendar-edit"
      emptyText="Ask me to add appointments, activities, or changes to your calendar."
      emptyHint='e.g. "Add a dentist appointment on June 20"'
      placeholder="Add a dentist appointment on June 20…"
    />
  );
}

const styles = StyleSheet.create({
  clear: { color: '#fff', fontSize: 15, fontWeight: '500' },
});
