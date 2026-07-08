import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import Constants from 'expo-constants';
import { notificationsApi } from '../api';

// Remote-push token registration. Currently unwired: reminders are delivered
// as on-device local notifications (lib/notifications.ts), and the server cron
// skips localReminders users. Kept for server-originated pushes that can't be
// computed locally (e.g. event-invitation alerts).
//
// Ask permission, get the Expo push token, and register it with the backend so
// the server can deliver via APNs/FCM through the Expo Push API
// (server/src/services/push.js sendToExpo). Returns the token, or null if
// unavailable (simulator, denied permission, or missing projectId).
export async function registerForPushNotifications(): Promise<string | null> {
  if (!Device.isDevice) return null; // push tokens require a physical device

  const { status: existing } = await Notifications.getPermissionsAsync();
  let status = existing;
  if (existing !== 'granted') {
    status = (await Notifications.requestPermissionsAsync()).status;
  }
  if (status !== 'granted') return null;

  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('default', {
      name: 'Reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }

  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;
  const { data: token } = await Notifications.getExpoPushTokenAsync(
    projectId ? { projectId } : undefined
  );

  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  await notificationsApi.registerNative(token, platform, Device.modelName ?? undefined);
  return token;
}

export async function unregisterPushToken(token: string): Promise<void> {
  await notificationsApi.unregisterNative(token).catch(() => {});
}
