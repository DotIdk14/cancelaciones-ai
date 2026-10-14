import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Check, Circle, LoaderCircle, X } from 'lucide-react';
import type { ErrorState } from '../lib/api';
import { Button, ErrorCard } from './ui';

export function ModalShell({ title, onClose, children, variant = 'modal', subtitle, open = true, nonModal = false, className = '', closeLabel }: { title: string; onClose: () => void; children: ReactNode; variant?: 'modal' | 'drawer'; subtitle?: ReactNode; open?: boolean; nonModal?: boolean; className?: string; closeLabel?: string }): ReactNode {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    if (!open) return;
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    const scrollPositions: Array<{ element: HTMLElement; top: number; left: number }> = [];
    for (let element = previous?.parentElement; element; element = element.parentElement) {
      scrollPositions.push({ element, top: element.scrollTop, left: element.scrollLeft });
    }
    if (dialog && nonModal && typeof dialog.show === 'function') dialog.show();
    else if (dialog && !nonModal && typeof dialog.showModal === 'function') dialog.showModal();
    else dialog?.setAttribute('open', '');
    if (variant === 'drawer') dialog?.querySelector<HTMLButtonElement>('button')?.focus();
    return () => {
      dialog?.close?.();
      previous?.focus({ preventScroll: true });
      for (const { element, top, left } of scrollPositions) { element.scrollTop = top; element.scrollLeft = left; }
    };
  }, [variant, open, nonModal]);
  return <dialog ref={ref} aria-labelledby={titleId} onKeyDown={(event) => {
    if (nonModal && event.key === 'Escape') { event.preventDefault(); onClose(); return; }
    if (nonModal) return;
    if (event.key !== 'Tab') return;
    const focusable = Array.from(event.currentTarget.querySelectorAll<HTMLElement>('button:not(:disabled), a[href], input:not(:disabled), select:not(:disabled), textarea:not(:disabled), summary, [tabindex="0"]')).filter((element) => element.getClientRects().length > 0);
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
  }} onCancel={(event) => { event.preventDefault(); onClose(); }} className={`${variant === 'drawer' ? 'flokzu-context-panel' : 'm-auto max-h-[85dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto rounded-2xl border border-line bg-surface-1 p-5 text-ink shadow-xl backdrop:bg-black/70'} ${className}`}>
    <header className={variant === 'drawer' ? 'flokzu-panel-header' : 'mb-5 flex items-center justify-between gap-4'}><div><h2 id={titleId} className="text-lg font-semibold">{title}</h2>{subtitle}</div><button type="button" aria-label={closeLabel ?? (variant === 'drawer' ? 'Cerrar contexto de Flokzu' : 'Cerrar ventana')} onClick={onClose} className="rounded-lg p-2 text-muted hover:bg-surface-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand"><X size={18} /></button></header>
    {children}
  </dialog>;
}

export interface ProgressStage { label: string; status: 'pending' | 'current' | 'done' | 'error'; detail?: string }
export function OperationProgressDialog({ title, stages, error, onClose, onRetry, onReport, children }: {
  title: string; stages: ProgressStage[]; error: ErrorState | null; onClose: () => void;
  onRetry?: () => void; onReport: () => void; children?: ReactNode;
}): ReactNode {
  return <ModalShell title={title} onClose={onClose}>
    <ol aria-live="polite" className="space-y-4">{stages.map((stage) => {
      const Icon = stage.status === 'done' ? Check : stage.status === 'current' ? LoaderCircle : Circle;
      return <li key={stage.label} className="flex gap-3"><Icon size={18} aria-hidden="true" className={stage.status === 'done' ? 'mt-0.5 text-success' : stage.status === 'error' ? 'mt-0.5 text-danger' : 'mt-0.5 text-brand'} /><div><strong className="text-sm">{stage.label}</strong><p className="text-xs text-muted">{stage.detail ?? ({ pending: 'Pendiente', current: 'En curso', done: 'Completado', error: 'No completado' })[stage.status]}</p></div></li>;
    })}</ol>
    {error && <div className="mt-5"><ErrorCard title="La operación no se completó" category={error.category} message={error.message} /><p className="mt-2 break-all text-xs text-muted">Referencia: {error.correlationId ?? 'consulta el expediente para recuperar el estado guardado'}</p></div>}
    {children}
    <p className="mt-5 text-xs text-muted">Cerrar esta ventana no cancela lo que ya está ejecutándose en el servidor. Puedes volver a consultar su estado.</p>
    <footer className="mt-4 flex flex-wrap justify-end gap-2">{error && onRetry && <Button variant="primary" onClick={onRetry}>Reintentar</Button>}<Button variant="secondary" onClick={onReport}>Reportar problema</Button><Button variant="ghost" onClick={onClose}>Cerrar</Button></footer>
  </ModalShell>;
}
