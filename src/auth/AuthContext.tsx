// =============================================================================
// Sesión del usuario. El cliente nunca guarda tokens: solo conserva el perfil
// devuelto por `GET /api/auth/me` en memoria.
//
// MODO DEMO: la UI no depende de `user` para mostrarse. El contexto siempre
// reporta "autenticado" con un usuario mock para que la interfaz principal
// sea visible sin pantalla de login.
// =============================================================================

import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { signInRequest, signOutRequest, signUpRequest } from '../lib/api';
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

/** Usuario mock para modo demo: la UI siempre está visible. */
const DEMO_USER: ApiUser = {
  id: 'demo-user',
  email: 'demo@localhost',
  name: 'Usuario Demo',
};

export function AuthProvider({ children }: { children: ReactNode }): ReactNode {
  const [user] = useState<ApiUser | null>(DEMO_USER);
  const [loading] = useState(false);

  const refresh = useCallback(async (): Promise<void> => {
    // No-op en modo demo: el usuario mock ya está disponible.
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<ApiUser> => {
    const next = await signInRequest(email, password);
    return next;
  }, []);

  const signUp = useCallback(
    async (input: { email: string; password: string; name?: string }): Promise<SignUpResult> => {
      const result = await signUpRequest(input);
      return result;
    },
    [],
  );

  const signOut = useCallback(async (): Promise<void> => {
    try {
      await signOutRequest();
    } catch {
      // En modo demo no hay sesión real que cerrar.
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
