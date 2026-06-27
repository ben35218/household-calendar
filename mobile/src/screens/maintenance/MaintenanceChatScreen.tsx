import React, { useEffect, useLayoutEffect, useState } from 'react';
import { TouchableOpacity, Text, View, StyleSheet } from 'react-native';
import { useNavigation, useRoute, RouteProp } from '@react-navigation/native';
import { useQueryClient } from '@tanstack/react-query';
import { useChat } from '../../hooks/useChat';
import ChatScreen from '../chat/ChatScreen';
import { MaintenanceStackParamList } from '../../navigation/MaintenanceNavigator';
import { colors, radius, spacing } from '../../theme';

type Rt = RouteProp<MaintenanceStackParamList, 'MaintenanceChat'>;

// Maintenance Assistant — ports client/src/views/MaintenanceChatView.vue.
// Scoped to one item; surfaces a banner when tasks get created and refreshes
// the item's task list.
export default function MaintenanceChatScreen() {
  const navigation = useNavigation();
  const { itemId, itemName } = useRoute<Rt>().params;
  const qc = useQueryClient();
  const [createdTasks, setCreatedTasks] = useState<{ id: string; title: string }[]>([]);

  const chat = useChat({
    endpoint: '/maintenance/chat',
    contextEndpoint: `/maintenance/chat/context?itemId=${itemId}`,
    buildBody: (messages) => ({ itemId, messages }),
    onResult: (data) => {
      if (data.tasksCreated?.length) {
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

  const banner =
    createdTasks.length > 0 ? (
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
    ) : null;

  return (
    <ChatScreen
      chat={chat}
      banner={banner}
      emptyIcon="wrench"
      emptyText={`Chat with your maintenance assistant to set up tasks${itemName ? ` for ${itemName}` : ''}.`}
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
