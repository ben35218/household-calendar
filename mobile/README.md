# Calen — Mobile (iOS + Android)

Native app built with **React Native + Expo (SDK 56) + TypeScript**. It talks to
the same Express/Mongoose API as the web app and admin console.

## Stack
- **Expo** managed workflow, **TypeScript**
- **React Navigation** (bottom tabs + native stacks)
- **TanStack Query** for server state; **axios** API client
- **expo-secure-store** for the JWT (encrypted at rest)
- **expo-image-picker / expo-document-picker** for the photo/scan + upload flows
- **expo-notifications** for native push (registered to the server's Expo push channel)
- **react-native-purchases** (RevenueCat) for in-app subscriptions

## Project layout
```
src/
  api/            axios client + typed endpoint groups (ports services/api.js)
  components/     shared UI kit (Button, Input, Card)
  lib/            secureToken, push, media, upload, purchases, queryClient
  navigation/     Root / Auth / Tab / Profile navigators
  screens/        Login, Register, Dashboard, Calendar, Tasks, Profile, Paywall
  store/          auth context (session + bootstrap)
  config.ts       API base URL + RevenueCat key resolution
  theme.ts        design tokens mirroring the web Vuetify palette
```

## Running locally
1. Start the API server (`npm --prefix ../server run dev`, port 3001).
2. Point the app at the API:
   - **Simulator:** the default `http://localhost:3001` works.
   - **Physical device:** copy `.env.example` → `.env` and set
     `EXPO_PUBLIC_API_URL=http://<your-LAN-IP>:3001`.
3. `npm install` then `npx expo start`. Press `i` (iOS) or `a` (Android).

> Native modules (push, in-app purchases) require a **dev build** or store build —
> they don't work in Expo Go. Use `npx expo run:ios` / `run:android` or EAS.

## Configuration needed before release
- **EAS project id** — for push tokens (`app.json` → expo.extra.eas.projectId, or `eas init`).
- **RevenueCat keys** — `app.json` → expo.extra.revenueCatIosKey / revenueCatAndroidKey
  (or `EXPO_PUBLIC_RC_IOS_KEY` / `EXPO_PUBLIC_RC_ANDROID_KEY`). Set up products +
  entitlements (`premium`, `unlimited`) in the RevenueCat dashboard and configure the
  webhook to `POST {API}/api/billing/webhook` with the shared secret
  (`REVENUECAT_WEBHOOK_SECRET` on the server).

## Status
- ✅ Foundation: auth (login/register/secure token), navigation, API layer, server state.
- ✅ Native capability scaffolds: camera/library/document pickers + upload helper, push
  registration, RevenueCat paywall.
- 🚧 Feature screens are being ported wave by wave (see the plan). Calendar and the
  trip timeline are the most involved.
