import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { authApi, User } from '../api';
import { setUnauthorizedHandler } from '../api/client';
import { loadToken, saveToken, clearToken } from '../lib/secureToken';

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
  }, []);

  const register = useCallback(
    async (payload: { email: string; password: string; firstName: string; lastName?: string }) => {
      const { data } = await authApi.register(payload);
      await saveToken(data.token);
      setUser(data.user);
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
