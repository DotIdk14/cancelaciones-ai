// =============================================================================
// Sesión del usuario. El cliente nunca guarda tokens: solo conserva el perfil
// devuelto por `GET /api/auth/me` en memoria.
// =============================================================================

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { getMe, signInRequest, signOutRequest, signUpRequest } from '../lib/api';
import type { ApiUser, SignUpResult } from '../lib/api';

export interface AuthContextValue {
  user: ApiUser | null;
  loading: boolean;
  signIn: (email: string, password: string) => Promise<ApiUser>;
  signUp: (input: { email: string; password: string; name?: string }) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [user, setUser] = useState<ApiUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (): Promise<void> => {
    try {
      setUser(await getMe());
    } catch {
      // Sesión ausente o caída de red: se trata como usuario anónimo.
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string): Promise<ApiUser> => {
    const next = await signInRequest(email, password);
    setUser(next);
    return next;
  }, []);

  const signUp = useCallback(
    async (input: { email: string; password: string; name?: string }): Promise<SignUpResult> => {
      const result = await signUpRequest(input);
      // Con verificación por correo el servidor puede devolver `user: null`.
      if (result.user) setUser(result.user);
      return result;
    },
    [],
  );

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await signOutRequest();
    } finally {
      setUser(null);
    }
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, loading, signIn, signUp, signOut, refresh }),
    [user, loading, signIn, signUp, signOut, refresh],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth debe usarse dentro de <AuthProvider>.');
  return ctx;
}
