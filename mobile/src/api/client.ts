import axios from 'axios';
import { Platform } from 'react-native';
import * as Device from 'expo-device';
import { API_URL } from '../config';
import { getCachedToken, saveToken } from '../lib/secureToken';

// Device identity headers (Signal-parity F2/F3): label this device's session
// row so the Devices list is readable and new-device alerts say WHICH device.
// Cosmetic only — never an auth factor.
const DEVICE_NAME = Device.deviceName || Device.modelName || 'Unknown device';
const DEVICE_PLATFORM = Platform.OS;

// Mirrors client/src/services/api.js, adapted for React Native:
//   - baseURL is the absolute API URL (no dev proxy on device)
//   - the bearer token comes from the in-memory cache backed by SecureStore
//   - a 401 handler notifies listeners so the auth store can sign the user out
//     (RN has no window.location to redirect)
const api = axios.create({ baseURL: API_URL });

api.interceptors.request.use((config) => {
  const token = getCachedToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  config.headers['X-Device-Name'] = DEVICE_NAME;
  config.headers['X-Device-Platform'] = DEVICE_PLATFORM;
  return config;
});

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

// The auth store registers a callback here so a 401 anywhere triggers logout.
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null) {
  onUnauthorized = fn;
}

api.interceptors.response.use(
  (res) => {
    // Sliding session: past the token's half-life the server hands back a fresh
    // one in this header; storing it keeps an active user signed in forever.
    const refreshed = res.headers['x-refreshed-token'];
    if (refreshed) void saveToken(refreshed);
    return res;
  },
  (err) => {
    if (err.response?.status === 401) onUnauthorized?.();
    return Promise.reject(err);
  }
);

export default api;
