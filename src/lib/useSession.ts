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
import { refreshSession, signOut as apiSignOut, type AppRole } from './api';
import { isSessionExpiredError } from './api';

export type SessionStatus = 'loading' | 'anon' | 'authed';

/**
 * Rótulos de presentación de cada rol. `user` se muestra como "Asesor"; el
 * identificador persistido no cambia. Solo afecta lo que la UI pinta: ningún
 * rótulo habilita una capacidad.
 */
export const ROLE_LABELS: Record<AppRole, string> = {
  user: 'Asesor',
  coordinator: 'Coordinador',
  manager: 'Gerente',
};

/** Traduce un rol a su rótulo; `null` (o rol desconocido) no tiene rótulo. */
export function roleLabel(role: AppRole | null): string | null {
  return role === null ? null : (ROLE_LABELS[role] ?? null);
}

/** Motivos que el callback de Google puede devolver en `?authError=`. */
export type AuthErrorReason =
  | 'dominio'
  | 'no_verificado'
  | 'sin_acceso'
  | 'expirado'
  | 'fallo';

const AUTH_ERROR_MESSAGES: Record<AuthErrorReason, string> = {
  dominio: 'Solo se admiten correos de la UTEL (@utel.edu.mx).',
  no_verificado: 'Google no confirmó que tu correo esté verificado.',
  sin_acceso: 'Tu correo es válido pero no tienes acceso a esta aplicación. Solicítalo al responsable.',
  expirado: 'El inicio de sesión tardó demasiado o el navegador descartó la cookie del proceso. Vuelve a intentarlo.',
  fallo: 'No se pudo completar el inicio de sesión con Google. Intenta de nuevo.',
};

/**
 * Lista de motivos aceptados, DERIVADA del mapa de mensajes.
 *
 * Antes era una lista escrita a mano: al añadir un motivo al union había que
 * recordar tocar los dos sitios, y TypeScript no lo garantizaba (el array es
 * `AuthErrorReason[]`, no un `Record` exhaustivo). Un motivo olvidado se
 * descartaba en silencio y el usuario volvía al login sin ningún aviso.
 */
const AUTH_ERROR_REASONS: readonly AuthErrorReason[] = Object.keys(
  AUTH_ERROR_MESSAGES,
) as AuthErrorReason[];

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
  /**
   * Rol resuelto por el servidor, SOLO para presentación. `null` cuando no hay
   * sesión o el rol no se reconoce; la autorización sigue en el servidor.
   */
  role: AppRole | null;
  signOut: () => Promise<void>;
}

export function useSession(): UseSessionResult {
  // El callback devuelve con la página completa, así que el motivo se lee en el
  // PRIMER render y no en un efecto posterior: un efecto dejaría un render con
  // el mensaje vacío. El inicializador es perezoso y corre una sola vez.
  const [status, setStatus] = useState<SessionStatus>('loading');
  const [sessionExpired, setSessionExpired] = useState(false);
  const [role, setRole] = useState<AppRole | null>(null);
  const [authError] = useState<string | null>(() => {
    const reason = takeAuthErrorFromUrl();
    return reason === null ? null : AUTH_ERROR_MESSAGES[reason];
  });
  const checking = useRef(false);

  const check = useCallback(async () => {
    if (checking.current) return;
    checking.current = true;
    try {
      const snapshot = await refreshSession();
      setRole(snapshot?.role ?? null);
      setStatus(snapshot ? 'authed' : 'anon');
      if (!snapshot) {
        setSessionExpired(false);
      }
    } catch (error) {
      setRole(null);
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
      setRole(null);
    }
  }, []);

  return {
    status,
    sessionExpired,
    authError,
    role,
    signOut: handleSignOut,
  };
}
