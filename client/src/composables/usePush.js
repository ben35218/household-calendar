import { ref } from 'vue';
import { notificationsApi } from '../services/api';

// Web Push opt-in flow (#8): registers the service worker, subscribes via the
// PushManager using the server's VAPID public key, and stores the subscription
// server-side. Degrades gracefully when the browser or server lacks support.

const supported = ref('serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
const subscribed = ref(false);
const configured = ref(false);   // server has VAPID keys
const busy = ref(false);

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  return Uint8Array.from([...raw].map((c) => c.charCodeAt(0)));
}

async function getRegistration() {
  let reg = await navigator.serviceWorker.getRegistration('/');
  if (!reg) reg = await navigator.serviceWorker.register('/sw.js');
  // pushManager.subscribe() needs an ACTIVE service worker. register() resolves
  // before activation finishes, so wait for it — otherwise the first opt-in
  // throws "no active Service Worker". `ready` resolves to the active reg.
  return navigator.serviceWorker.ready;
}

// Reflect current state (server config + existing subscription).
async function refresh() {
  if (!supported.value) return;
  try {
    const { data } = await notificationsApi.pushKey();
    configured.value = !!data.configured;
    if (!configured.value) return;
    const reg = await getRegistration();
    const sub = await reg.pushManager.getSubscription();
    subscribed.value = !!sub;
  } catch {
    configured.value = false;
  }
}

async function subscribe() {
  if (!supported.value) throw new Error('Push not supported in this browser');
  busy.value = true;
  try {
    if (Notification.permission === 'denied') {
      throw new Error('Notifications are blocked for this site — enable them in your browser’s site settings, then try again.');
    }
    const perm = await Notification.requestPermission();
    if (perm !== 'granted') throw new Error('Notification permission was not granted');

    const { data } = await notificationsApi.pushKey();
    if (!data.configured || !data.publicKey) {
      throw new Error('Push isn’t configured on the server (restart the API after setting VAPID keys).');
    }

    const reg = await getRegistration();
    const opts = {
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(data.publicKey),
    };
    let sub;
    try {
      sub = await reg.pushManager.subscribe(opts);
    } catch (err) {
      if (err.name === 'InvalidStateError') {
        // A leftover subscription created with a different VAPID key blocks a
        // new one — drop it and retry once.
        const stale = await reg.pushManager.getSubscription();
        if (stale) await stale.unsubscribe();
        sub = await reg.pushManager.subscribe(opts);
      } else if (err.name === 'AbortError') {
        // The browser couldn't reach its push backend (FCM for Chrome). Often
        // transient — wait briefly and try once more before giving up.
        await new Promise((r) => setTimeout(r, 1500));
        sub = await reg.pushManager.subscribe(opts);
      } else {
        throw err;
      }
    }
    await notificationsApi.subscribe(sub.toJSON(), navigator.userAgent);
    subscribed.value = true;
  } catch (err) {
    // AbortError = the browser's push service is unreachable; the raw text isn't
    // actionable, so translate it. Otherwise surface the DOMException name.
    if (err.name === 'AbortError') {
      throw new Error(
        "Your browser couldn't reach its push service. Check your internet/VPN/firewall; " +
        'on Brave, enable “Use Google services for push messaging” in Settings → Privacy. ' +
        'Chrome, Edge or Firefox are the most reliable for local testing.',
      );
    }
    const detail = err.name && err.name !== 'Error' ? ` (${err.name})` : '';
    throw new Error(`${err.message || 'Could not enable push'}${detail}`);
  } finally {
    busy.value = false;
  }
}

async function unsubscribe() {
  busy.value = true;
  try {
    const reg = await getRegistration();
    const sub = await reg.pushManager.getSubscription();
    if (sub) {
      await notificationsApi.unsubscribe(sub.endpoint).catch(() => {});
      await sub.unsubscribe();
    }
    subscribed.value = false;
  } finally {
    busy.value = false;
  }
}

export function usePush() {
  return { supported, subscribed, configured, busy, refresh, subscribe, unsubscribe };
}
