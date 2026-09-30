// =============================================================================
// Panel de alta de caso. Solo UI: la creación real vive en el backend.
// =============================================================================

import type { FormEvent, ReactNode } from 'react';
import { useId, useState } from 'react';
import { createCase, toErrorState } from '../lib/api';
import { goToCase } from '../lib/useHashRoute';
import { Button, ErrorCard, Panel } from './ui';

/** Mensaje amigable cuando el servidor devuelve 401 (sesión requerida). */
const AUTH_ERROR_MESSAGE = 'El servidor requiere autenticación. La interfaz está en modo demo: los datos no se cargarán hasta que configure una sesión válida.';

export function NewCasePanel(): ReactNode {
  const formId = useId();
  const identifierId = `${formId}-identifier`;

  const [studentIdentifier, setStudentIdentifier] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  async function handleCreate(event: FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    setCreating(true);
    setCreateError(null);
    try {
      const created = await createCase(studentIdentifier.trim() === '' ? undefined : studentIdentifier.trim());
      goToCase(created.id);
    } catch (err) {
      const state = toErrorState(err);
      const message = state.category === 'AUTH_ERROR' ? AUTH_ERROR_MESSAGE : state.message;
      setCreateError(message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <Panel
      title="Nuevo caso"
      description="Agrupa las evidencias de una sola cancelación, baja o deserción para poder auditarlas."
    >
      <form onSubmit={(event) => void handleCreate(event)} className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex-1">
          <label htmlFor={identifierId} className="mb-1 block text-sm font-medium text-ink">
            Matrícula / identificador del estudiante (opcional)
          </label>
          <input
            id={identifierId}
            name="studentIdentifier"
            type="text"
            value={studentIdentifier}
            onChange={(event) => setStudentIdentifier(event.target.value)}
            placeholder="Ej. 202312345"
            aria-describedby={`${formId}-hint`}
            className="w-full rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm text-ink placeholder:text-muted"
          />
          <p id={`${formId}-hint`} className="mt-1 text-xs text-muted">
            También puedes identificar al estudiante más adelante con la evidencia.
          </p>
        </div>
        <Button type="submit" variant="primary" loading={creating} loadingLabel="Creando caso">
          Nuevo caso
        </Button>
      </form>
      {createError !== null && <ErrorCard className="mt-3" message={createError} />}
    </Panel>
  );
}
