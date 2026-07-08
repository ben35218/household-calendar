import React, { useCallback, useEffect, useLayoutEffect } from 'react';
import { TouchableOpacity, Text, StyleSheet, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useQueryClient } from '@tanstack/react-query';
import { useChat } from '../../hooks/useChat';
import ChatScreen from '../chat/ChatScreen';
import AiUsageBanner from '../../components/AiUsageBanner';
import { peopleApi, householdApi, calendarApi } from '../../api';
import { getHDK, openRecord, sealNew } from '../../lib/e2ee';
import type { RootStackParamList } from '../../navigation/types';
import { loadCalendarSources } from '../../lib/calendarData';
import { loadForecast } from '../../lib/weather';
import { usePrivacyPrefs } from '../../lib/privacyPrefs';

// Turn the assistant's drafted event (open_create_event_form input) into the
// CalendarEvent payload the API expects — mirrors EventFormScreen's save logic
// so "Save this to my calendar" produces the same record as saving the form.
function buildEventPayload(ev: Record<string, any>): Record<string, unknown> {
  const allDay = ev.allDay !== false; // events default to all-day
  const startDate = allDay
    ? `${ev.date}T12:00:00.000Z`
    : new Date(`${ev.date}T${ev.startTime || '09:00'}:00`).toISOString();
  const endPart = ev.endDate || ev.date;
  const endDate = allDay
    ? ev.endDate
      ? `${ev.endDate}T12:00:00.000Z`
      : undefined
    : ev.endTime
    ? new Date(`${endPart}T${ev.endTime}:00`).toISOString()
    : undefined;
  return {
    title: String(ev.title || '').trim(),
    calendarType: ev.calendarType || 'activities',
    allDay,
    startDate,
    endDate,
    description: ev.description || undefined,
    phone: ev.phone || undefined,
    reminderMinutes: typeof ev.reminderMinutes === 'number' ? ev.reminderMinutes : undefined,
    recurrence: ev.recurrFreq ? { freq: ev.recurrFreq } : undefined,
  };
}

// Calendar Assistant — ports client/src/views/CalendarAssistantView.vue.
// navigateTo from the web (router paths) doesn't map to RN screens, so instead
// of navigating we just refresh the calendar so any changes the assistant made
// show up. (Deep-link mapping of navigateTo is a deferred polish item.)
export default function CalendarAssistantScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>();
  const qc = useQueryClient();
  // Privacy toggle ("Use personal & contact info in prompts"). Read reactively so
  // the assistant's system prompt, its "what I can see" panel, and the decrypt/
  // upload of contacts all track the setting — and re-sync if it resolves late.
  const usePersonal = usePrivacyPrefs().prefs.aiUsePersonalInfo;

  // Ephemeral-consent (§9.1 P4c): post-drop send decrypted people + calendar
  // sources so the server needn't read stored plaintext. Dormant pre-drop.
  const ephemeralRef = React.useRef<Record<string, unknown> | null>(null);

  const chat = useChat({
    endpoint: '/calendar/chat',
    // Pass the toggle to the context endpoint too, so the "what I can see" panel
    // doesn't claim access to household details the prompt won't actually get.
    contextEndpoint: `/calendar/chat/context?includePersonalInfo=${usePersonal}`,
    // Privacy toggle: tell the server whether it may use household contacts in the
    // prompt. When off, the server withholds them (and we also skip decrypting/
    // sending people below, so plaintext contacts never leave the device).
    buildBody: (messages) => ({
      messages,
      includePersonalInfo: usePersonal,
      ...(ephemeralRef.current || {}),
    }),
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

  // (Re)load the "what I can see & do" panel whenever the toggle resolves/changes
  // so it stays truthful about whether household details are in scope.
  useEffect(() => {
    chat.loadContext();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usePersonal]);

  useEffect(() => {
    (async () => {
      try {
        let e2eeActive = false;
        try { e2eeActive = !!(await householdApi.get()).data.e2eeActive; } catch { /* solo/offline */ }
        if (!e2eeActive || !getHDK()) return;
        // Honor the privacy toggle: when contacts aren't allowed in prompts, don't
        // even decrypt/upload them — the server withholds them regardless.
        const now = new Date();
        const from = new Date(now.getFullYear() - 1, 0, 1).toISOString();
        const to = new Date(now.getFullYear() + 2, 0, 1).toISOString();
        const [calendarSources, peopleRows, weather] = await Promise.all([
          loadCalendarSources({ from, to }),
          usePersonal
            ? peopleApi.list().then(({ data }) => Promise.all(data.map((p) => openRecord('Person', p as any))))
            : Promise.resolve([]),
          loadForecast().catch(() => null),
        ]);
        ephemeralRef.current = { people: peopleRows, calendarSources, ...(weather ? { weather } : {}) };
      } catch { /* non-fatal — server falls back to its DB read */ }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [usePersonal]);

  // After the assistant drafts an event it pins two chips: "Save this to my
  // calendar" (create it directly) and "Edit in form" (open the pre-filled create
  // form). Both consume the draft; any other chip falls through to a chat send.
  const handleFollowup = useCallback(
    (text: string): boolean => {
      const ev = chat.pendingEvent as Record<string, any> | null;
      if (!ev) return false;
      if (text === 'Edit in form') {
        chat.resolvePending();
        navigation.navigate('EventForm', { prefill: ev });
        return true;
      }
      if (text === 'Save this to my calendar') {
        (async () => {
          try {
            // E2EE dual-write: seal ciphertext alongside plaintext (no-op without an HDK).
            await calendarApi.createEvent(await sealNew('CalendarEvent', buildEventPayload(ev)));
            qc.invalidateQueries({ queryKey: ['calendar'] });
            chat.resolvePending();
            Alert.alert('Added to your calendar', String(ev.title || 'Event'));
          } catch (e: any) {
            Alert.alert('Couldn’t save', e?.response?.data?.error || 'Please try again.');
          }
        })();
        return true;
      }
      return false;
    },
    [chat, navigation, qc]
  );

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
      emptyIcon="calendar-edit"
      emptyText="Ask me to add appointments, activities, or changes to your calendar."
      emptyHint='e.g. "Add a dentist appointment on June 20"'
      placeholder="Message…"
      onFollowupPress={handleFollowup}
    />
  );
}

const styles = StyleSheet.create({
  clear: { color: '#fff', fontSize: 15, fontWeight: '500' },
});
