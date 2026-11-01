import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../api/client';
import type { Profile, RegisterInput } from '../api/types';

interface AuthState {
  authed: boolean;
  loading: boolean;
  profile: Profile | null;
  login: (email: string, password: string) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
  reload: () => Promise<void>;
}

const AuthCtx = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [authed, setAuthed] = useState(api.isAuthed);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(api.isAuthed);

  const reload = useCallback(async () => {
    if (!api.isAuthed) {
      setProfile(null);
      return;
    }
    try {
      setProfile(await api.me());
    } catch {
      setProfile(null);
    }
  }, []);

  // Réagit aux changements de jetons (connexion, déconnexion, expiration du refresh).
  useEffect(() => api.subscribe(() => setAuthed(api.isAuthed)), []);

  useEffect(() => {
    let active = true;
    (async () => {
      setLoading(true);
      await reload();
      if (active) setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [authed, reload]);

  const login = useCallback(
    async (email: string, password: string) => {
      await api.login(email, password);
      await reload();
    },
    [reload],
  );

  const register = useCallback(
    async (input: RegisterInput) => {
      await api.register(input);
      await reload();
    },
    [reload],
  );

  const logout = useCallback(async () => {
    await api.logout();
    setProfile(null);
  }, []);

  const value = useMemo<AuthState>(
    () => ({ authed, loading, profile, login, register, logout, reload }),
    [authed, loading, profile, login, register, logout, reload],
  );

  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthCtx);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
}
