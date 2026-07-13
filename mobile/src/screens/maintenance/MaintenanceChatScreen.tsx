import React, { useEffect, useLayoutEffect, useState } from 'react';
import { TouchableOpacity, Text, View, StyleSheet } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useChat } from '../../hooks/useChat';
import ChatScreen from '../chat/ChatScreen';
import AiUsageBanner from '../../components/AiUsageBanner';
import { ASSISTANT_NAME } from '../../config';
import { itemsApi, tasksApi, householdApi } from '../../api';
import { getHDK, openRecord, sealNew } from '../../lib/e2ee';
import { MaintenanceStackParamList } from '../../navigation/MaintenanceNavigator';
import { colors, radius, spacing } from '../../theme';

type Rt = RouteProp<MaintenanceStackParamList, 'MaintenanceChat'>;

// Encrypted maintenance-task content (mirrors TaskFormScreen).
const TASK_ENC = (p: Record<string, unknown>) => ({
  title: p.title, description: p.description, instructions: p.instructions,
  estimatedCost: p.estimatedCost, estimatedDurationMins: p.estimatedDurationMins,
});

// Maintenance Assistant — ports client/src/views/MaintenanceChatView.vue.
// Scoped to one item; surfaces a banner when tasks get created and refreshes
// the item's task list.
export default function MaintenanceChatScreen() {
  const navigation = useNavigation();
  const { itemId, itemName } = useRoute<Rt>().params;
  const qc = useQueryClient();
  const [createdTasks, setCreatedTasks] = useState<{ id: string; title: string }[]>([]);

  // Ephemeral-consent (§9.1 P4a): post-drop send the decrypted item so the server
  // needn't read stored plaintext for the system prompt. Dormant pre-drop.
  const ephemeralRef = React.useRef<Record<string, unknown> | null>(null);

  const chat = useChat({
    endpoint: '/maintenance/chat',
    contextEndpoint: `/maintenance/chat/context?itemId=${itemId}`,
    // Post-drop the DB summary is sealed — POST the decrypted item instead.
    contextBody: () => (ephemeralRef.current ? { itemId, ...ephemeralRef.current } : null),
    buildBody: (messages) => ({ itemId, messages, ...(ephemeralRef.current || {}) }),
    onResult: async (data) => {
      // Post-drop the server hands back proposed tasks for the client to create
      // *encrypted* (§9.1 P4d); pre-drop the server already created them.
      if (data.clientCreateTasks?.length) {
        const created: { id: string; title: string }[] = [];
        for (const p of data.clientCreateTasks) {
          try {
            const payload = {
              itemId, title: p.title, description: p.description,
              recurrence: p.recurrence, nextDueDate: p.nextDueDate,
              priority: p.priority, categoryId: p.categoryId,
            };
            const { data: t } = await tasksApi.create(await sealNew('MaintenanceTask', payload, TASK_ENC(payload)));
            created.push({ id: t._id, title: String(p.title) });
          } catch { /* skip a failed task, keep the rest */ }
        }
        if (created.length) setCreatedTasks((prev) => prev.concat(created));
        qc.invalidateQueries({ queryKey: ['tasks', 'forItem', itemId] });
      } else if (data.tasksCreated?.length) {
        setCreatedTasks((prev) => prev.concat(data.tasksCreated!));
        qc.invalidateQueries({ queryKey: ['tasks', 'forItem', itemId] });
      }
    },
    toolLabels: {
      get_item_tasks: 'Reviewing existing tasks…',
      get_categories: 'Loading categories…',
      create_tasks: 'Adding tasks…',
    },
  });

  useEffect(() => {
    chat.loadContext();
    (async () => {
      try {
        let e2eeActive = false;
        try { e2eeActive = !!(await householdApi.get()).data.e2eeActive; } catch { /* solo/offline */ }
        if (!e2eeActive || !getHDK()) return;
        const [item, tasks] = await Promise.all([
          openRecord('Item', (await itemsApi.get(itemId)).data as any),
          tasksApi.list({ item: itemId })
            .then(({ data }) => Promise.all(data.map((t) => openRecord('MaintenanceTask', t as any))))
            .catch(() => []),
        ]);
        ephemeralRef.current = { item, tasks };
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

  const banner = (
    <>
      <AiUsageBanner />
      {createdTasks.length > 0 ? (
        <View style={styles.banner}>
          <Text style={styles.bannerTitle}>
            {createdTasks.length} task{createdTasks.length > 1 ? 's' : ''} added
          </Text>
          {createdTasks.map((t) => (
            <Text key={t.id} style={styles.bannerLine}>
              • {t.title}
            </Text>
          ))}
        </View>
      ) : null}
    </>
  );

  return (
    <ChatScreen
      chat={chat}
      banner={banner}
      accessory="wrench"
      emptyText={`Hi, I'm ${ASSISTANT_NAME}. In this chat I help set up maintenance tasks${itemName ? ` for ${itemName}` : ''}.`}
      emptyHint='e.g. "What maintenance does my HVAC system need?"'
      placeholder="Ask about maintenance tasks…"
    />
  );
}

const styles = StyleSheet.create({
  clear: { color: '#fff', fontSize: 15, fontWeight: '500' },
  banner: {
    backgroundColor: colors.success + '1A',
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: spacing.md,
  },
  bannerTitle: { fontSize: 14, fontWeight: '700', color: colors.success, marginBottom: 4 },
  bannerLine: { fontSize: 13, color: colors.text },
});
