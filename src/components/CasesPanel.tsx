// =============================================================================
// Listado de casos con acción de recarga. Solo lectura + navegación al detalle.
// =============================================================================

import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { listCases, toErrorState } from '../lib/api';
import type { CaseSummary } from '../lib/api';
import { formatDateTime, shortId } from '../lib/format';
import {
  CASE_STATUS_LABELS,
  CASE_STATUS_TONE,
  RESOLUTION_SOURCE_DESCRIPTIONS,
  RESOLUTION_SOURCE_LABELS,
  RESOLUTION_SOURCE_TONE,
  resolutionLabel,
  resolutionTone,
} from '../lib/labels';
import { Badge, Button, EmptyState, ErrorCard, Panel, Spinner } from './ui';

/** Mensaje amigable cuando el servidor devuelve 401 (sesión requerida). */
const AUTH_ERROR_MESSAGE = 'El servidor requiere autenticación. La interfaz está en modo demo: los datos no se cargarán hasta que configure una sesión válida.';

export function CasesPanel(): ReactNode {
  const [cases, setCases] = useState<CaseSummary[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState<string | null>(null);

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

  return (
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
          {(cases ?? []).map((item) => {
            // `undefined` y `null` significan lo mismo: no hay resolución que
            // mostrar, y entonces la fila se dibuja exactamente como antes.
            const resolution = item.effectiveResolution ?? null;
            return (
              <li key={item.id} className="flex flex-wrap items-center gap-2">
                <a
                  href={`#/casos/${encodeURIComponent(item.id)}`}
                  className="flex min-w-0 flex-1 flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-surface-2 px-4 py-3 transition-colors hover:border-brand/50 hover:bg-surface-3"
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
                  <div className="flex flex-wrap items-center gap-2">
                    {/*
                      La resolución viaja SIEMPRE con su origen: un resultado sin
                      decir si lo decidió una persona o el modelo no es auditable.
                      El distintivo no sustituye al badge de estado del caso, que
                      es un dato técnico distinto.
                    */}
                    {resolution !== null && (
                      <>
                        <Badge tone={resolutionTone(resolution.result)}>{resolutionLabel(resolution.result)}</Badge>
                        <Badge
                          tone={RESOLUTION_SOURCE_TONE[resolution.source]}
                          title={RESOLUTION_SOURCE_DESCRIPTIONS[resolution.source]}
                        >
                          {RESOLUTION_SOURCE_LABELS[resolution.source]}
                        </Badge>
                      </>
                    )}
                    <Badge tone={CASE_STATUS_TONE[item.status]}>{CASE_STATUS_LABELS[item.status]}</Badge>
                  </div>
                </a>
                {/* Enlace hermano, nunca anidado dentro del enlace del caso:
                    dos `<a>` uno dentro del otro es HTML inválido y rompe la
                    navegación por teclado de forma inexplicable. */}
                {resolution !== null && (
                  <a
                    href={`#/casos/${encodeURIComponent(item.id)}`}
                    className="shrink-0 rounded-xl border border-line bg-surface-2 px-3 py-2 text-sm font-medium text-muted transition-colors hover:border-brand/50 hover:bg-surface-3 hover:text-ink"
                  >
                    Ver revisión
                  </a>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Panel>
  );
}
