import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, FileText, History, UserRound } from 'lucide-react';
import { getCase, getHistoricalAudit, type AuditDetail, type CaseDetailResponse, type FlokzuCaseData } from '../lib/api';
import { formatDateTime, formatPercent } from '../lib/format';
import { CASE_STATUS_LABELS, CASE_STATUS_TONE, RESULT_LABELS, RESULT_TONE, caseKindLabel, caseKindTone, resolutionLabel } from '../lib/labels';
import { FlokzuContextPanel, FlokzuEvidenceLinks } from './FlokzuContext';
import { Badge } from './ui';
import { StudentHistory } from './StudentHistory';

export type ContextTab = 'data' | 'verdict' | 'audits';
const EMPTY_FLOKZU: FlokzuCaseData = {
  academic: { campus: null, university: null, countryReported: null, program: null, level: null, block: null, programKey: null, entryDate: null },
  procedure: { policyReported: null, motive: null, description: null, requestDate: null, administrativeStartDate: null },
  operations: { currentTask: null, statusReported: null, finalizedReported: null, reviewerReported: null, supervisorReported: null, requesterReported: null, requesterArea: null },
  evidenceReferences: [],
};

function Property({ label, value }: { label: string; value?: string | null }): ReactNode {
  return <div className="case-context-property"><dt>{label}</dt><dd>{value?.trim() || 'No reportado'}</dd></div>;
}
function Section({ title, children, initialOpen = false }: { title: string; children: ReactNode; initialOpen?: boolean }): ReactNode {
  return <details className="case-context-section" open={initialOpen || undefined}><summary>{title}<ChevronDown size={15} aria-hidden="true" /></summary><div>{children}</div></details>;
}

/** La selección histórica es solo contextual: nunca sustituye el estado vivo del expediente. */
export function CaseContextMenu({ detail, open, tab, onTabChange, onClose, notesContent, reviewContent, preview = false }: {
  detail: CaseDetailResponse; open: boolean; tab: ContextTab; onTabChange: (tab: ContextTab) => void; onClose: () => void;
  notesContent?: ReactNode; reviewContent?: ReactNode;
  preview?: boolean;
}): ReactNode {
  const [mobile, setMobile] = useState(() => typeof window.matchMedia === 'function' && window.matchMedia('(max-width: 760px)').matches);
  const [selection, setSelection] = useState<{ audit: AuditDetail; owner: CaseDetailResponse } | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [historyVisited, setHistoryVisited] = useState(false);
  const cache = useRef(new Map<string, AuditDetail>());
  const ticketCache = useRef(new Map<string, CaseDetailResponse>());
  const generation = useRef(0);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; generation.current += 1; }; }, []);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const media = window.matchMedia('(max-width: 760px)');
    const update = (): void => setMobile(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);

  useEffect(() => { if (open && tab === 'audits') setHistoryVisited(true); }, [open, tab]);
  async function selectRelated(caseId: string, auditId: string): Promise<void> {
    const token = ++generation.current;
    setPending(true); setError(null); onTabChange('verdict');
    try {
      const owner = ticketCache.current.get(caseId) ?? await getCase(caseId);
      if (!mounted.current || token !== generation.current) return;
      if (owner.case.id !== caseId) throw new Error('Identidad incompatible');
      ticketCache.current.set(caseId, owner);
      await selectAudit(owner, auditId);
    } catch { if (mounted.current && token === generation.current) { setError('No se pudo consultar ese ticket. Vuelve al historial para reintentar.'); setPending(false); } }
  }

  async function selectAudit(owner: CaseDetailResponse, id: string): Promise<void> {
    const token = ++generation.current;
    setPending(true); setError(null); onTabChange('verdict');
    try {
      const key = `${owner.case.id}:${id}`;
      const audit = owner.audit?.id === id ? owner.audit : cache.current.get(key) ?? await getHistoricalAudit(owner.case.id, id);
      if (!mounted.current || token !== generation.current) return;
      if (audit.caseId !== owner.case.id || audit.id !== id) throw new Error('Identidad incompatible');
      cache.current.set(key, audit);
      setSelection(owner.case.id === detail.case.id && id === detail.audit?.id ? null : { audit, owner });
    } catch { if (mounted.current && token === generation.current) setError('No se pudo leer la auditoría seleccionada. Vuelve al historial para reintentar.'); }
    finally { if (mounted.current && token === generation.current) setPending(false); }
  }

  const source = selection && selection.owner.case.id !== detail.case.id ? selection.owner : detail;
  const audit = selection?.audit ?? detail.audit;
  const assessment = audit?.status === 'COMPLETED' ? audit.resultJson?.audit : null;
  const matchedReview = audit && source.review?.auditId === audit.id ? source.review : null;
  const historical = selection !== null || detail.auditIsCurrent === false;
  const data = detail.case.flokzuData ?? EMPTY_FLOKZU;
  const row = detail.case;

  function auditList(owner: CaseDetailResponse): ReactNode {
    return owner.audits.length === 0 ? <p className="case-context-note">Sin auditorías registradas en este ticket.</p> : <ol className="case-context-audits">{owner.audits.map((item) => <li key={item.id}><button type="button" onClick={() => void selectAudit(owner, item.id)} aria-label={`Consultar auditoría del ${formatDateTime(item.createdAt)}`}><time>{formatDateTime(item.createdAt)}</time><strong>{item.result ? resolutionLabel(item.result) : item.status === 'RUNNING' ? 'En curso' : 'Sin resolución'}</strong><span>{item.procedureSection ? `Sección ${item.procedureSection}` : 'Lineamiento no disponible'} · {item.status === 'COMPLETED' ? 'Completada' : item.status === 'ERROR' ? 'Con error' : 'En curso'}</span><small>{owner.review?.auditId === item.id ? owner.review.coordinatorDecision === 'CHANGE' ? 'Resolución modificada por Coordinador' : owner.review.coordinatorDecision ? 'Validada por Coordinador' : 'Revisada por Asesor' : 'Sin revisión humana vinculada'}</small></button></li>)}</ol>;
  }

  return <FlokzuContextPanel data={data} open={open} nonModal={!mobile} panelTitle="Contexto del expediente" className="case-context-menu" onClose={onClose}>
    <nav className="case-context-tabs" role="tablist" aria-label="Contexto del expediente" onKeyDown={(event) => {
      if (!['ArrowRight', 'ArrowLeft', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const tabs = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]'));
      const current = tabs.indexOf(document.activeElement as HTMLButtonElement);
      const index = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (current + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
      tabs[index]?.click(); tabs[index]?.focus();
    }}>
      {([{ id: 'data', label: 'Datos', Icon: UserRound }, { id: 'verdict', label: 'Dictamen', Icon: FileText }, { id: 'audits', label: 'Auditorías', Icon: History }] as const).map(({ id, label, Icon }) => <button type="button" key={id} role="tab" tabIndex={tab === id ? 0 : -1} id={`context-tab-${id}`} aria-controls={`context-content-${id}`} aria-selected={tab === id} onClick={() => onTabChange(id)}><Icon size={14} aria-hidden="true" />{label}</button>)}
    </nav>
    <div className="case-context-scroll">
      <div className="case-context-identity"><div><Badge tone={caseKindTone(row.isTest)}>{caseKindLabel(row.isTest)}</Badge><span>Actualizado {formatDateTime(row.updatedAt)}</span></div><strong>{row.studentIdentifier || 'Sin matrícula'}</strong><h3>{row.studentName || 'Nombre no reportado'}</h3><p>{row.externalCaseId ? `Ticket ${row.externalCaseId}` : `Expediente ${row.id.slice(0, 8)}`} · Creado {formatDateTime(row.createdAt)}</p></div>
      <section role="tabpanel" id="context-content-data" aria-labelledby="context-tab-data" hidden={tab !== 'data'}>
        <button className="case-context-history-trigger" type="button" onClick={() => onTabChange('audits')}><History size={15} /> Ver historial de auditorías</button>
        <Section title="Información del estudiante" initialOpen><dl>
          <Property label="Nombre" value={row.studentName} /><Property label="Matrícula" value={row.studentIdentifier} />
          <Property label="País reportado" value={data.academic.countryReported} /><Property label="Campus" value={data.academic.campus} />
          <Property label="Proyecto" /><Property label="Programa" value={data.academic.program} /><Property label="Modalidad" />
          <Property label="Nivel" value={data.academic.level} /><Property label="Bloque" value={data.academic.block} />
          <Property label="Clave de programa" value={data.academic.programKey} /><Property label="Fecha de ingreso · Flokzu" value={data.academic.entryDate} />
          <Property label="Inicio de clases confirmado" value={row.cycleStartDate} /><Property label="Estado académico" />
          <div className="case-context-property"><dt>Estado del expediente</dt><dd><Badge tone={CASE_STATUS_TONE[row.status]}>{CASE_STATUS_LABELS[row.status]}</Badge></dd></div>
        </dl></Section>
        {row.externalSource === 'FLOKZU' && <Section title="Contexto administrativo · Flokzu" initialOpen><p className="case-context-note">Información reportada; no acredita evidencia ni determina el dictamen.</p><dl>
          <Property label="Caso CaVe" value={row.externalCaseId} /><Property label="Estado del procedimiento" value={data.operations.statusReported} />
          <Property label="Política reportada" value={data.procedure.policyReported} /><Property label="Tarea actual" value={data.operations.currentTask} />
          <Property label="Motivo" value={data.procedure.motive} /><Property label="Responsable actual" value={row.assignedTo ? row.assignedName || 'Nombre no disponible' : 'Sin asignar'} />
          <Property label="Fecha de solicitud" value={data.procedure.requestDate} /><Property label="Inicio administrativo" value={data.procedure.administrativeStartDate} />
        </dl>{data.procedure.description && <details className="case-context-description"><summary>Descripción de la solicitud</summary><p>{data.procedure.description}</p></details>}<FlokzuEvidenceLinks references={data.evidenceReferences} /></Section>}
        <Section title="Notas e inicio de clases" initialOpen>{notesContent ?? <p className="case-context-note">Sin datos adicionales disponibles.</p>}</Section>
      </section>
      <section role="tabpanel" id="context-content-verdict" aria-labelledby="context-tab-verdict" hidden={tab !== 'verdict'}>
        {pending && <p role="status">Consultando auditoría…</p>}{error && <p role="alert" className="case-context-error">{error}</p>}
        <div hidden={pending || error !== null}>
          <p className="case-context-audit-source">{source.case.externalCaseId ? `Ticket ${source.case.externalCaseId}` : `Expediente ${source.case.id.slice(0, 8)}`}{audit && ` · ${formatDateTime(audit.createdAt)}`}</p>
          {historical && <p className="case-context-warning">Consulta histórica de solo lectura. El expediente abierto permanece sin cambios.</p>}
          {assessment ? <><h3 className="case-context-heading">Resolución propuesta por IA</h3><Badge tone={RESULT_TONE[assessment.result]}>{RESULT_LABELS[assessment.result]}</Badge><dl><Property label="Lineamiento" value={assessment.rule} /><Property label="Sección" value={assessment.procedureSection} /><Property label="Confianza declarada" value={typeof assessment.confidence === 'number' ? formatPercent(assessment.confidence) : null} /></dl><h3 className="case-context-heading">Justificación</h3><p className="case-context-reasoning">{assessment.reasoning}</p>
            <Section title={`Errores y discrepancias (${audit?.resultJson?.conflicts?.length ?? 0})`}>{audit?.resultJson?.conflicts?.length ? audit.resultJson.conflicts.map((conflict, index) => <p key={index} className="case-context-reasoning">{conflict.description}</p>) : <p className="case-context-note">Sin discrepancias registradas.</p>}{(assessment.procedureChecks ?? []).filter((check) => check.status === 'NO_ACREDITADO').map((check, index) => <p key={index} className="case-context-reasoning">{check.procedureSection} · {check.reasoning}</p>)}</Section>
            <Section title={`Evidencias faltantes (${assessment.missingEvidence?.length ?? 0})`}>{assessment.missingEvidence?.length ?? 0 ? (assessment.missingEvidence ?? []).map((item, index) => <div key={index} className="case-context-missing"><strong>{item.title}</strong><p>{item.reason}</p><small>{item.acceptedEvidence.join(' · ')}</small></div>) : <p className="case-context-note">Sin faltantes registrados.</p>}</Section>
          </> : <p className="case-context-note">{audit?.status === 'RUNNING' ? 'Auditoría en curso. El resultado aparecerá al terminar.' : audit?.status === 'ERROR' ? `Auditoría con error: ${audit.errorCategory ?? 'sin categoría'}.` : 'Sin dictamen completado.'}</p>}
          <h3 className="case-context-heading">Resolución humana vinculada</h3>
          {matchedReview ? <dl><Property label="Asesor" value={resolutionLabel(matchedReview.result)} /><Property label="Revisado" value={formatDateTime(matchedReview.createdAt)} />{matchedReview.coordinatorDecision && <Property label="Coordinador" value={resolutionLabel(matchedReview.coordinatorDecision === 'CHANGE' ? matchedReview.coordinatorResolution ?? matchedReview.result : matchedReview.result)} />}</dl> : <p className="case-context-note">Esta auditoría no tiene una revisión humana vinculada.</p>}
        </div>
        <div hidden={selection !== null || pending || error !== null}>{reviewContent}</div>
        {selection !== null && <button type="button" className="case-context-history-trigger" onClick={() => { generation.current += 1; setSelection(null); setError(null); setPending(false); }}>Volver al dictamen actual</button>}
      </section>
      <section role="tabpanel" id="context-content-audits" aria-labelledby="context-tab-audits" hidden={tab !== 'audits'}>
        <h3 className="case-context-heading">Este ticket · {row.externalCaseId ?? row.id.slice(0, 8)}</h3>{auditList(detail)}
        <h3 className="case-context-heading">Otros tickets de la misma matrícula</h3><p className="case-context-note">Cada ticket conserva sus auditorías y resoluciones. Consultarlos no cambia el expediente abierto.</p>
        {error && <p role="alert" className="case-context-error">{error}</p>}
        {!row.studentIdentifier && <p className="case-context-note">Sin matrícula para buscar tickets relacionados.</p>}
        {preview && <p className="case-context-note">La vista de muestra no consulta tickets reales.</p>}
        {!preview && historyVisited && row.studentIdentifier && <StudentHistory caseId={row.id} embedded onSelectAudit={(ownerId, auditId) => void selectRelated(ownerId, auditId)} />}

      </section>
    </div>
  </FlokzuContextPanel>;
}
