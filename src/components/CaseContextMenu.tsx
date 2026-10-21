import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronDown, FileText, History, UserRound } from 'lucide-react';
import { getCase, getHistoricalAudit, type AuditDetail, type CaseDetailResponse, type FlokzuCaseData } from '../lib/api';
import { formatDateTime, formatPercent } from '../lib/format';
import { salesChannelCountry, salesChannelLabel } from '../lib/sales-channel-catalog';
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
export function CaseContextMenu({ detail, initialAuditId, open, tab, onTabChange, onClose, notesContent, reviewContent, preview = false, canReconcile = false }: {
  initialAuditId?: string;
  detail: CaseDetailResponse; open: boolean; tab: ContextTab; onTabChange: (tab: ContextTab) => void; onClose: () => void;
  notesContent?: ReactNode; reviewContent?: ReactNode;
  preview?: boolean; canReconcile?: boolean;
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
      setSelection(owner.case.id === detail.case.id && id === detail.audit?.id && detail.auditIsCurrent !== false ? null : { audit, owner });
    } catch { if (mounted.current && token === generation.current) setError('No se pudo leer la auditoría seleccionada. Vuelve al historial para reintentar.'); }
    finally { if (mounted.current && token === generation.current) setPending(false); }
  }

  const initialSelection = useRef<string | null>(null);
  useEffect(() => {
    if (!initialAuditId || initialSelection.current === initialAuditId) return;
    initialSelection.current = initialAuditId;
    void selectAudit(detail, initialAuditId);
    // La selección inicial se aplica una vez por enlace; las posteriores son del usuario.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialAuditId, detail.case.id]);

  const source = selection && selection.owner.case.id !== detail.case.id ? selection.owner : detail;
  const audit = selection?.audit ?? detail.audit;
  const assessment = audit?.status === 'COMPLETED' ? audit.resultJson?.audit : null;
  const facts = audit?.resultJson?.facts ?? [];
  const procedureChecks = assessment?.procedureChecks ?? [];
  const missingEvidence = assessment?.missingEvidence ?? [];
  const conflicts = audit?.resultJson?.conflicts ?? [];
  const matchedReview = audit
    ? source.reviews?.find((candidate) => candidate.auditId === audit.id)
      ?? (source.review?.auditId === audit.id ? source.review : null)
    : null;
  const historical = selection !== null || detail.auditIsCurrent === false;
  const data = detail.case.flokzuData ?? EMPTY_FLOKZU;
  const row = detail.case;

  function auditList(owner: CaseDetailResponse): ReactNode {
    if (owner.audits.length === 0) return <p className="case-context-note">Sin auditorías registradas en este ticket.</p>;
    return <ol className="case-context-audits">{owner.audits.map((item) => {
      const review = owner.reviews?.find(candidate => candidate.auditId === item.id)
        ?? (owner.review?.auditId === item.id ? owner.review : null);
      const version = owner.auditIsCurrent === true && owner.audit?.id === item.id ? 'Auditoría vigente' : 'Auditoría anterior';
      const reviewLabel = review
        ? review.coordinatorDecision === 'CHANGE' ? 'Resolución modificada por Coordinador'
          : review.coordinatorDecision ? 'Validada por Coordinador'
            : 'Revisada por Asesor'
        : 'Sin resolución de asesor vinculada';
      return <li key={item.id}><button type="button" onClick={() => void selectAudit(owner, item.id)} aria-label={`Consultar auditoría del ${formatDateTime(item.createdAt)}`}><time>{formatDateTime(item.createdAt)}</time><strong>{item.result ? resolutionLabel(item.result) : item.status === 'RUNNING' ? 'En curso' : 'Sin resolución'}</strong><span>{version} · {item.procedureSection ? `Sección ${item.procedureSection}` : 'Lineamiento no disponible'} · {item.status === 'COMPLETED' ? 'Completada' : item.status === 'ERROR' ? 'Con error' : 'En curso'}</span><small>{reviewLabel}</small></button></li>;
    })}</ol>;
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
      <header className="case-context-identity"><Badge tone={caseKindTone(row.isTest)}>{caseKindLabel(row.isTest)}</Badge><div><strong>{row.studentIdentifier || 'Sin matrícula'}</strong><p>{row.studentName || 'Nombre no reportado'}</p>{historical && <small>Expediente abierto: {detail.case.externalCaseId ? `Ticket ${detail.case.externalCaseId}` : `expediente ${detail.case.id.slice(0, 8)}`}</small>}</div></header>
      <section role="tabpanel" id="context-content-data" aria-labelledby="context-tab-data" hidden={tab !== 'data'}>
        <button className="case-context-history-trigger" type="button" onClick={() => onTabChange('audits')}><History size={15} /> Ver historial de auditorías</button>
        <Section title="Identificadores y seguimiento" initialOpen><dl>
          <Property label="Ticket CaVe" value={row.externalCaseId} /><Property label="Expediente" value={row.id} />
          <Property label="Creado en sistema" value={formatDateTime(row.createdAt)} /><Property label="Última actualización" value={formatDateTime(row.updatedAt)} />
        </dl></Section>
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
          <Property label="Estado del procedimiento" value={data.operations.statusReported} />
          <Property label="Canal de venta reportado · Flokzu" value={salesChannelLabel(data.operations.salesChannelReported)} />
          <Property label="País asociado al canal · catálogo CaVe" value={salesChannelCountry(data.operations.salesChannelReported)} />
          <Property label="Política reportada" value={data.procedure.policyReported} /><Property label="Tarea actual" value={data.operations.currentTask} />
          <Property label="Motivo" value={data.procedure.motive} /><Property label="Responsable actual" value={row.assignedTo ? row.assignedName || 'Nombre no disponible' : 'Sin asignar'} />
          <Property label="Fecha de solicitud" value={data.procedure.requestDate} /><Property label="Inicio administrativo" value={data.procedure.administrativeStartDate} />
        </dl>{data.procedure.description && <details className="case-context-description"><summary>Descripción de la solicitud</summary><p>{data.procedure.description}</p></details>}<FlokzuEvidenceLinks references={data.evidenceReferences} /></Section>}
        <Section title="Notas e inicio de clases" initialOpen>{notesContent ?? <p className="case-context-note">Sin datos adicionales disponibles.</p>}</Section>
      </section>
      <section role="tabpanel" id="context-content-verdict" aria-labelledby="context-tab-verdict" hidden={tab !== 'verdict'}>
        {pending && <p role="status">Consultando auditoría…</p>}{error && <p role="alert" className="case-context-error">{error}</p>}
        <div className="case-context-verdict-body" hidden={pending || error !== null}>
          <header className="case-context-audit-header">
            <span className="case-context-kicker">{historical ? 'Auditoría anterior' : 'Auditoría vigente'}</span>
            <strong>{source.case.externalCaseId ? `Ticket ${source.case.externalCaseId}` : `Expediente ${source.case.id.slice(0, 8)}`}</strong>
            {audit && <time>{formatDateTime(audit.createdAt)}</time>}
          </header>
          {historical && <p className="case-context-warning">Consulta histórica de solo lectura. El expediente abierto permanece sin cambios.</p>}
          {assessment && audit?.resultJson ? <>
            <article className="case-context-result-card">
              <div className="case-context-result-heading"><div><span className="case-context-kicker">Resolución propuesta por IA</span><Badge tone={RESULT_TONE[assessment.result]}>{RESULT_LABELS[assessment.result]}</Badge></div><span className="case-context-confidence">Confianza declarada <strong>{typeof assessment.confidence === 'number' ? formatPercent(assessment.confidence) : '—'}</strong></span></div>
              <dl className="case-context-foundation"><div><dt>Lineamiento</dt><dd>{assessment.rule || 'No especificado'}</dd></div><div><dt>Sección V5</dt><dd>{assessment.procedureSection || 'No especificada'}</dd></div></dl>
            </article>

            {missingEvidence.length > 0 && <section className="case-context-attention-card" aria-label="Evidencias faltantes">
              <h3>Faltan evidencias por revisar <span>{missingEvidence.length}</span></h3>
              <p>La resolución puede ser preliminar; estas advertencias siguen vigentes.</p>
              <ul>{missingEvidence.map((item, index) => <li key={`${item.title}-${index}`}><strong>{item.title}</strong><span>{item.reason}</span>{item.acceptedEvidence.length > 0 && <small>Puede acreditarse con: {item.acceptedEvidence.join(' · ')}</small>}</li>)}</ul>
            </section>}

            <section className="case-context-explanation">
              <h3>¿Por qué propone esta resolución?</h3>
              <p className="case-context-excerpt">{excerpt(assessment.reasoning)}</p>
              {assessment.reasoning.length > 240 && <details className="case-context-more"><summary>Leer justificación completa</summary><p>{assessment.reasoning}</p></details>}
            </section>

            <Section title={`Hallazgos y criterios (${facts.length} hechos · ${procedureChecks.length} criterios)`}>
              {facts.length > 0 && <div className="case-context-fact-list"><h4>Hechos identificados</h4>{facts.map((fact) => <article key={fact.key}><strong>{fact.label}</strong><span>{fact.value === null ? 'Sin dato determinable' : String(fact.value)}</span>{fact.evidenceText && <p>{fact.evidenceText}</p>}</article>)}</div>}
              {procedureChecks.length > 0 && <div className="case-context-check-list"><h4>Criterios del procedimiento</h4>{procedureChecks.map((check, index) => <article key={`${check.procedureSection}-${index}`}><div><strong>Sección {check.procedureSection}</strong><Badge tone={check.status === 'ACREDITADO' ? 'success' : check.status === 'NO_ACREDITADO' ? 'danger' : 'warning'}>{check.status.replaceAll('_', ' ')}</Badge></div><p>{check.criterion}</p><small>{check.reasoning}</small></article>)}</div>}
            </Section>

            <Section title={`Discrepancias (${conflicts.length})`}>
              {conflicts.length > 0 ? conflicts.map((conflict, index) => <p key={index} className="case-context-reasoning">{conflict.description}</p>) : <p className="case-context-note">No se registraron discrepancias.</p>}
            </Section>
          </> : <p className="case-context-note">{audit?.status === 'RUNNING' ? 'Auditoría en curso. El resultado aparecerá al terminar.' : audit?.status === 'ERROR' ? `Auditoría con error: ${audit.errorCategory ?? 'sin categoría'}.` : 'Sin dictamen completado.'}</p>}

          <section className="case-context-linked-review">
            <h3>Resolución de asesor</h3>
            {matchedReview ? <><Badge tone={RESULT_TONE[matchedReview.result]}>{resolutionLabel(matchedReview.result)}</Badge><time>{formatDateTime(matchedReview.createdAt)}</time>{matchedReview.coordinatorDecision && <p>Resolución final del Coordinador: <strong>{resolutionLabel(matchedReview.coordinatorDecision === 'CHANGE' ? matchedReview.coordinatorResolution ?? matchedReview.result : matchedReview.result)}</strong></p>}</> : <p>Sin resolución de asesor registrada para esta auditoría.</p>}
          </section>
          <div hidden={selection !== null || pending || error !== null}>{reviewContent}</div>
        </div>
        {selection !== null && <button type="button" className="case-context-history-trigger" onClick={() => { generation.current += 1; setSelection(null); setError(null); setPending(false); }}>Volver al dictamen actual</button>}
      </section>
      <section role="tabpanel" id="context-content-audits" aria-labelledby="context-tab-audits" hidden={tab !== 'audits'}>
        <h3 className="case-context-heading">Este ticket · {row.externalCaseId ?? row.id.slice(0, 8)}</h3>{auditList(detail)}
        <h3 className="case-context-heading">Otros tickets de la misma matrícula</h3><p className="case-context-note">Cada ticket conserva sus auditorías y resoluciones. Consultarlos no cambia el expediente abierto.</p>
        {error && <p role="alert" className="case-context-error">{error}</p>}
        {!row.studentIdentifier && <p className="case-context-note">Sin matrícula para buscar tickets relacionados.</p>}
        {preview && <p className="case-context-note">La vista de muestra no consulta tickets reales.</p>}
        {!preview && historyVisited && row.studentIdentifier && <StudentHistory caseId={row.id} studentIdentifier={row.studentIdentifier} canReconcile={canReconcile} embedded onSelectAudit={(ownerId, auditId) => void selectRelated(ownerId, auditId)} />}

      </section>
    </div>
  </FlokzuContextPanel>;
}

function excerpt(value: string, max = 240): string {
  if (value.length <= max) return value;
  const slice = value.slice(0, max);
  const wordEnd = slice.lastIndexOf(' ');
  return `${slice.slice(0, wordEnd > 0 ? wordEnd : max).trimEnd()}…`;
}
