import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import { authApi, householdApi, User } from '../api';
import { setUnauthorizedHandler } from '../api/client';
import { loadToken, saveToken, clearToken } from '../lib/secureToken';
import {
  ensureEnrolledOnLogin, ensureHouseholdKey, unlockWithPasskey,
  unlockWithPasskeyPrfOutput, rewrapForNewPassword, lock as lockE2EE,
} from '../lib/e2ee';
import { passkeysSupported, assertPasskeyForLogin } from '../lib/passkeys';
import { queryClient } from '../lib/queryClient';
import { clearAll as clearReplica } from '../lib/replica';

// Enroll (or unlock) the E2EE keypair after auth, then make sure this session
// holds the household key (owner mints it lazily on first unlock). Additive and
// best-effort: a crypto/enrollment failure must not block sign-in.
async function initE2EE(password: string) {
  try {
    const status = await ensureEnrolledOnLogin(password);
    if (status !== 'locked') await ensureHouseholdKey();
  } catch (err) {
    console.warn('[e2ee] enrollment/unlock skipped:', (err as Error)?.message ?? err);
  }
}

// Session store (React context). Equivalent to client/src/stores/auth.js, but
// token persistence is async (SecureStore) so we expose a `bootstrapping` flag
// for the splash gate while we restore + verify a stored token.
type AuthState = {
  user: User | null;
  bootstrapping: boolean;
  isLoggedIn: boolean;
  login: (creds: { email: string; password: string }) => Promise<void>;
  // One-tap sign-in with a registered passkey; false = user canceled the sheet.
  loginWithPasskey: (email: string) => Promise<boolean>;
  // Emailed-code reset; signs the user in and reports the E2EE outcome so the
  // screen can explain a still-locked state ('none' = account not enrolled).
  resetPassword: (data: { email: string; code: string; newPassword: string }) => Promise<'unlocked' | 'locked' | 'none'>;
  register: (data: { email: string; password: string; firstName: string; lastName?: string }) => Promise<void>;
  logout: () => Promise<void>;
  setUser: (user: User | null) => void;
};

const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [bootstrapping, setBootstrapping] = useState(true);

  const logout = useCallback(async () => {
    lockE2EE(); // drop the in-memory private key
    await clearToken();
    setUser(null);
    // The next sign-in may be a different account: query keys aren't scoped by
    // user, so cached server state and the on-device replica would paint the
    // previous household's records. Wipe both.
    queryClient.clear();
    await clearReplica().catch(() => {});
  }, []);

  // Restore a stored token on launch and verify it against /auth/me.
  useEffect(() => {
    (async () => {
      try {
        const token = await loadToken();
        if (token) {
          const { data } = await authApi.me();
          setUser(data);
          // A restored session has no password, so E2EE is locked. If the
          // account has a passkey factor, offer the Face ID / Touch ID sheet
          // now (cancel just leaves it locked — password unlock still works).
          if (passkeysSupported()) {
            try {
              if (await unlockWithPasskey()) await ensureHouseholdKey();
            } catch {
              // canceled / PRF unavailable — stay locked
            }
          }
        }
      } catch {
        await clearToken();
      } finally {
        setBootstrapping(false);
      }
    })();
  }, []);

  // Any 401 from the API signs the user out.
  useEffect(() => {
    setUnauthorizedHandler(() => { void logout(); });
    return () => setUnauthorizedHandler(null);
  }, [logout]);

  // Report this app version for the §9 readiness gate (every member must be on a
  // compatible build before the whole-household drop). Best-effort.
  useEffect(() => {
    if (!user) return;
    householdApi
      .reportClientVersion(Constants.expoConfig?.version ?? '0.0.0', Platform.OS)
      .catch(() => {});
  }, [user?._id]);

  const login = useCallback(async (creds: { email: string; password: string }) => {
    const { data } = await authApi.login(creds);
    await saveToken(data.token);
    setUser(data.user);
    await initE2EE(creds.password); // token stored → keysApi is authed
  }, []);

  const loginWithPasskey = useCallback(async (email: string) => {
    const { data: ch } = await authApi.passkeyChallenge({ email });
    const assertion = await assertPasskeyForLogin(ch);
    if (!assertion) return false; // user canceled the Face ID sheet
    const { data } = await authApi.passkeyLogin({ challengeId: ch.challengeId, response: assertion.response });
    await saveToken(data.token);
    setUser(data.user);
    // Same-gesture E2EE unlock: the assertion already evaluated the PRF.
    // Best-effort like initE2EE — a crypto failure must not block sign-in.
    try {
      if (assertion.prfOutput && (await unlockWithPasskeyPrfOutput(assertion.credentialId, assertion.prfOutput))) {
        await ensureHouseholdKey();
      }
    } catch (err) {
      console.warn('[e2ee] passkey unlock skipped:', (err as Error)?.message ?? err);
    }
    return true;
  }, []);

  const resetPassword = useCallback(
    async (payload: { email: string; code: string; newPassword: string }) => {
      const { data } = await authApi.resetPassword(payload);
      await saveToken(data.token);
      setUser(data.user);
      if (!data.e2eeEnrolled) return 'none' as const;
      // The password envelope is wrapped under the OLD password. Try a silent
      // passkey unlock; if it works, re-wrap under the new password right away.
      // Otherwise the account stays locked until Face ID / recovery code in
      // Profile → Security.
      try {
        if (passkeysSupported() && (await unlockWithPasskey())) {
          await ensureHouseholdKey();
          await rewrapForNewPassword(payload.newPassword);
          return 'unlocked' as const;
        }
      } catch {
        // canceled / PRF unavailable — stay locked
      }
      return 'locked' as const;
    },
    []
  );

  const register = useCallback(
    async (payload: { email: string; password: string; firstName: string; lastName?: string }) => {
      const { data } = await authApi.register(payload);
      await saveToken(data.token);
      setUser(data.user);
      await initE2EE(payload.password);
    },
    []
  );

  return (
    <AuthContext.Provider
      value={{ user, bootstrapping, isLoggedIn: !!user, login, loginWithPasskey, resetPassword, register, logout, setUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
