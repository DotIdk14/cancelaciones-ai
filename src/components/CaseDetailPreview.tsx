import type { ReactNode } from 'react';

import { useState } from 'react';

import { ArrowLeft, AudioLines, BookOpenCheck, Clock3, FileCheck2, FileText, MessageSquareText, Search } from 'lucide-react';

import type { CaseDetailResponse, AppRole, CaseReviewDto, CoordinatorDecision, WorkflowState } from '../lib/api';

import type { AuditResultType } from '../skills/audit/types';

import { getLocalPreviewCases, LOCAL_PREVIEW_FLOKZU } from '../lib/local-ui-preview';

import { CaseContextMenu, type ContextTab } from './CaseContextMenu';

import { RESULT_LABELS, REVIEW_RESULT_OPTIONS, resolutionLabel } from '../lib/labels';

import { CaseReviewRecord } from './CaseReviewPanel';

import { CoordinatorDecisionRecord } from './CoordinatorReviewStage';
import { AuditProgressSteps } from './AuditProgressSteps';

import { Button, Panel } from './ui';



const SAMPLE_FILES = [

  { name: 'llamada_retencion_demo.mp3', detail: 'Audio · 03:41', icon: AudioLines },

  { name: 'solicitud_demo.pdf', detail: 'PDF · 2 páginas', icon: FileText },

  { name: 'identificacion_demo.jpg', detail: 'Imagen · archivo local', icon: FileCheck2 },

  { name: 'conversacion_demo.txt', detail: 'Texto · muestra de interfaz', icon: MessageSquareText },

];



/**

 * Detalle de expediente en la vista previa local.

 *

 * Acepta el rol y el estado del flujo simulados para que cada rol vea SU

 * superficie: el Asesor su etapa 1, el Coordinador la finalización y el Gerente

 * el modo de solo lectura. Todo es presentación local: ningún control llama a la

 * API (los formularios de demostración no envían nada).

 */

export function CaseDetailPreview({

  caseId,

  role = null,

  workflowState = 'PENDING_COORDINATOR',

}: {

  caseId: string;

  role?: AppRole | null;

  workflowState?: WorkflowState;

}): ReactNode {

  const [activeTab, setActiveTab] = useState<'evidence' | 'findings' | 'timeline' | 'verdict'>('evidence');

  const [contextOpen, setContextOpen] = useState(false);

  const [contextTab, setContextTab] = useState<ContextTab>('data');

  const item = getLocalPreviewCases().find((candidate) => candidate.id === caseId) ?? getLocalPreviewCases()[0];

  if (!item) return null;



  const contextDetail: CaseDetailResponse = { case: { ...item, canWrite: false, studentName: item.studentName || 'Estudiante de demostración', externalSource: 'FLOKZU', externalCaseId: 'CaVe-30841', flokzuData: LOCAL_PREVIEW_FLOKZU }, evidences: [], audit: null, audits: [], review: null, comparison: null, effectiveResolution: null, workflowState };



  return (

    <div className="case-detail-preview-page">

      <header className="case-workspace-header"><div><a href="#/casos" className="case-workspace-back"><ArrowLeft size={16} /> Volver a casos</a><h1>{item.studentIdentifier ?? 'Sin matrícula'}<span> · CaVe-30841</span></h1></div><Button aria-expanded={contextOpen} onClick={() => setContextOpen(!contextOpen)}>{contextOpen ? 'Cerrar contexto' : 'Ver datos y dictamen'}</Button></header>

      <AuditProgressSteps stages={[
        { label: 'Revisar evidencias', status: item.evidenceCount > 0 ? 'done' : 'attention' },
        { label: 'Consultar análisis de IA', status: item.effectiveResolution || workflowState !== 'PENDING_ADVISOR' ? 'done' : 'current' },
        { label: 'Resolución de asesor', status: workflowState === 'PENDING_ADVISOR' ? 'current' : 'done' },
        { label: 'Finalizar auditoría', status: workflowState === 'FINALIZED' ? 'done' : workflowState === 'PENDING_COORDINATOR' ? 'current' : 'pending' },
      ]} nextAction={workflowState === 'FINALIZED' ? undefined : workflowState === 'PENDING_COORDINATOR' ? 'Revisa la resolución del Asesor y registra la decisión final.' : 'Revisa la propuesta y registra la resolución del Asesor.'}
      actionLabel={role === 'coordinator' && workflowState === 'PENDING_COORDINATOR' ? 'Revisar resolución final' : undefined}
      onAction={role === 'coordinator' && workflowState === 'PENDING_COORDINATOR' ? () => { setContextOpen(true); setContextTab('verdict'); } : undefined} />

      <div className={`case-workspace${contextOpen ? ' case-workspace-context-open' : ''}`}>

        <div className="case-context-slot"><CaseContextMenu key={caseId} detail={contextDetail} open={contextOpen} tab={contextTab} onTabChange={setContextTab} onClose={() => setContextOpen(false)} preview reviewContent={<PreviewReviewFlow caseId={caseId} role={role} workflowState={workflowState} />} /></div>

      <div className="case-detail-layout case-detail-workspace">

        <aside className="case-detail-evidence preview-evidence-column">

          <Panel title={`Evidencias (${item.evidenceCount})`} description="Archivos de muestra; no se almacenan ni se envían.">

            <div className="preview-search-box"><Search size={15} /><span>Buscar evidencia…</span></div>

            {item.evidenceCount === 0 ? <p className="preview-no-files">Este borrador todavía no tiene evidencias.</p> : <div className="preview-evidence-list">{SAMPLE_FILES.slice(0, Math.min(item.evidenceCount, SAMPLE_FILES.length)).map(({ name, detail, icon: Icon }) => <div key={name}><span className="preview-evidence-icon"><Icon size={18} /></span><span><strong>{name}</strong><small>{detail}</small></span><i aria-label="Archivo de demostración" /></div>)}</div>}

          </Panel>

          <div className="preview-audio-card"><div className="flex items-center justify-between"><strong><AudioLines size={16} /> Grabación de muestra</strong><small>03:41</small></div><p>Audio de ejemplo no disponible en la vista local.</p><div className="preview-wave" aria-hidden="true">{Array.from({ length: 44 }, (_, index) => <i key={index} style={{ height: `${18 + ((index * 17) % 52)}%` }} />)}</div><span className="preview-audio-meta">El audio real se reproduce dentro del expediente autenticado.</span></div>

        </aside>

        <section className="case-detail-assessment preview-transcript-column">

          <nav className="case-detail-tabs" role="tablist" aria-label="Contenido del expediente">

            <button type="button" role="tab" aria-selected={activeTab === 'evidence'} onClick={() => setActiveTab('evidence')}><AudioLines size={16} /> Evidencia</button>

            <button type="button" role="tab" aria-selected={activeTab === 'findings'} onClick={() => setActiveTab('findings')}><BookOpenCheck size={16} /> Hechos y checks</button>

            <button type="button" role="tab" aria-selected={activeTab === 'timeline'} onClick={() => setActiveTab('timeline')}><Clock3 size={16} /> Cronología</button>

            <button type="button" role="tab" aria-selected={activeTab === 'verdict'} onClick={() => setActiveTab('verdict')}><FileText size={16} /> Dictamen</button>

            <label className="case-detail-search"><Search size={15} /><span>Buscar en el expediente</span></label>

          </nav>

          <Panel title={activeTab === 'evidence' ? 'Evidencia de muestra' : activeTab === 'findings' ? 'Hechos y checks' : activeTab === 'timeline' ? 'Cronología' : 'Dictamen original de IA'} description="Datos ficticios para revisar la interfaz; no proceden de un expediente real.">

            {activeTab === 'evidence' && <div className="preview-transcript-message"><span><AudioLines size={17} /></span><div><small>llamada_retencion_demo.mp3</small><p>La transcripción de muestra permanece asociada a este archivo dentro de Evidencias.</p></div></div>}

            {activeTab === 'findings' && <div className="case-workspace-empty"><BookOpenCheck size={22} /><strong>Sin hallazgos reales en la vista local</strong><p>Los hechos y checks se cargan desde una auditoría completada del expediente.</p></div>}

            {activeTab === 'timeline' && <div className="case-workspace-empty"><Clock3 size={22} /><strong>Cronología de ejemplo</strong><p>Las fechas y eventos reales se consultan dentro de un expediente autenticado.</p></div>}

            {activeTab === 'verdict' && (item.effectiveResolution ? <div className="preview-demo-result"><small>Resultado ilustrativo</small><strong>{resolutionLabel(item.effectiveResolution.result)}</strong><p>No procede de una auditoría ni de una resolución real.</p></div> : <div className="case-workspace-empty"><FileText size={22} /><strong>Sin dictamen vinculado</strong><p>La vista local no ejecuta auditorías reales.</p></div>)}

          </Panel>

        </section>



      </div>

      </div>

    </div>

  );

}



/**

 * Superficie de revisión de la vista previa local, por rol y etapa simulada.

 *

 * Reutiliza los componentes de LECTURA reales (`CaseReviewRecord` y

 * `CoordinatorDecisionRecord`) con datos ficticios, y para las ACCIONES muestra

 * formularios de demostración con el botón de envío deshabilitado: la vista

 * local nunca llama a la API.

 */

function PreviewReviewFlow({

  caseId,

  role,

  workflowState,

}: {

  caseId: string;

  role: AppRole | null;

  workflowState: WorkflowState;

}): ReactNode {

  if (role === 'manager') {

    return (

      <Panel

        title="Resolución de asesor"

        description="Flujo de revisión en dos etapas: primero el Asesor, después el Coordinador."

      >

        <p role="status" className="text-sm text-muted">

          Solo lectura: el Gerente no carga evidencia, no audita, no comenta áreas y no registra ni

          la revisión del Asesor ni la decisión final del Coordinador.

        </p>

      </Panel>

    );

  }



  if (workflowState === 'FINALIZED') {

    return <CoordinatorDecisionRecord review={previewReviewDto(caseId, true)} />;

  }



  if (workflowState === 'PENDING_COORDINATOR') {

    return (

      <div className="flex flex-col gap-4">

        <CaseReviewRecord caseId={caseId} review={previewReviewDto(caseId, false)} comparison={null} />

        {role === 'coordinator' ? (

          <PreviewCoordinatorFinalizeForm />

        ) : (

          <Panel title="Decisión del Coordinador" description="Finalización del flujo de revisión.">

            <p role="status" className="text-sm text-muted">

              Pendiente de la decisión del Coordinador. Tu decisión de Asesor quedó registrada y no

              se puede modificar.

            </p>

          </Panel>

        )}

      </div>

    );

  }



  // Etapa 1 pendiente: el Asesor ve su formulario; el Coordinador, solo la nota.

  if (role === 'user') return <PreviewAdvisorForm />;

  return (

    <Panel

      title="Resolución de asesor"

      description="Flujo de revisión en dos etapas: primero el Asesor, después el Coordinador."

    >

      <p role="status" className="text-sm text-muted">

        La etapa de Asesor la registra el Asesor dueño del caso. Todavía no hay una decisión que

        finalizar.

      </p>

    </Panel>

  );

}



/** Revisión ficticia del Asesor: la misma forma que sirve el servidor. */

function previewReviewDto(caseId: string, finalized: boolean): CaseReviewDto {

  const now = new Date().toISOString();

  return {

    id: 'preview-review',

    caseId,

    auditId: 'preview-audit',

    result: 'BAJA',

    reviewerName: 'Asesor de muestra',

    comment: 'Resolución de demostración registrada por el Asesor en la vista previa local.',

    createdAt: now,

    coordinatorDecision: finalized ? 'APPROVE' : null,

    coordinatorResolution: null,

    coordinatorCreatedAt: finalized ? now : null,

    coordinatorComment: finalized ? 'Aprobada en la vista previa local.' : null,

  };

}



const PREVIEW_DECISION_OPTIONS: ReadonlyArray<{ value: CoordinatorDecision; label: string }> = [

  { value: 'APPROVE', label: 'Aprobar la resolución del Asesor' },

  { value: 'CHANGE', label: 'Cambiar la resolución' },

];



/** Formulario de demostración de la etapa 1. No envía nada. */

function PreviewAdvisorForm(): ReactNode {

  const [result, setResult] = useState<AuditResultType | ''>('');

  return (

    <Panel

      title="Resolución de asesor"

      description="Registra la resolución del Asesor sin modificar el dictamen original de la auditoría."

    >

      <fieldset className="flex flex-col gap-2">

        <legend className="text-sm font-semibold text-ink">Resolución del Asesor</legend>

        <p className="text-xs text-muted">

          Vista local: formulario de demostración; no registra ninguna decisión.

        </p>

        {REVIEW_RESULT_OPTIONS.map((option) => (

          <label key={option} className="flex items-center gap-2 text-sm text-ink">

            <input

              type="radio"

              name="preview-advisor-result"

              value={option}

              checked={result === option}

              onChange={() => setResult(option)}

              className="h-4 w-4 accent-brand"

            />

            {RESULT_LABELS[option]}

          </label>

        ))}

      </fieldset>

      <Button disabled className="mt-3 w-full" title="Vista local: no se registra ninguna decisión">

        Registrar la revisión · requiere sesión

      </Button>

    </Panel>

  );

}



/** Formulario de demostración de la etapa 2. No envía nada. */

function PreviewCoordinatorFinalizeForm(): ReactNode {

  const [decision, setDecision] = useState<CoordinatorDecision | ''>('');

  return (

    <Panel

      title="Decisión del Coordinador"

      description="Aprueba la resolución del Asesor o cámbiala por otra distinta. No modifica la decisión del Asesor."

    >

      <fieldset className="flex flex-col gap-2">

        <legend className="text-sm font-semibold text-ink">Decisión final</legend>

        <p className="text-xs text-muted">

          Vista local: formulario de demostración; no registra ninguna decisión.

        </p>

        {PREVIEW_DECISION_OPTIONS.map((option) => (

          <label key={option.value} className="flex items-center gap-2 text-sm text-ink">

            <input

              type="radio"

              name="preview-coordinator-decision"

              value={option.value}

              checked={decision === option.value}

              onChange={() => setDecision(option.value)}

              className="h-4 w-4 accent-brand"

            />

            {option.label}

          </label>

        ))}

      </fieldset>

      <Button disabled className="mt-3 w-full" title="Vista local: no se registra ninguna decisión">

        Finalizar el caso · requiere sesión

      </Button>

    </Panel>

  );

}


