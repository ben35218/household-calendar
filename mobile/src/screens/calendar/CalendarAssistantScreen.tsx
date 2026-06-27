import React, { useEffect, useLayoutEffect } from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useChat } from '../../hooks/useChat';
import ChatScreen from '../chat/ChatScreen';

// Calendar Assistant — ports client/src/views/CalendarAssistantView.vue.
// navigateTo from the web (router paths) doesn't map to RN screens, so instead
// of navigating we just refresh the calendar so any changes the assistant made
// show up. (Deep-link mapping of navigateTo is a deferred polish item.)
export default function CalendarAssistantScreen() {
  const navigation = useNavigation();
  const qc = useQueryClient();

  const chat = useChat({
    endpoint: '/calendar/chat',
    contextEndpoint: '/calendar/chat/context',
    buildBody: (messages) => ({ messages }),
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
