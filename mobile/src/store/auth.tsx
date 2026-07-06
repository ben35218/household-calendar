import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authApi, User } from '../api';
import { setUnauthorizedHandler } from '../api/client';
import { loadToken, saveToken, clearToken } from '../lib/secureToken';
import { ensureEnrolledOnLogin, ensureHouseholdKey, lock as lockE2EE } from '../lib/e2ee';

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
  }, []);

  // Restore a stored token on launch and verify it against /auth/me.
  useEffect(() => {
    (async () => {
      try {
        const token = await loadToken();
        if (token) {
          const { data } = await authApi.me();
          setUser(data);
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

  const login = useCallback(async (creds: { email: string; password: string }) => {
    const { data } = await authApi.login(creds);
    await saveToken(data.token);
    setUser(data.user);
    await initE2EE(creds.password); // token stored → keysApi is authed
  }, []);

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
      value={{ user, bootstrapping, isLoggedIn: !!user, login, register, logout, setUser }}
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
