// =============================================================================
// Notas rápidas de Back Office y HelpDesk en la zona "Adjuntar evidencias".
//
// QUÉ ES Y QUÉ NO ES
//   Son notas de dos áreas que SÍ entran al expediente al auditar: el servidor
//   las inyecta al prompt CERRADAS con wrapUntrusted (contenido no confiable),
//   y el system prompt le dice al modelo que no son política ni evidencia
//   (AREA_COMMENTS_ARE_NOT_POLICY). Servicios Escolares, Finanzas y Adicional NO
//   se ofrecen aquí: solo viven en `AreaComments` (panel del dictamen) y jamás
//   cruzan al modelo (AREA_COMMENTS_ARE_HUMAN_NOT_POLICY).
//
// POR QUÉ LA PISTA DE "RE-AUDITAR" EXISTE Y NO REPROGRAMA NADA
//   Un dictamen emitido no se reabre solo (DO_NOT_REPROCESS_AI_UNNECESSARILY).
//   Si la nota cambia y ya hay dictamen, la nota NO se incorpora sola: esta
//   sección avisa que hay que auditar de nuevo. Nunca llama a startAudit.
// =============================================================================

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Save } from 'lucide-react';
import { getAreaComments, saveAreaComment, toErrorState, type AreaComment, type AreaCommentArea } from '../lib/api';
import { AREA_COMMENT_LABELS } from '../lib/labels';
import { formatDateTime } from '../lib/format';
import { Button, SectionTitle } from './ui';

/** Mismo límite que valida el servidor (Zod) y el `CHECK` de la base. */
const MAX_LENGTH = 4000;

/** Solo las áreas que el expediente puede usar. Duplicado a propósito (ver api.ts). */
const QUICK_AREAS: readonly AreaCommentArea[] = ['BACK_OFFICE', 'HELPDESK'];

export interface AreaQuickCommentsProps {
  caseId: string;
  /** Ya existe un dictamen emitido para este caso (la nota no se incorpora sola). */
  hasCompletedAudit: boolean;
  /** Enfoca la sección al montar o cuando incrementa. */
  autoFocus?: number;
  /** Se llama cada vez que se guarda una nota con éxito. */
  onSaved?: () => void;
  /** Comentarios precargados por el padre; si se reciben no se vuelve a hacer GET. */
  initialComments?: AreaComment[];
}

function commentsToState(comments: AreaComment[] | undefined): {
  saved: Record<string, AreaComment>;
  drafts: Record<string, string>;
} {
  const saved: Record<string, AreaComment> = {};
  const drafts: Record<string, string> = {};
  if (comments === undefined) return { saved, drafts };
  for (const comment of comments) {
    saved[comment.area] = comment;
    drafts[comment.area] = comment.comment;
  }
  return { saved, drafts };
}

export function AreaQuickComments({
  caseId,
  hasCompletedAudit,
  autoFocus = 0,
  onSaved,
  initialComments,
}: AreaQuickCommentsProps): ReactNode {
  const [saved, setSaved] = useState<Record<string, AreaComment>>(() => commentsToState(initialComments).saved);
  const [drafts, setDrafts] = useState<Record<string, string>>(() => commentsToState(initialComments).drafts);
  const [busyArea, setBusyArea] = useState<AreaCommentArea | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [noticeTone, setNoticeTone] = useState<'ok' | 'error'>('ok');
  const [loadError, setLoadError] = useState<string | null>(null);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (autoFocus > 0 && sectionRef.current !== null) {
      sectionRef.current.focus();
      sectionRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [autoFocus]);

  const load = useCallback(async (): Promise<void> => {
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
      // La subida de evidencias sigue visible: este error es de esta sección.
      setLoadError(toErrorState(cause).message);
    }
  }, [caseId]);

  useEffect(() => {
    if (initialComments === undefined) {
      void load();
    }
  }, [load, initialComments]);

  const save = async (area: AreaCommentArea): Promise<void> => {
    const text = drafts[area] ?? '';
    setBusyArea(area);
    setNotice(null);
    try {
      const comment = await saveAreaComment(caseId, { area, comment: text });
      setSaved((previous) => ({ ...previous, [area]: comment }));
      onSaved?.();
      setNoticeTone('ok');
      const label = AREA_COMMENT_LABELS[area];
      setNotice(
        hasCompletedAudit
          ? `${label} guardado. Hay un dictamen previo: re-audita el caso para que esta nota se considere.`
          : `Comentario de ${label} guardado.`,
      );
    } catch (cause) {
      setNoticeTone('error');
      setNotice(`No se pudo guardar: ${toErrorState(cause).message}`);
    } finally {
      setBusyArea(null);
    }
  };

  return (
    <section
      ref={sectionRef}
      tabIndex={-1}
      aria-label="Notas para la auditoría (Back Office y HelpDesk)"
      className="mt-4 rounded-xl border border-line bg-surface-2 p-3"
    >
      <SectionTitle>Notas para la auditoría (Back Office y HelpDesk)</SectionTitle>
      <p className="mt-1 text-xs text-muted">
        Back Office y HelpDesk pueden dejar notas que se incluyen al auditar como contexto no normativo:
        no son política ni evidencia y por sí solas no deciden el resultado.
      </p>

      {loadError !== null && (
        <p className="mt-2 text-xs text-danger" role="status">
          {loadError}
        </p>
      )}

      <p
        role="status"
        className={`mt-2 min-h-5 text-xs ${noticeTone === 'error' && notice !== null ? 'text-danger' : 'text-muted'}`}
      >
        {notice}
      </p>

      <div className="mt-2 flex flex-col gap-3">
        {QUICK_AREAS.map((area) => {
          const existing = saved[area];
          const draft = drafts[area] ?? '';
          const trimmed = draft.trim();
          const invalid = trimmed === '';
          const dirty = existing === undefined ? trimmed !== '' : trimmed !== existing.comment;
          const tooLong = draft.length > MAX_LENGTH;

          return (
            <div key={area}>
              <label htmlFor={`quick-area-comment-${area}`} className="text-sm font-semibold text-ink">
                {AREA_COMMENT_LABELS[area]}
              </label>

              {existing !== undefined && (
                <p className="mt-0.5 text-xs text-muted">Guardado {formatDateTime(existing.updatedAt)}</p>
              )}

              <textarea
                id={`quick-area-comment-${area}`}
                value={draft}
                onChange={(event) => {
                  setDrafts((previous) => ({ ...previous, [area]: event.target.value }));
                  // El aviso describe el ÚLTIMO guardado: editar lo vuelve obsoleto.
                  setNotice(null);
                }}
                rows={2}
                aria-describedby={`quick-area-comment-${area}-count`}
                placeholder={`Comentario de ${AREA_COMMENT_LABELS[area]}`}
                className="mt-2 w-full resize-y rounded-lg border border-line bg-surface-1 p-2 text-sm text-ink placeholder:text-muted"
              />

              <div className="mt-1 flex flex-wrap items-center justify-between gap-2">
                <span
                  id={`quick-area-comment-${area}-count`}
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