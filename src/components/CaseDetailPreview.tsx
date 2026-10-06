import type { ReactNode } from 'react';
import { useState } from 'react';
import { ArrowLeft, AudioLines, BookOpenCheck, Clock3, FileCheck2, FileText, MessageSquareText, Search, ShieldAlert, UserRound } from 'lucide-react';
import { formatDateTime } from '../lib/format';
import { getLocalPreviewCases, localPreviewCaseLabel } from '../lib/local-ui-preview';
import { CASE_STATUS_LABELS, CASE_STATUS_TONE, resolutionLabel } from '../lib/labels';
import { Badge, Button, Panel } from './ui';

const SAMPLE_FILES = [
  { name: 'llamada_retencion_demo.mp3', detail: 'Audio · 03:41', icon: AudioLines },
  { name: 'solicitud_demo.pdf', detail: 'PDF · 2 páginas', icon: FileText },
  { name: 'identificacion_demo.jpg', detail: 'Imagen · archivo local', icon: FileCheck2 },
  { name: 'conversacion_demo.txt', detail: 'Texto · muestra de interfaz', icon: MessageSquareText },
];

export function CaseDetailPreview({ caseId }: { caseId: string }): ReactNode {
  const [activeTab, setActiveTab] = useState<'transcript' | 'findings' | 'timeline' | 'verdict'>('transcript');
  const item = getLocalPreviewCases().find((candidate) => candidate.id === caseId) ?? getLocalPreviewCases()[0];
  if (!item) return null;

  return (
    <div className="case-detail-preview-page">
      <div className="preview-case-heading">
        <a href="#/casos" className="preview-back"><ArrowLeft size={16} /> Regresar</a>
        <div className="preview-case-title"><div><h1>{item.studentIdentifier ?? 'Expediente de demostración'}</h1><p>Matrícula: {item.studentIdentifier ?? 'Sin identificar'} <span>·</span> Expediente {localPreviewCaseLabel(item.id)}</p></div><Badge tone={CASE_STATUS_TONE[item.status]}>{CASE_STATUS_LABELS[item.status]}</Badge></div>
        <div className="preview-case-meta"><span><small>EXPEDIENTE / FOLIO</small><strong>{localPreviewCaseLabel(item.id)}</strong></span><span><small>APERTURA</small><strong>{formatDateTime(item.createdAt)}</strong></span><span><small>ESTADO ACTUAL</small><strong>{CASE_STATUS_LABELS[item.status]}</strong></span></div>
      </div>
      <div className="case-detail-layout">
        <aside className="case-detail-evidence preview-evidence-column">
          <Panel title={`Evidencias (${item.evidenceCount})`} description="Archivos de muestra; no se almacenan ni se envían.">
            <div className="preview-search-box"><Search size={15} /><span>Buscar evidencia…</span></div>
            {item.evidenceCount === 0 ? <p className="preview-no-files">Este borrador todavía no tiene evidencias.</p> : <div className="preview-evidence-list">{SAMPLE_FILES.slice(0, Math.min(item.evidenceCount, SAMPLE_FILES.length)).map(({ name, detail, icon: Icon }) => <div key={name}><span className="preview-evidence-icon"><Icon size={18} /></span><span><strong>{name}</strong><small>{detail}</small></span><i aria-label="Archivo de demostración" /></div>)}</div>}
          </Panel>
          <div className="preview-audio-card"><div className="flex items-center justify-between"><strong><AudioLines size={16} /> Grabación de muestra</strong><small>03:41</small></div><p>Audio de ejemplo no disponible en la vista local.</p><div className="preview-wave" aria-hidden="true">{Array.from({ length: 44 }, (_, index) => <i key={index} style={{ height: `${18 + ((index * 17) % 52)}%` }} />)}</div><span className="preview-audio-meta">El audio real se reproduce dentro del expediente autenticado.</span></div>
        </aside>
        <section className="case-detail-assessment preview-transcript-column">
          <nav className="case-detail-tabs" role="tablist" aria-label="Contenido del expediente">
            <button type="button" role="tab" aria-selected={activeTab === 'transcript'} onClick={() => setActiveTab('transcript')}><AudioLines size={16} /> Transcripción</button>
            <button type="button" role="tab" aria-selected={activeTab === 'findings'} onClick={() => setActiveTab('findings')}><BookOpenCheck size={16} /> Hechos y checks</button>
            <button type="button" role="tab" aria-selected={activeTab === 'timeline'} onClick={() => setActiveTab('timeline')}><Clock3 size={16} /> Cronología</button>
            <button type="button" role="tab" aria-selected={activeTab === 'verdict'} onClick={() => setActiveTab('verdict')}><FileText size={16} /> Dictamen</button>
            <label className="case-detail-search"><Search size={15} /><span>Buscar en el expediente</span></label>
          </nav>
          <Panel title={activeTab === 'transcript' ? 'Transcripción de muestra' : activeTab === 'findings' ? 'Hechos y checks' : activeTab === 'timeline' ? 'Cronología' : 'Dictamen original de IA'} description="Datos ficticios para revisar la interfaz; no proceden de un expediente real.">
            {activeTab === 'transcript' && <>
            <div className="preview-transcript-message"><span><UserRound size={17} /></span><div><small>Asesor · muestra</small><p>La transcripción y las referencias de evidencia aparecerán aquí cuando el expediente real tenga audio procesado.</p></div></div>
            <div className="preview-transcript-message preview-transcript-message-user"><span><UserRound size={17} /></span><div><small>Estudiante · muestra</small><p>Este espacio conserva el texto asociado a cada evidencia y permite abrir el archivo de origen.</p></div></div>
            <div className="preview-transcript-message"><span><UserRound size={17} /></span><div><small>Asesor · muestra</small><p>En producción, cada fragmento queda enlazado al minuto correspondiente de la grabación.</p></div></div>
            <div className="preview-transcript-compose"><MessageSquareText size={16} /><span>Escribe un comentario o busca en la transcripción…</span><Button disabled aria-label="Enviar comentario">Enviar</Button></div>
            </>}
            {activeTab === 'findings' && <div className="case-workspace-empty"><BookOpenCheck size={22} /><strong>Sin hallazgos reales en la vista local</strong><p>Los hechos y checks se cargan desde una auditoría completada del expediente.</p></div>}
            {activeTab === 'timeline' && <div className="case-workspace-empty"><Clock3 size={22} /><strong>Cronología de ejemplo</strong><p>Las fechas y eventos reales se consultan dentro de un expediente autenticado.</p></div>}
            {activeTab === 'verdict' && (item.effectiveResolution ? <div className="preview-demo-result"><small>Resultado ilustrativo</small><strong>{resolutionLabel(item.effectiveResolution.result)}</strong><p>No procede de una auditoría ni de una decisión humana real.</p></div> : <div className="case-workspace-empty"><FileText size={22} /><strong>Sin dictamen vinculado</strong><p>La vista local no ejecuta auditorías reales.</p></div>)}
          </Panel>
        </section>
        <aside className="case-detail-review preview-verdict-column">
          <Panel title={<span className="inline-flex items-center gap-2"><ShieldAlert size={18} /> Dictamen</span>} description="Las decisiones se generan solo al ejecutar la auditoría real.">
            {item.effectiveResolution ? <div className="preview-demo-result"><small>Resultado ficticio del listado</small><strong>{resolutionLabel(item.effectiveResolution.result)}</strong><Badge tone={item.effectiveResolution.source === 'HUMAN' ? 'success' : 'brand'}>Origen {item.effectiveResolution.source === 'HUMAN' ? 'humano' : 'IA'}</Badge><p>Este dato es ilustrativo y no proviene de una auditoría ni de una decisión humana real.</p></div> : <div className="preview-verdict-empty"><span>—</span><strong>Sin evaluación en esta vista</strong><p>No existe un resultado de auditoría vinculado a estos datos de demostración.</p></div>}
            <Button disabled className="w-full">Ejecutar auditoría · requiere sesión</Button>
          </Panel>
          <Panel title="Resolución final del caso" description="La resolución humana se registra sobre una auditoría real.">
            <p className="text-sm text-muted">Las opciones de ratificación y reapertura aparecen al consultar un caso productivo.</p>
            <div className="preview-disabled-options"><span>Resultado de IA</span><span>Decisión humana</span><span>Revisión de evidencia</span></div>
            <Button disabled className="mt-3 w-full">Registrar resolución</Button>
          </Panel>
        </aside>
      </div>
    </div>
  );
}
