import React, { useEffect, useLayoutEffect } from 'react';
import { TouchableOpacity, Text, StyleSheet } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useChat } from '../../hooks/useChat';
import ChatScreen from '../chat/ChatScreen';
import AiUsageBanner from '../../components/AiUsageBanner';
import { ASSISTANT_NAME } from '../../config';
import { tripsApi, householdApi } from '../../api';
import { getHDK, openRecord } from '../../lib/e2ee';
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

  // Ephemeral-consent (§9.1 P4a): post-drop the server can't read trip content,
  // so send the decrypted trip + itinerary per request. Dormant pre-drop.
  const ephemeralRef = React.useRef<Record<string, unknown> | null>(null);

  const chat = useChat({
    endpoint: '/vacation/chat',
    contextEndpoint: `/vacation/chat/context?tripId=${tripId}`,
    // Post-drop the DB summary is sealed — POST the decrypted trip instead.
    contextBody: () => (ephemeralRef.current ? { tripId, ...ephemeralRef.current } : null),
    buildBody: (messages) => ({ tripId, messages, ...(ephemeralRef.current || {}) }),
    onResult: () => qc.invalidateQueries({ queryKey: ['trips', tripId] }),
    toolLabels: {
      open_trip: 'Opening the trip…',
      open_add_booking: 'Opening the booking form…',
    },
  });

  useEffect(() => {
    chat.loadContext();
    (async () => {
      try {
        let e2eeActive = false;
        try { e2eeActive = !!(await householdApi.get()).data.e2eeActive; } catch { /* solo/offline */ }
        if (!e2eeActive || !getHDK()) return;
        const { data } = await tripsApi.get(tripId);
        const trip = await openRecord('Trip', (data as any).trip);
        const items = await Promise.all(((data as any).items || []).map((i: any) => openRecord('TripItem', i)));
        ephemeralRef.current = { trip, items };
        chat.loadContext(); // refresh the summary with the decrypted records
      } catch { /* non-fatal */ }
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
      banner={<AiUsageBanner />}
      accessory="bag-suitcase"
      emptyText={`Hi, I'm ${ASSISTANT_NAME}. In here I can see ${tripName || 'this trip'} — ask about the itinerary, costs, or what's left to plan.`}
      emptyHint={'e.g. "What\'s my itinerary?"'}
      placeholder="Message…"
    />
  );
}

const styles = StyleSheet.create({
  clear: { color: '#fff', fontSize: 15, fontWeight: '500' },
});
