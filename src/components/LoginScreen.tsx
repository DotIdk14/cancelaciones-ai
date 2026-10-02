// =============================================================================
// Pantalla de inicio de sesión. Primer punto de contacto cuando no hay sesión.
// =============================================================================

import type { FormEvent, ReactNode } from 'react';
import { useEffect, useId, useRef, useState } from 'react';
import { Button, Panel } from './ui';
import { ApiError, isSessionExpiredError, toErrorState } from '../lib/api';

interface LoginScreenProps {
  signIn: (email: string, password: string) => Promise<void>;
  sessionExpired?: boolean;
}

function translateError(error: unknown): string {
  if (isSessionExpiredError(error)) {
    return 'Tu sesión expiró. Vuelve a iniciar sesión.';
  }
  if (error instanceof ApiError) {
    if (error.status === 401 && error.category === 'UNAUTHENTICATED') {
      return 'Correo o contraseña incorrectos.';
    }
    return error.message;
  }
  if (error instanceof TypeError || (error instanceof Error && /fetch|network/i.test(error.message))) {
    return 'No se pudo conectar con el servidor. Verifica tu conexión e intenta de nuevo.';
  }
  const state = toErrorState(error);
  return state.message;
}

export function LoginScreen({ signIn, sessionExpired = false }: LoginScreenProps): ReactNode {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(sessionExpired ? 'Tu sesión expiró. Vuelve a iniciar sesión.' : null);

  const emailRef = useRef<HTMLInputElement>(null);
  const emailId = useId();
  const passwordId = useId();

  useEffect(() => {
    emailRef.current?.focus();
  }, []);

  useEffect(() => {
    if (sessionExpired) {
      setError('Tu sesión expiró. Vuelve a iniciar sesión.');
    }
  }, [sessionExpired]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await signIn(email, password);
    } catch (err) {
      setError(translateError(err));
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    'w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-subtle focus:border-brand focus:outline-none focus:ring-1 focus:ring-brand';

  return (
    <div className="flex min-h-screen flex-col items-center justify-center bg-background px-4 py-6">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold text-ink">Auditoría de Cancelaciones</h1>
          <p className="text-sm text-muted">Cancelaciones, bajas y deserción · UTEL</p>
        </div>

        <Panel title="Iniciar sesión">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <label htmlFor={emailId} className="text-sm font-medium text-ink">
                Correo electrónico
              </label>
              <input
                ref={emailRef}
                id={emailId}
                type="email"
                name="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className={inputClass}
                placeholder="tu.correo@utel.edu.mx"
              />
            </div>

            <div className="flex flex-col gap-1.5">
              <label htmlFor={passwordId} className="text-sm font-medium text-ink">
                Contraseña
              </label>
              <input
                id={passwordId}
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className={inputClass}
                placeholder="••••••••"
              />
            </div>

            {error !== null && (
              <div
                role="alert"
                aria-live="polite"
                className="rounded-xl border border-danger/40 bg-danger/10 p-3 text-sm text-danger"
              >
                {error}
              </div>
            )}

            <Button type="submit" variant="primary" loading={loading} fullWidth>
              Iniciar sesión
            </Button>
          </form>
        </Panel>
      </div>
    </div>
  );
}
