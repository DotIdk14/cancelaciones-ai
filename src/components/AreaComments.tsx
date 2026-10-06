// =============================================================================
// Comentarios manuales por área (Back Office, HelpDesk, Servicios Escolares,
// Finanzas, Adicional).
//
// QUÉ ES Y QUÉ NO ES
//   Es la bitácora en la que cada área deja su observación sobre el caso. NO es
//   normativa, NO alimenta al modelo y NO participa en el dictamen: el criterio
//   sigue siendo exclusivamente el procedimiento del owner. Nada de lo que se
//   escribe aquí se inyecta en ningún prompt.
//
// POR QUÉ CARGA SUS PROPIOS DATOS Y NO LOS RECIBE DEL CASO
//   El dictamen y la bitácora son dos recursos independientes. Si esta pantalla
//   fallara al cargar y el `CaseDetailPage` la pagara con el resto del detalle,
//   un error de comentarios dejaría sin dictamen un caso que sí tiene dictamen.
//   Aquí se cargan aparte y un fallo se muestra como fallo de comentarios, sin
//   tocar lo que el modelo dictaminó.
//
// POR QUÉ UN CAMPO POR ÁREA Y NO UN HISTORIAL
//   Un comentario vigente por área; guardar sustituye. Es lo que hace falta para
//   leer de un vistazo qué dijo cada área. Un histórico por cada una sería un
//   registro de auditoría que nadie pidió y que nadie va a leer.
// =============================================================================

import type { ReactNode } from 'react';
import { useCallback, useEffect, useState } from 'react';
import { Save } from 'lucide-react';
import type { AreaComment, AreaCommentArea } from '../lib/api';
import { AREA_COMMENT_AREAS, getAreaComments, saveAreaComment, toErrorState } from '../lib/api';
import { AREA_COMMENT_LABELS } from '../lib/labels';
import { formatDateTime } from '../lib/format';
import { Button, ErrorCard, SectionTitle, Spinner } from './ui';

/** Mismo límite que valida el servidor (Zod) y el `CHECK` de la base. */
const MAX_LENGTH = 4000;

export interface AreaCommentsProps {
  caseId: string;
}

export function AreaComments({ caseId }: AreaCommentsProps): ReactNode {
  const [saved, setSaved] = useState<Record<string, AreaComment>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [busyArea, setBusyArea] = useState<AreaCommentArea | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<'ok' | 'error'>('ok');
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (): Promise<void> => {
    setLoading(true);
    setLoadError(null);
    try {
      const comments = await getAreaComments(caseId);
      const byArea: Record<string, AreaComment> = {};
      const initial: Record<string, string> = {};
      for (const comment of comments) {
        byArea[comment.area] = comment;
        initial[comment.area] = comment.comment;
      }
      setSaved(byArea);
      setDrafts(initial);
    } catch (cause) {
      // El dictamen sigue visible: este error es de esta sección, no del caso.
      setLoadError(toErrorState(cause).message);
    } finally {
      setLoading(false);
    }
  }, [caseId]);

  useEffect(() => {
    void load();
  }, [load]);

  const save = async (area: AreaCommentArea): Promise<void> => {
    const text = drafts[area] ?? '';
    setBusyArea(area);
    setNotice(null);
    try {
      const comment = await saveAreaComment(caseId, { area, comment: text });
      setSaved((previous) => ({ ...previous, [area]: comment }));
      setNoticeTone('ok');
      setNotice(`Comentario de ${AREA_COMMENT_LABELS[area]} guardado.`);
    } catch (cause) {
      setNoticeTone('error');
      setNotice(`No se pudo guardar: ${toErrorState(cause).message}`);
    } finally {
      setBusyArea(null);
    }
  };

  if (loading) {
    return (
      <div className="mt-5">
        <SectionTitle>Comentarios de las áreas</SectionTitle>
        <div className="mt-2">
          <Spinner label="Cargando comentarios de las áreas" />
        </div>
      </div>
    );
  }

  return (
    <section aria-label="Comentarios de las áreas" className="mt-6">
      <SectionTitle>Comentarios de las áreas</SectionTitle>
      <p className="mt-1 text-xs text-muted">
        Observación de cada área sobre el caso. No participa en el dictamen: el criterio es el
        procedimiento de la organización.
      </p>

      {loadError !== null && (
        <div className="mt-3">
          <ErrorCard
            title="No se pudieron cargar los comentarios"
            message={loadError}
            onRetry={() => void load()}
          />
        </div>
      )}

      {/* `role="status"` y no `aria-live` suelto: el aviso necesita anunciarse
          aunque el lector llegue tarde a esta región. */}
      <p
        role="status"
        className={`mt-2 min-h-5 text-xs ${noticeTone === 'error' && notice !== null ? 'text-danger' : 'text-muted'}`}
      >
        {notice}
      </p>

      <div className="mt-2 flex flex-col gap-3">
        {AREA_COMMENT_AREAS.map((area) => {
          const existing = saved[area];
          const draft = drafts[area] ?? '';
          const trimmed = draft.trim();
          const invalid = trimmed === '';
          // Guardar solo tiene sentido si el borrador difiere de lo persistido.
          // Sin esto, el botón quedaría activo con el mismo texto y el operador
          // no sabría si su edición se aplicó.
          const dirty = existing === undefined ? trimmed !== '' : trimmed !== existing.comment;
          const tooLong = draft.length > MAX_LENGTH;

          return (
            <div key={area} className="rounded-xl border border-line bg-surface-2 p-3">
              <label htmlFor={`area-comment-${area}`} className="text-sm font-semibold text-ink">
                {AREA_COMMENT_LABELS[area]}
              </label>

              {existing !== undefined && (
                <p className="mt-0.5 text-xs text-muted">Guardado {formatDateTime(existing.updatedAt)}</p>
              )}

              <textarea
                id={`area-comment-${area}`}
                value={draft}
                onChange={(event) =>
                  setDrafts((previous) => ({ ...previous, [area]: event.target.value }))
                }
                rows={3}
                aria-describedby={`area-comment-${area}-count`}
                placeholder={`Comentario de ${AREA_COMMENT_LABELS[area]}`}
                className="mt-2 w-full resize-y rounded-lg border border-line bg-surface-1 p-2 text-sm text-ink placeholder:text-muted"
              />

              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <span
                  id={`area-comment-${area}-count`}
                  className={`text-xs tabular-nums ${tooLong ? 'text-danger' : 'text-muted'}`}
                >
                  {draft.length}/{MAX_LENGTH}
                </span>
                <Button
                  onClick={() => void save(area)}
                  disabled={!dirty || invalid || tooLong || busyArea !== null}
                  loading={busyArea === area}
                  loadingLabel="Guardando"
                >
                  <Save size={14} aria-hidden="true" />
                  {existing === undefined ? 'Guardar' : 'Actualizar'}
                  <span className="sr-only"> el comentario de {AREA_COMMENT_LABELS[area]}</span>
                </Button>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}