// =============================================================================
// Login / Registro. Tarjeta centrada con pestañas accesibles.
// Si el servidor exige verificación por correo, se avisa y no se inicia sesión.
// =============================================================================

import type { FormEvent, ReactNode } from 'react';
import { useId, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { toErrorState } from '../lib/api';
import { Button, ErrorCard, Spinner } from './ui';

type Mode = 'sign-in' | 'sign-up';

export function LoginPage(): ReactNode {
  const { signIn, signUp, loading } = useAuth();
  const [mode, setMode] = useState<Mode>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const formId = useId();
  const emailId = `${formId}-email`;
  const passwordId = `${formId}-password`;
  const nameId = `${formId}-name`;
  const errorId = `${formId}-error`;

  const isSignUp = mode === 'sign-up';

  function switchMode(next: Mode): void {
    setMode(next);
    setError(null);
    setNotice(null);
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setError(null);
    setNotice(null);
    setSubmitting(true);
    try {
      if (isSignUp) {
        const result = await signUp({
          email: email.trim(),
          password,
          ...(name.trim() !== '' ? { name: name.trim() } : {}),
        });
        if (result.requireEmailVerification || result.user === null) {
          setNotice('Revisa tu correo para verificar la cuenta. Inicia sesión cuando la confirmes.');
        }
      } else {
        await signIn(email.trim(), password);
      }
    } catch (err) {
      setError(toErrorState(err).message);
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background">
        <Spinner label="Cargando sesión" className="h-6 w-6" />
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <h1 className="text-xl font-semibold text-ink">Auditoría de Cancelaciones</h1>
          <p className="mt-1 text-sm text-muted">Cancelaciones, bajas y deserción · UTEL</p>
        </div>

        <div className="rounded-2xl border border-line bg-surface-1 p-5">
          <div role="tablist" aria-label="Acceso a la cuenta" className="mb-5 grid grid-cols-2 gap-1 rounded-xl bg-surface-2 p-1">
            <button
              type="button"
              role="tab"
              id={`${formId}-tab-sign-in`}
              aria-selected={!isSignUp}
              aria-controls={`${formId}-panel`}
              onClick={() => switchMode('sign-in')}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                isSignUp ? 'text-muted hover:text-ink' : 'bg-surface-3 text-ink'
              }`}
            >
              Entrar
            </button>
            <button
              type="button"
              role="tab"
              id={`${formId}-tab-sign-up`}
              aria-selected={isSignUp}
              aria-controls={`${formId}-panel`}
              onClick={() => switchMode('sign-up')}
              className={`rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
                isSignUp ? 'bg-surface-3 text-ink' : 'text-muted hover:text-ink'
              }`}
            >
              Registrarse
            </button>
          </div>

          <div
            role="tabpanel"
            id={`${formId}-panel`}
            aria-labelledby={isSignUp ? `${formId}-tab-sign-up` : `${formId}-tab-sign-in`}
            tabIndex={0}
          >
            <form onSubmit={(event) => void handleSubmit(event)} noValidate className="flex flex-col gap-4">
              {isSignUp && (
                <div>
                  <label htmlFor={nameId} className="mb-1 block text-sm font-medium text-ink">
                    Nombre (opcional)
                  </label>
                  <input
                    id={nameId}
                    name="name"
                    type="text"
                    autoComplete="name"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-muted"
                  />
                </div>
              )}

              <div>
                <label htmlFor={emailId} className="mb-1 block text-sm font-medium text-ink">
                  Correo electrónico
                </label>
                <input
                  id={emailId}
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  aria-describedby={error !== null ? errorId : undefined}
                  className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-muted"
                />
              </div>

              <div>
                <label htmlFor={passwordId} className="mb-1 block text-sm font-medium text-ink">
                  Contraseña
                </label>
                <input
                  id={passwordId}
                  name="password"
                  type="password"
                  required
                  minLength={isSignUp ? 8 : undefined}
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                  aria-describedby={
                    error !== null ? errorId : isSignUp ? `${formId}-hint` : undefined
                  }
                  className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-muted"
                />
                {isSignUp && (
                  <p id={`${formId}-hint`} className="mt-1 text-xs text-muted">
                    Mínimo 8 caracteres.
                  </p>
                )}
              </div>

              {error !== null && (
                <div id={errorId} role="alert">
                  <ErrorCard title="No se pudo completar la operación" message={error} />
                </div>
              )}

              {notice !== null && (
                <p
                  role="status"
                  className="rounded-xl border border-success/40 bg-success/10 px-3 py-2 text-sm text-success"
                >
                  {notice}
                </p>
              )}

              <Button type="submit" variant="primary" fullWidth loading={submitting} loadingLabel="Enviando">
                {isSignUp ? 'Crear cuenta' : 'Entrar'}
              </Button>
            </form>
          </div>
        </div>

        <p className="mt-4 text-center text-xs text-muted">
          El acceso usa la sesión del servidor. La aplicación nunca almacena tu contraseña.
        </p>
      </div>
    </main>
  );
}
