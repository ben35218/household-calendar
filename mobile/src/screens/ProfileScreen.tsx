import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, Alert } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../store/auth';
import { Button, Card } from '../components/ui';
import { registerForPushNotifications } from '../lib/push';
import { colors, spacing } from '../theme';
import type { ProfileStackParamList } from '../navigation/ProfileNavigator';

export default function ProfileScreen() {
  const nav = useNavigation<NativeStackNavigationProp<ProfileStackParamList>>();
  const { user, logout } = useAuth();
  const [pushBusy, setPushBusy] = useState(false);
  const [pushEnabled, setPushEnabled] = useState(false);

  async function enablePush() {
    setPushBusy(true);
    try {
      const token = await registerForPushNotifications();
      if (token) {
        setPushEnabled(true);
        Alert.alert('Notifications enabled', 'This device will now receive reminders.');
      } else {
        Alert.alert(
          'Not available',
          'Push needs a physical device with notifications allowed (and a configured EAS projectId).'
        );
      }
    } catch (e: any) {
      Alert.alert('Error', e?.message || 'Could not enable notifications.');
    } finally {
      setPushBusy(false);
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Card style={styles.card}>
        <Text style={styles.name}>
          {user?.firstName} {user?.lastName}
        </Text>
        <Text style={styles.email}>{user?.email}</Text>
        {user?.role === 'admin' ? <Text style={styles.badge}>Admin</Text> : null}
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Notifications</Text>
        <Text style={styles.sectionNote}>
          {pushEnabled
            ? 'This device is registered for push reminders.'
            : 'Enable push to get reminders for tasks, chores, and events.'}
        </Text>
        <Button
          title={pushEnabled ? 'Notifications enabled' : 'Enable notifications'}
          variant="ghost"
          disabled={pushEnabled}
          loading={pushBusy}
          onPress={enablePush}
        />
      </Card>

      <Card style={styles.card}>
        <Text style={styles.sectionTitle}>Plan</Text>
        <Text style={styles.sectionNote}>Manage your subscription and unlock more AI actions.</Text>
        <Button title="View plans" variant="ghost" onPress={() => nav.navigate('Paywall')} />
      </Card>

      <Button title="Sign out" onPress={() => logout()} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  content: { padding: spacing.md },
  card: { marginBottom: spacing.md },
  name: { fontSize: 20, fontWeight: '700', color: colors.text },
  email: { fontSize: 14, color: colors.textMuted, marginTop: 2 },
  badge: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    backgroundColor: colors.primary,
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    overflow: 'hidden',
  },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: colors.text, marginBottom: 4 },
  sectionNote: { fontSize: 13, color: colors.textMuted, marginBottom: spacing.md, lineHeight: 18 },
});
