// On-device reminder notifications (Phase 5).
//
// Replaces the server push cron for reminders with Expo local notifications
// computed on-device. The data comes from the calendar range endpoint (events,
// tasks, chores, birthdays — already expanded per occurrence with their reminder
// fields); post-plaintext-drop this same computation runs over the decrypted
// local replica instead. See docs/E2EE-SYNC-PLAN.md §7 / §1.5.
//
// iOS caps pending notifications at ~64, so we only schedule a rolling window
// (the soonest MAX_SCHEDULED within WINDOW_DAYS) and re-schedule on every app
// foreground — far-future reminders are guaranteed only once the window reaches
// them. The foreground-refresh is the reliability floor; a background task can
// tighten it later.

import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { notificationsApi, CalendarData } from '../api';
import { loadCalendarData } from './calendarData';
import { getPrivacyPrefs } from './privacyPrefs';

const WINDOW_DAYS = 21;
const MAX_SCHEDULED = 60;  // headroom under the iOS ~64 pending cap
const ALERT_HOUR = 7;      // local 7am for day-based alerts (mirrors the server cron)

interface Reminder { at: Date; title: string; body: string; }

// yyyy-mm-dd at a local wall-clock hour.
function atLocalHour(dateStr: string, hour: number): Date {
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d, hour, 0, 0, 0);
}
function dateStrMinusDays(dateStr: string, days: number): string {
  const d = atLocalHour(dateStr, 0);
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Day-based alert(s) for a task/chore: (dueDate − reminderDaysBefore) at 7am,
// plus the optional second offset. Mirrors scheduler.js `alertsToday`.
function pushDayAlerts(out: Reminder[], item: { nextDueDate?: string; reminderDaysBefore?: number | null; alert2DaysBefore?: number | null; title: string }, body: string, now: number) {
  if (!item.nextDueDate) return;
  const dueStr = item.nextDueDate.slice(0, 10);
  for (const off of [item.reminderDaysBefore, item.alert2DaysBefore]) {
    if (off == null) continue;
    const at = atLocalHour(dateStrMinusDays(dueStr, off), ALERT_HOUR);
    if (at.getTime() > now) out.push({ at, title: item.title, body });
  }
}

// Turn a calendar range into the soonest reminders to schedule.
export function computeReminders(data: CalendarData): Reminder[] {
  const out: Reminder[] = [];
  const now = Date.now();

  for (const e of data.events) {
    if (!e.startDate) continue;
    const start = new Date(e.startDate).getTime();
    for (const mins of [e.reminderMinutes, e.alert2Minutes]) {
      if (mins == null) continue;
      const at = new Date(start - mins * 60000);
      if (at.getTime() > now) out.push({ at, title: e.title, body: 'Upcoming event' });
    }
  }
  for (const t of data.tasks) pushDayAlerts(out, t, 'Maintenance due', now);
  for (const c of data.chores) pushDayAlerts(out, c, 'Chore due', now);
  for (const b of data.birthdays) {
    const at = atLocalHour(b.date, ALERT_HOUR);
    if (at.getTime() > now) out.push({ at, title: '🎂 Birthday today', body: b.name });
  }

  return out.sort((a, b) => a.at.getTime() - b.at.getTime()).slice(0, MAX_SCHEDULED);
}

// Ensure notification permission, prompting once if undetermined.
export async function ensureNotificationPermission(): Promise<boolean> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return true;
  const req = await Notifications.requestPermissionsAsync();
  return req.status === 'granted';
}

// Recompute the rolling window and (re)schedule it. Cancels the previous batch
// first so nothing double-fires. Returns the count scheduled (0 if not permitted
// or offline). Safe to call often (app foreground, after edits).
// Tell the server we handle reminders on-device so its push cron skips us —
// only when the value actually changes (not on every foreground refresh).
let serverFlag: boolean | null = null;
async function syncServerFlag(enabled: boolean) {
  if (serverFlag === enabled) return;
  serverFlag = enabled;
  try { await notificationsApi.setLocalReminders(enabled); } catch { serverFlag = null; }
}

export async function rescheduleReminders(): Promise<number> {
  try {
    // Respect the user's on/off toggle even if called outside the scheduler hook.
    if (!getPrivacyPrefs().remindersEnabled) { await cancelAllReminders(); await syncServerFlag(false); return 0; }
    if (!(await ensureNotificationPermission())) { await syncServerFlag(false); return 0; }
    await syncServerFlag(true);
    if (Platform.OS === 'android') {
      await Notifications.setNotificationChannelAsync('reminders', {
        name: 'Reminders',
        importance: Notifications.AndroidImportance.DEFAULT,
      });
    }
    const from = new Date();
    const to = new Date(Date.now() + WINDOW_DAYS * 86400000);
    const data = await loadCalendarData({ from: from.toISOString(), to: to.toISOString() });
    const reminders = computeReminders(data);

    await Notifications.cancelAllScheduledNotificationsAsync();
    for (const r of reminders) {
      await Notifications.scheduleNotificationAsync({
        content: { title: r.title, body: r.body },
        trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: r.at },
      });
    }
    return reminders.length;
  } catch {
    return 0; // offline / transient — the next foreground pass retries
  }
}

export async function cancelAllReminders(): Promise<void> {
  serverFlag = null; // forget the synced state so the next signed-in user re-syncs
  await Notifications.cancelAllScheduledNotificationsAsync().catch(() => {});
}
