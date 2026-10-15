import { useState, type ReactNode } from 'react';
import { ArrowRight, ArrowUpRight, ChevronDown } from 'lucide-react';
import type { FlokzuCaseData } from '../lib/api';
import { salesChannelCountry, salesChannelLabel } from '../lib/sales-channel-catalog';
import { normalizeFlokzuUrl, flokzuUrlsInText } from '../lib/flokzu-links';
import { ModalShell } from './OperationProgressDialog';

type ContextProps = { externalCaseId?: string | null; assignedTo?: string | null; assignedName?: string | null; data: FlokzuCaseData };

export function flokzuTaskLabel(task: string | null): string {
  if (!task) return 'Etapa no reportada';
  if (/\[BACKOFFICE\].*\[REVISION BO\]/i.test(task)) return 'Revisión BackOffice';
  if (/\[HD\].*\[REVISION REPLICA\]/i.test(task)) return 'Revisión de réplica · HelpDesk';
  return task.replace(/\[([^\]]+)\]/g, '$1').replace(/\s+/g, ' ').trim();
}

function FlokzuPropertyRow({ label, value, emphasis = false }: { label: string; value?: string | null; emphasis?: boolean }): ReactNode {
  if (!value) return null;
  return <div className={`flokzu-property${emphasis ? ' flokzu-property-emphasis' : ''}`}><dt>{label}</dt><dd>{value}</dd></div>;
}

export function FlokzuEvidenceLinks({ references }: { references: FlokzuCaseData['evidenceReferences'] }): ReactNode {
  const labelsByUrl = new Map<string, Set<string>>();
  for (const reference of references) {
    // Compatibilidad de datos históricos: únicamente URLs reales, nunca nombres de archivo.
    const candidates = reference.url ? [normalizeFlokzuUrl(reference.url)] : flokzuUrlsInText(reference.value);
    for (const url of candidates) {
      if (!url) continue;
      const labels = labelsByUrl.get(url) ?? new Set<string>();
      labels.add(reference.label);
      labelsByUrl.set(url, labels);
    }
  }
  const links = [...labelsByUrl].map(([url, labels]) => ({ url, label: [...labels].join(' · ') }));
  if (!links.length) return null;
  return <section className="flokzu-section"><h3>Documentos enlazados desde Flokzu</h3><p className="flokzu-section-note">Referencias externas. Los archivos deben adjuntarse por separado; no son pruebas verificadas.</p><ul className="flokzu-evidence-links">{links.map(({ label, url }) => <li key={url}><a href={url} target="_blank" rel="noopener noreferrer"><span>{label}</span><ArrowUpRight size={15} aria-hidden="true" /><span className="sr-only"> (abre en otra pestaña)</span></a></li>)}</ul></section>;
}

export function FlokzuContextPanel({ externalCaseId, assignedTo, assignedName, data, onClose, children, open, nonModal, panelTitle, className }: ContextProps & { onClose: () => void; children?: ReactNode; open?: boolean; nonModal?: boolean; panelTitle?: string; className?: string }): ReactNode {
  const [expanded, setExpanded] = useState(false);
  return <ModalShell title={panelTitle ?? 'Contexto de Flokzu'} variant="drawer" onClose={onClose} open={open} nonModal={nonModal} className={className} closeLabel={panelTitle ? 'Cerrar contexto del expediente' : undefined} subtitle={panelTitle ? undefined : <p className="flokzu-panel-subtitle">{externalCaseId ?? 'Flokzu'} · Información administrativa importada</p>}>
    {children ?? <>
    <div className="flokzu-panel-scroll">
      <p className="flokzu-disclaimer">Datos reportados por el sistema de origen. No constituyen evidencia verificada ni determinan el dictamen de IA.</p>
      <section className="flokzu-section"><h3>Estado y procedimiento</h3><dl>
        <FlokzuPropertyRow label="Estado reportado" value={data.operations.statusReported} emphasis />
        <FlokzuPropertyRow label="Canal de venta reportado · Flokzu" value={salesChannelLabel(data.operations.salesChannelReported)} />
        {salesChannelCountry(data.operations.salesChannelReported) && <FlokzuPropertyRow label="País asociado al canal · catálogo CaVe" value={salesChannelCountry(data.operations.salesChannelReported)} />}
        <FlokzuPropertyRow label="Política reportada" value={data.procedure.policyReported} emphasis />
        <FlokzuPropertyRow label="Tarea actual" value={data.operations.currentTask} />
        <FlokzuPropertyRow label="Motivo" value={data.procedure.motive} />
        <FlokzuPropertyRow label="Fecha de solicitud · Flokzu" value={data.procedure.requestDate} />
      </dl></section>
      <section className="flokzu-section"><h3>Información académica</h3><dl className="flokzu-academic-grid">
        <FlokzuPropertyRow label="Campus" value={data.academic.campus} />
        <FlokzuPropertyRow label="País reportado" value={data.academic.countryReported} />
        <FlokzuPropertyRow label="Universidad" value={data.academic.university} />
        <FlokzuPropertyRow label="Programa" value={data.academic.program} />
        <FlokzuPropertyRow label="Nivel" value={data.academic.level} />
        <FlokzuPropertyRow label="Bloque" value={data.academic.block} />
        <FlokzuPropertyRow label="Clave de programa" value={data.academic.programKey} />
        <FlokzuPropertyRow label="Fecha de ingreso · Flokzu" value={data.academic.entryDate} />
      </dl></section>
      {data.procedure.description && <section className="flokzu-section"><h3>Descripción de la solicitud</h3><p id="flokzu-description" className={`flokzu-description${expanded ? '' : ' flokzu-description-clamped'}`}>{data.procedure.description}</p><button type="button" className="flokzu-text-action" aria-expanded={expanded} aria-controls="flokzu-description" onClick={() => setExpanded(!expanded)}>{expanded ? 'Mostrar menos' : 'Leer completo'}</button></section>}
      <FlokzuEvidenceLinks references={data.evidenceReferences} />
      <details className="flokzu-section flokzu-operational"><summary>Datos operativos<ChevronDown size={16} aria-hidden="true" /></summary><dl>
        <FlokzuPropertyRow label="Responsable actual" value={assignedTo ? assignedName || 'Nombre no disponible' : 'Sin asignar'} />
        <FlokzuPropertyRow label="Supervisor reportado" value={data.operations.supervisorReported} />
        <FlokzuPropertyRow label="Solicitante" value={data.operations.requesterReported} />
        <FlokzuPropertyRow label="Área solicitante" value={data.operations.requesterArea} />
        <FlokzuPropertyRow label="Agente revisor reportado" value={data.operations.reviewerReported} />
        <FlokzuPropertyRow label="Finalizado reportado" value={data.operations.finalizedReported} />
        <FlokzuPropertyRow label="Fecha Inicio administrativa · Flokzu" value={data.procedure.administrativeStartDate} />
      </dl><p className="flokzu-section-note">La fecha administrativa no acredita el inicio académico confirmado, que se registra por separado en el expediente.</p></details>
    </div>
    </>}
  </ModalShell>;
}

export function FlokzuContextBar(props: ContextProps): ReactNode {
  const [open, setOpen] = useState(false);
  const { data, externalCaseId } = props;
  return <><div className="flokzu-context-bar" aria-label="Resumen del contexto importado de Flokzu">
    <div className="flokzu-origin"><span>Flokzu</span><strong>{externalCaseId ?? 'Sin identificador'}</strong></div>
    <span className="flokzu-bar-status" title={data.operations.statusReported ?? undefined}>{data.operations.statusReported ?? 'Estado no reportado'}</span>
    <span className="flokzu-bar-task" title={data.operations.currentTask ?? undefined}>{flokzuTaskLabel(data.operations.currentTask)}</span>
    <span className="flokzu-bar-policy" title={data.procedure.policyReported ?? undefined}>{data.procedure.policyReported ?? 'Política no reportada'}</span>
    <button type="button" className="flokzu-context-trigger" aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen(true)}>Ver contexto<ArrowRight size={15} aria-hidden="true" /></button>
  </div>{open && <FlokzuContextPanel {...props} onClose={() => setOpen(false)} />}</>;
}
