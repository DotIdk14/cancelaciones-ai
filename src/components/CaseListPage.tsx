// =============================================================================
// Lista de casos: alta de caso (POST) y navegación al detalle.
// =============================================================================

import type { FormEvent, ReactNode } from 'react';
import { useCallback, useEffect, useId, useState } from 'react';
import type { CaseStatus } from '../skills/audit/types';
import { createCase, listCases, toErrorState } from '../lib/api';
import type { CaseSummary } from '../lib/api';
import { formatDateTime, shortId } from '../lib/format';
import { CASE_STATUS_LABELS } from '../lib/labels';
import { goToCase } from '../lib/useHashRoute';
import { Badge, Button, EmptyState, ErrorCard, Panel, Spinner } from './ui';
import type { Tone } from './ui';

/** Mensaje amigable cuando el servidor devuelve 401 (sesión requerida). */
const AUTH_ERROR_MESSAGE = 'El servidor requiere autenticación. La interfaz está en modo demo: los datos no se cargarán hasta que configure una sesión válida.';

const CASE_STATUS_TONE: Record<CaseStatus, Tone> = {
  DRAFT: 'neutral',
  READY: 'brand',
  AUDITING: 'warning',
  COMPLETED: 'success',
  ERROR: 'danger',
};

export function CaseListPage(): ReactNode {
  const formId = useId();
  const identifierId = `${formId}-identifier`;

  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

  const [studentIdentifier, setStudentIdentifier] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      setCases(await listCases());
      setListError(null);
    } catch (err) {
      const state = toErrorState(err);
      // Si el servidor devuelve 401, mostrar mensaje amigable en modo demo.
      const message = state.category === 'AUTH_ERROR' ? AUTH_ERROR_MESSAGE : state.message;
      setListError(message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

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
    <div className="flex flex-col gap-5">
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

      <Panel
        title="Casos"
        description="Selecciona un caso para gestionar sus evidencias y auditarlo."
        actions={
          <Button onClick={() => void load()} loading={loading} loadingLabel="Actualizando">
            Actualizar
          </Button>
        }
      >
        {listError !== null && <ErrorCard message={listError} onRetry={() => void load()} className="mb-4" />}

        {loading && cases === null ? (
          <div className="flex justify-center py-8">
            <Spinner label="Cargando casos" className="h-5 w-5" />
          </div>
        ) : cases !== null && cases.length === 0 ? (
          <EmptyState
            icon="📂"
            title="Todavía no hay casos"
            description="Crea el primer caso para empezar a cargar evidencias y auditar con IA."
          />
        ) : (
          <ul className="flex flex-col gap-2">
            {(cases ?? []).map((item) => (
              <li key={item.id}>
                <a
                  href={`#/casos/${encodeURIComponent(item.id)}`}
                  className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3 transition-colors hover:border-brand/50 hover:bg-surface-3"
                >
                  <div className="min-w-0">
                    <p className="font-mono text-sm text-ink">
                      Caso {shortId(item.id)}
                      {item.studentIdentifier !== null && item.studentIdentifier !== '' && (
                        <span className="ml-2 font-sans text-muted">· {item.studentIdentifier}</span>
                      )}
                    </p>
                    <p className="mt-0.5 text-xs text-muted">
                      {item.evidenceCount === 1 ? '1 evidencia' : `${item.evidenceCount} evidencias`} ·
                      Creado {formatDateTime(item.createdAt)} · Actualizado {formatDateTime(item.updatedAt)}
                    </p>
                  </div>
                  <Badge tone={CASE_STATUS_TONE[item.status]}>{CASE_STATUS_LABELS[item.status]}</Badge>
                </a>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
