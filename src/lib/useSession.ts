// =============================================================================
// Estado de sesión de la SPA. No lee cookies ni habla con InsForge: usa el
// endpoint de refresh del backend para saber si hay sesión.
//
// El login es un redirect del navegador a `/api/auth/google`. Cuando el callback
// rechaza el acceso vuelve con `?authError=<motivo>` y este hook lo traduce a un
// mensaje. Los motivos viven en el cliente a propósito: el backend solo pone una
// clave opaca en la URL.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from 'react';
import { refreshSession, signOut as apiSignOut } from './api';
import { isSessionExpiredError } from './api';

export type SessionStatus = 'loading' | 'anon' | 'authed';

/** Motivos que el callback de Google puede devolver en `?authError=`. */
export type AuthErrorReason =
  | 'dominio'
  | 'no_verificado'
  | 'sin_acceso'
  | 'fallo';

const AUTH_ERROR_MESSAGES: Record<AuthErrorReason, string> = {
  dominio: 'Solo se admiten correos de la UTEL (@utel.edu.mx).',
  no_verificado: 'Google no confirmó que tu correo esté verificado.',
  sin_acceso: 'Tu correo es válido pero no tienes acceso a esta aplicación. Solicítalo al responsable.',
  fallo: 'No se pudo completar el inicio de sesión con Google. Intenta de nuevo.',
};

const AUTH_ERROR_REASONS: readonly AuthErrorReason[] = ['dominio', 'no_verificado', 'sin_acceso', 'fallo'];

export function isAuthErrorReason(value: string): value is AuthErrorReason {
  return AUTH_ERROR_REASONS.includes(value as AuthErrorReason);
}

/**
 * Lee `?authError=` de la URL y la borra.
 *
 * Se borra porque el mensaje va en el estado de React, no en la barra de
 * direcciones: si el usuario recarga, el aviso no vuelve a salir. El replace
 * conserva el path y el hash (esta SPA enruta por hash) y solo cae el query.
 */
function takeAuthErrorFromUrl(): AuthErrorReason | null {
  if (typeof window === 'undefined') return null;
  const url = new URL(window.location.href);
  const raw = url.searchParams.get('authError');
  if (!raw || !isAuthErrorReason(raw)) return null;
  url.searchParams.delete('authError');
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`);
  return raw;
}

export interface UseSessionResult {
  status: SessionStatus;
  /** Indica si la transición a 'anon' fue por sesión expirada (vs. carga inicial). */
  sessionExpired: boolean;
  /** Motivo del último rechazo del login por Google, si lo hubo. */
  authError: string | null;
  signOut: () => Promise<void>;
}

export function useSession(): UseSessionResult {
  // El callback devuelve con la página completa, así que el motivo se lee en el
  // PRIMER render y no en un efecto posterior: un efecto dejaría un render con
  // el mensaje vacío. El inicializador es perezoso y corre una sola vez.
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [authError] = useState<string | null>(() => {
    const reason = takeAuthErrorFromUrl();
    return reason === null ? null : AUTH_ERROR_MESSAGES[reason];
  });
  const checking = useRef(false);

  const check = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      const ok = await refreshSession();
      setStatus(ok ? 'authed' : 'anon');
      if (!ok) {
        setSessionExpired(false);
      }
    } catch (error) {
      setStatus('anon');
      setSessionExpired(isSessionExpiredError(error));
    } finally {
      checking.current = false;
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  const handleSignOut = useCallback(async () => {
    try {
      await apiSignOut();
    } finally {
      setStatus('anon');
      setSessionExpired(false);
    }
  }, []);

  return {
    status,
    sessionExpired,
    authError,
    signOut: handleSignOut,
  };
}
