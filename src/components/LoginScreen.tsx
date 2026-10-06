// =============================================================================
// Pantalla de inicio de sesión. Primer punto de contacto cuando no hay sesión.
//
// El login es un redirect a Google: el botón no hace fetch, navega. Toda la
// decisión (dominio, verificación, autorización) ocurre en el backend y vuelve
// como un 303 a la app con `?authError=<motivo>`; aquí solo se pinta ese motivo.
// No hay formulario ni campo de contraseña: ninguna credencial pasa por el DOM.
// =============================================================================

import type { ReactNode } from 'react';
import { Button, Panel } from './ui';

/** Origen del login con Google. Relativo a propósito: mismo origen, sin URL absoluta. */
const GOOGLE_LOGIN_PATH = '/api/auth/google';

interface LoginScreenProps {
  /** Mensaje del último rechazo del login, si el callback volvió con uno. */
  authError?: string | null;
  sessionExpired?: boolean;
}

export function LoginScreen({ authError = null, sessionExpired = false }: LoginScreenProps): ReactNode {
  const error = authError ?? (sessionExpired ? 'Tu sesión expiró. Vuelve a iniciar sesión.' : null);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold text-ink">Auditoría de Cancelaciones</h1>
          <p className="text-sm text-muted">Cancelaciones, bajas y deserción · UTEL</p>
        </div>

        <Panel title="Iniciar sesión">
          <div className="flex flex-col gap-4">
            {error !== null && (
              <div
                role="alert"
                aria-live="polite"
                className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger"
              >
                {error}
              </div>
            )}

            <Button
              variant="primary"
              fullWidth
              onClick={() => {
                // Navegación de nivel superior: el callback de Google responde
                // con un 302/303 que un fetch no seguiría.
                window.location.assign(GOOGLE_LOGIN_PATH);
              }}
            >
              <GoogleMark />
              Continuar con Google
            </Button>

            <p className="text-center text-xs text-subtle">
              Solo se admiten correos de la UTEL (<span className="font-medium">@utel.edu.mx</span>) con
              autorización activa.
            </p>
          </div>
        </Panel>
      </div>
    </div>
  );
}

/**
 * Glifo de Google dibujado a mano en vez de una imagen externa.
 *
 * La CSP del proyecto es `default-src 'self'` con `img-src 'self' data: blob:`,
 * así que un logo servido desde `https://...googleusercontent.com` quedaría
 * bloqueado. Un SVG en línea tampoco suma datos al cable ni depende de la red.
 * Los cuatro colores son los oficiales de Google y son decorativos: el botón
 * ya se identifica por su texto, que es lo que lee el lector de pantalla.
 */
function GoogleMark(): ReactNode {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 shrink-0" focusable="false">
      <path
        fill="#4285F4"
        d="M23.52 12.27c0-.85-.08-1.67-.22-2.45H12v4.63h6.46a5.52 5.52 0 0 1-2.4 3.62v3h3.87c2.27-2.09 3.59-5.17 3.59-8.8Z"
      />
      <path
        fill="#34A853"
        d="M12 24c3.24 0 5.96-1.07 7.94-2.91l-3.87-3c-1.07.72-2.45 1.15-4.07 1.15-3.13 0-5.78-2.11-6.73-4.96H1.28v3.09A12 12 0 0 0 12 24Z"
      />
      <path
        fill="#FBBC05"
        d="M5.27 14.28a7.2 7.2 0 0 1 0-4.56V6.63H1.28a12 12 0 0 0 0 10.74l3.99-3.09Z"
      />
      <path
        fill="#EA4335"
        d="M12 4.75c1.77 0 3.35.61 4.6 1.8l3.42-3.42C17.95 1.19 15.24 0 12 0A12 12 0 0 0 1.28 6.63l3.99 3.09C6.22 6.86 8.87 4.75 12 4.75Z"
      />
    </svg>
  );
}
