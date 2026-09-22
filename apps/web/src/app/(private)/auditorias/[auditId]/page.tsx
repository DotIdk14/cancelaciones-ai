import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAuditRepository, createEvidenceRepository, createFactRepository, type StoredFact } from '@cancelaciones/db';
import type { PolicyEvaluation } from '@cancelaciones/policy-engine';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { AuditWorkflow } from './AuditWorkflow';
import { HumanFactReview } from './HumanFactReview';

export const dynamic = 'force-dynamic';

function formatFactValue(value: unknown): string {
  if (value && typeof value === 'object' && !Array.isArray(value) && 'observedCounts' in value) {
    const counts = (value as { observedCounts?: unknown[] }).observedCounts?.filter((item): item is number => typeof item === 'number') ?? [];
    return `Conteos observados: ${counts.join(', ') || 'no disponibles'} · total no confirmado`;
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && 'observedCount' in value && !('events' in value)) {
    const observedCount = (value as { observedCount?: unknown }).observedCount;
    return `${typeof observedCount === 'number' ? observedCount : 'No disponible'} registros observados · total no confirmado`;
  }
  if (value && typeof value === 'object' && !Array.isArray(value) && 'events' in value) {
    const collection = value as { events?: unknown[]; observedCount?: number; sourceCompleteness?: string };
    return `${collection.observedCount ?? collection.events?.length ?? 0} eventos observados · fuente ${collection.sourceCompleteness === 'COMPLETE' ? 'completa' : collection.sourceCompleteness === 'PARTIAL' ? 'parcial' : 'no confirmada'}`;
  }
  if (typeof value === 'string') return value;
  const serialized = JSON.stringify(value);
  return serialized ?? 'Sin valor legible';
}

function consolidateFacts(facts: StoredFact[]) {
  const grouped = new Map<string, StoredFact>();
  for (const fact of facts) {
    const previous = grouped.get(fact.factType);
    if (!previous) {
      grouped.set(fact.factType, fact);
      continue;
    }
    if (fact.factType === 'contact.callAttempts' || fact.factType === 'contact.writtenInteractions') {
      const values = [previous.value, fact.value];
      const collections = values.filter((value): value is { events?: unknown[]; observedCount?: number; sourceCompleteness?: string; warnings?: string[] } => Boolean(value && typeof value === 'object' && !Array.isArray(value)));
      if (collections.length) {
        const events = collections.flatMap((value) => value.events ?? []);
        const counts = collections.map((value) => value.observedCount).filter((value): value is number => typeof value === 'number');
        const completeness = collections.some((value) => value.sourceCompleteness === 'PARTIAL')
          ? 'PARTIAL'
          : collections.every((value) => value.sourceCompleteness === 'COMPLETE') ? 'COMPLETE' : 'UNKNOWN';
        const maxCount = Math.max(events.length, ...counts);
        const minCount = counts.length ? Math.min(...counts) : maxCount;
        const materiallyDifferent = maxCount - minCount >= 3 || (minCount > 0 && maxCount / minCount >= 1.5);
        grouped.set(fact.factType, { ...previous, value: { events, observedCount: maxCount, sourceCompleteness: completeness, warnings: materiallyDifferent ? ['MATERIAL_SOURCE_COUNT_DIFFERENCE'] : [] } });
      } else {
        const counts = values.map((value) => typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value) ? Number(value) : null).filter((value): value is number => value !== null);
        const maxCount = counts.length ? Math.max(...counts) : undefined;
        const minCount = counts.length ? Math.min(...counts) : undefined;
        const materiallyDifferent = counts.length > 1 && (maxCount! - minCount! >= 3 || (minCount! > 0 && maxCount! / minCount! >= 1.5));
        grouped.set(fact.factType, { ...previous, value: { observedCount: maxCount, sourceCompleteness: 'UNKNOWN', warnings: materiallyDifferent ? ['MATERIAL_SOURCE_COUNT_DIFFERENCE'] : [] } });
      }
    } else if (JSON.stringify(previous.value) !== JSON.stringify(fact.value)) {
      grouped.set(fact.factType, { ...previous, value: { values: [previous.value, fact.value], sourceCompleteness: 'UNKNOWN' } });
    }
  }
  return Array.from(grouped.values());
}

const factLabels: Record<string, string> = {
  'student.name': 'Nombre del estudiante',
  'student.enrollment': 'Matrícula',
  'student.level': 'Nivel académico',
  'contact.callAttempts': 'Intentos de llamada',
  'contact.writtenInteractions': 'Interacciones escritas',
  'contact.effectiveContact': 'Contacto efectivo',
  'academic.lastCourseAccess': 'Último acceso al curso',
  'academic.platformAccessEvents': 'Accesos registrados en plataforma',
  'classroom.hasLogin': 'Acceso al aula',
  'classroom.hasEvaluationMode': 'Modalidad de evaluación seleccionada',
  'classroom.hasActivities': 'Actividad académica',
};

const ruleLabels: Record<string, string> = {
  'GDM-V5-5.2-A-CONTACT-ATTEMPTS': 'Intentos de contacto y distribución de interacciones',
  'GDM-V5-5.8-A-LICENCIATURA': 'Condiciones académicas para licenciatura',
  'GDM-V5-5.8-A-NON-LICENCIATURA': 'Condiciones académicas para otros niveles',
  'GDM-V5-5.8-A-ACADEMIC-LEVEL-UNKNOWN': 'Nivel académico no identificado',
};

export default async function AuditDetailPage({ params }: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await params;
  const client = await createInsForgeServerClient();
  const audits = createAuditRepository(client.database);
  const audit = await audits.findById(auditId);
  if (!audit) notFound();

  const evidences = await createEvidenceRepository(client.database).listByAudit(auditId);
  const factRepo = createFactRepository(client.database);
  const factRuns = await factRepo.listRunsByAudit(auditId);
  const selectedRun = factRuns.find((run) => run.state === 'FROZEN') ?? factRuns[0] ?? null;
  const facts = selectedRun ? await factRepo.listFactsByRun(selectedRun.id) : [];
  const displayFacts = consolidateFacts(facts);
  const latestEngineRun = await client.database.from('engine_runs').select('*').eq('audit_id', auditId).order('created_at', { ascending: false }).limit(1);
  const evaluation = latestEngineRun.data?.[0]?.evaluation as PolicyEvaluation | undefined;

  return (
    <section className="mx-auto max-w-6xl px-6 py-10">
      <Link href="/auditorias" className="text-sm font-medium text-brand hover:underline">Volver a auditorias</Link>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Auditoria</p>
          <h1 className="mt-2 break-all text-2xl font-bold text-ink">{audit.externalCaseId ?? 'Expediente de auditoría'}</h1>
          <p className="mt-2 text-sm text-slate-600">Revisa la evidencia y el dictamen sugerido del expediente.</p>

          <div className="mt-8">
            <h2 className="text-xl font-bold text-ink">Evidencias</h2>
            <div className="mt-4 overflow-hidden rounded-2xl border border-slate-200">
              <table className="w-full text-left text-sm">
                <thead className="bg-slate-100 text-slate-600">
                  <tr>
                    <th className="px-4 py-3">Archivo</th>
                    <th className="px-4 py-3">Tipo</th>
                    <th className="px-4 py-3">Tamano</th>
                    <th className="px-4 py-3">Estado</th>
                    <th className="px-4 py-3">Acceso</th>
                  </tr>
                </thead>
                <tbody>
                  {evidences.length === 0 ? (
                    <tr><td colSpan={5} className="px-4 py-8 text-center text-slate-500">Aun no hay evidencias.</td></tr>
                  ) : evidences.map((evidence) => (
                    <tr key={evidence.id} className="border-t border-slate-100">
                      <td className="px-4 py-3">{evidence.originalFilename}</td>
                      <td className="px-4 py-3 text-slate-600">{evidence.detectedMimeType}</td>
                      <td className="px-4 py-3 text-slate-600">{Math.round(evidence.sizeBytes / 1024)} KB</td>
                      <td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{evidence.status}</span></td>
                      <td className="px-4 py-3">
                        {evidence.status === 'STORED' ? <a className="font-medium text-brand hover:underline" href={`/api/evidences/${evidence.id}/download`}>Descargar</a> : <span className="text-slate-400">No disponible</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <div className="space-y-6">
          <AuditWorkflow auditId={audit.id} />

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-ink">Datos del estudiante y la auditoría</h2>
            {selectedRun ? <div className="mt-3 text-sm"><p><strong>Estado del análisis:</strong> {selectedRun.state === 'FROZEN' ? 'Listo para dictaminar' : 'En revisión'}</p><p><strong>Fuente normativa:</strong> {selectedRun.policyCode} V{selectedRun.policyVersion}</p></div> : <p className="mt-3 text-sm text-slate-500">Aún no hay hechos identificados.</p>}
            <h3 className="mt-5 font-semibold text-ink">Datos encontrados en las evidencias</h3>
            {displayFacts.length === 0 ? <p className="mt-2 text-sm text-slate-500">Aún no se identifican datos en las evidencias.</p> : displayFacts.map((fact) => <div key={fact.id} className="mt-3 rounded-xl border border-slate-200 p-3 text-sm"><p className="font-semibold">{factLabels[fact.factType] ?? 'Dato observado'}</p><p className="mt-1 text-slate-700">{formatFactValue(fact.value)}</p>{JSON.stringify(fact.value).includes('MATERIAL_SOURCE_COUNT_DIFFERENCE') && <p className="mt-2 text-xs font-medium text-amber-700">Las fuentes reportan cantidades materialmente distintas para este mismo tipo de contacto; requiere validar la evidencia original.</p>}<p className="mt-2 text-xs text-slate-500">Evidencia de respaldo: {String(fact.sourceRef.evidenceId ?? 'Varias evidencias')}</p><HumanFactReview auditId={auditId} factId={fact.id} /></div>)}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-ink">Dictamen sugerido</h2>
            {!evaluation ? <p className="mt-3 text-sm text-slate-500">Aún no hay un dictamen generado.</p> : <div className="mt-4 space-y-4 text-sm">
              <div className="rounded-2xl bg-teal-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-teal-700">Resultado sugerido</p><p className="mt-1 text-xl font-bold text-teal-950">{evaluation.suggestedOutcome ?? 'Sin resultado sugerible'}</p><p className="mt-1 text-teal-800">Estado: {evaluation.decisionStatus ?? evaluation.outcomeStatus}{evaluation.reviewRequired ? ' · Requiere revisión' : ''}</p></div>
              <div><h3 className="font-semibold text-ink">Reglas y fuentes utilizadas</h3>{evaluation.evaluatedRules.map((rule) => <details key={rule.ruleId} className="mt-2 rounded-xl border border-slate-200 p-3"><summary className="cursor-pointer font-semibold">{ruleLabels[rule.ruleId] ?? 'Regla normativa'} · {rule.status}</summary><p className="mt-2 text-slate-700">Fuente: {rule.source.documentCode}, versión {rule.source.version}, sección {rule.source.section}, página {rule.source.page}.</p>{rule.conditions.map((condition) => <div key={condition.id} className="mt-2 rounded-lg bg-slate-50 p-2 text-xs"><p className="font-medium">{condition.description}</p>{condition.observedValue && <p className="mt-1 font-medium text-slate-700">Dato observado: {condition.observedValue}</p>}<p className="text-slate-500">Resultado normativo: {condition.state === 'TRUE' ? 'Sí cumple' : condition.state === 'FALSE' ? 'No cumple' : condition.state === 'NOT_APPLICABLE' ? 'No aplica' : 'No se puede confirmar con la evidencia disponible'}</p></div>)}</details>)}</div>
              {evaluation.missingData.length > 0 && <div className="rounded-xl border border-amber-200 bg-amber-50 p-3"><p className="font-semibold text-amber-900">Información que falta para concluir</p>{evaluation.missingData.map((item) => <p key={item.factType} className="mt-1 text-xs text-amber-800">{factLabels[item.factType] ?? 'Dato requerido'}: {item.whyNeeded}</p>)}</div>}
              {evaluation.conflicts.length > 0 && <div className="rounded-xl border border-red-200 bg-red-50 p-3"><p className="font-semibold text-red-900">Puntos que requieren revisión</p>{evaluation.conflicts.map((conflict, index) => <p key={`${conflict.reason}-${index}`} className="mt-1 text-xs text-red-800">{conflict.reason}</p>)}</div>}
            </div>}
          </div>
        </div>
      </div>
    </section>
  );
}
