// =============================================================================
// Estado de sesión de la SPA. No lee cookies directamente: usa los endpoints
// de auth expuestos por el backend.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { refreshSession, signIn as apiSignIn, signOut as apiSignOut, type SessionUser } from './api';
import { isSessionExpiredError } from './api';

export type SessionStatus = 'loading' | 'anon' | 'authed';

export interface UseSessionResult {
  user: SessionUser | null;
  status: SessionStatus;
  /** Indica si la transición a 'anon' fue por sesión expirada (vs. carga inicial). */
  sessionExpired: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
}

export function useSession(): UseSessionResult {
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [user, setUser] = useState<SessionUser | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const checking = useRef(false);

  const check = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      const ok = await refreshSession();
      setStatus(ok ? 'authed' : 'anon');
      if (!ok) {
        setUser(null);
        setSessionExpired(false);
      }
    } catch (error) {
      setStatus('anon');
      setUser(null);
      setSessionExpired(isSessionExpiredError(error));
    } finally {
      checking.current = false;
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const handleSignIn = useCallback(async (email: string, password: string) => {
    const sessionUser = await apiSignIn(email, password);
    setUser(sessionUser);
    setStatus('authed');
    setSessionExpired(false);
  }, []);

  const handleSignOut = useCallback(async () => {
    try {
      await apiSignOut();
    } finally {
      setUser(null);
      setStatus('anon');
      setSessionExpired(false);
    }
  }, []);

  return {
    user,
    status,
    sessionExpired,
    signIn: handleSignIn,
    signOut: handleSignOut,
  };
}
