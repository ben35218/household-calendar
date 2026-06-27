import React, { useEffect, useLayoutEffect } from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useChat } from '../../hooks/useChat';
import ChatScreen from '../chat/ChatScreen';
import { TripsStackParamList } from '../../navigation/TripsNavigator';

type Rt = RouteProp<TripsStackParamList, 'VacationAssistant'>;

// Vacation Assistant — ports client/src/views/VacationAssistantView.vue.
// navigateTo (web router paths) doesn't map to RN screens; instead we refresh
// the trip so any bookings the assistant added show up. (Deep-link mapping of
// navigateTo is a deferred polish item.)
export default function VacationAssistantScreen() {
  const navigation = useNavigation();
  const { tripId, tripName } = useRoute<Rt>().params;
  const qc = useQueryClient();

  const chat = useChat({
    endpoint: '/vacation/chat',
    contextEndpoint: `/vacation/chat/context?tripId=${tripId}`,
    buildBody: (messages) => ({ tripId, messages }),
    onResult: () => qc.invalidateQueries({ queryKey: ['trips', tripId] }),
    toolLabels: {
      open_trip: 'Opening the trip…',
      open_add_booking: 'Opening the booking form…',
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
      emptyIcon="bag-suitcase"
      emptyText={`Ask me about ${tripName || 'this trip'} — your itinerary, costs, or what's left to plan.`}
      emptyHint={'e.g. "What\'s my itinerary?"'}
      placeholder="Ask about this trip…"
    />
  );
}

const styles = StyleSheet.create({
  clear: { color: '#fff', fontSize: 15, fontWeight: '500' },
});
