import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAuditRepository, createEvidenceRepository, createFactRepository, createJobRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { PolicyEvaluationPanel } from './PolicyEvaluationPanel';

export const dynamic = 'force-dynamic';

export default async function AuditDetailPage({ params }: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await params;
  const client = await createInsForgeServerClient();
  const audits = createAuditRepository(client.database);
  const audit = await audits.findById(auditId);
  if (!audit) notFound();

  const evidences = await createEvidenceRepository(client.database).listByAudit(auditId);
  const jobRepo = createJobRepository(client.database);
  const jobs = await jobRepo.listByAudit(auditId);
  const artifacts = await jobRepo.listArtifactsByAudit(auditId);
  const factRepo = createFactRepository(client.database);
  const factRuns = await factRepo.listRunsByAudit(auditId);
  const selectedRun = factRuns.find((run) => run.state === 'FROZEN') ?? factRuns[0] ?? null;
  const facts = selectedRun ? await factRepo.listFactsByRun(selectedRun.id) : [];
  const latestEngineRun = await client.database.from('engine_runs').select('*').eq('audit_id', auditId).order('created_at', { ascending: false }).limit(1);

  return (
    <section className="mx-auto max-w-6xl px-6 py-10">
      <Link href="/auditorias" className="text-sm font-medium text-brand hover:underline">Volver a auditorias</Link>
      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-slate-500">Auditoria</p>
          <h1 className="mt-2 break-all text-2xl font-bold text-ink">{audit.id}</h1>
          <p className="mt-2 text-sm text-slate-600">Estado tecnico: {audit.status}</p>

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
          <PolicyEvaluationPanel auditId={audit.id} factRunId={selectedRun?.state === 'FROZEN' ? selectedRun.id : undefined} />
          <form action={`/api/audits/${audit.id}/evidences`} method="post" encType="multipart/form-data" className="rounded-3xl border border-dashed border-slate-300 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-ink">Nueva evidencia</h2>
            <p className="mt-2 text-sm text-slate-600">Sube archivos originales. No se analizaran todavia.</p>
            <input className="mt-6 block w-full rounded-xl border border-slate-300 p-3 text-sm" name="files" type="file" multiple required />
            <p className="mt-3 text-xs text-slate-500">Formatos: PDF, imagenes, audio, TXT, CSV, DOCX, XLSX. Maximo 50 MB por archivo.</p>
            <button className="mt-5 w-full rounded-xl bg-brand px-5 py-3 font-semibold text-white hover:bg-teal-800" type="submit">Subir evidencia</button>
          </form>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-ink">Procesamiento</h2>
            <form action={`/api/audits/${audit.id}/jobs`} method="post" className="mt-4">
              <input type="hidden" name="action" value="PROCESS_EVIDENCES" />
              <button className="w-full rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 hover:bg-slate-50" type="submit">Procesar evidencias</button>
            </form>
            <form action={`/api/audits/${audit.id}/jobs`} method="post" className="mt-3">
              <input type="hidden" name="action" value="EXTRACT_FACTS" />
              <button className="w-full rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 hover:bg-slate-50" type="submit">Extraer hechos</button>
            </form>
            <form action="/api/jobs/process" method="post" className="mt-3">
              <button className="w-full rounded-xl bg-slate-900 px-5 py-3 font-semibold text-white hover:bg-slate-800" type="submit">Procesar siguiente job</button>
            </form>
            <div className="mt-5 space-y-3">
              {jobs.length === 0 ? <p className="text-sm text-slate-500">Sin jobs.</p> : jobs.map((job) => (
                <div key={job.id} className="rounded-xl border border-slate-200 p-3 text-sm">
                  <div className="flex items-center justify-between gap-3">
                    <span className="font-semibold">{job.jobType}</span>
                    <span className="rounded-full bg-slate-100 px-2 py-1 text-xs">{job.status}</span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand" style={{ width: `${job.progress}%` }} /></div>
                  <p className="mt-2 text-xs text-slate-500">Intentos: {job.attemptCount}/{job.maxAttempts}</p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-ink">Artifacts</h2>
            {artifacts.length === 0 ? <p className="mt-3 text-sm text-slate-500">Sin artifacts.</p> : artifacts.map((artifact) => <div key={artifact.id} className="mt-3 rounded-xl border border-slate-200 p-3 text-sm"><p className="font-semibold">{artifact.artifactType}</p><p className="break-all text-xs text-slate-500">Artifact: {artifact.id}</p><p className="break-all text-xs text-slate-500">Evidence: {artifact.evidenceId}</p></div>)}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-ink">Fact Run</h2>
            {selectedRun ? <div className="mt-3 text-sm"><p><strong>ID:</strong> <span className="break-all">{selectedRun.id}</span></p><p><strong>Estado:</strong> {selectedRun.state}</p><p><strong>Policy Version:</strong> {selectedRun.policyCode} V{selectedRun.policyVersion}</p></div> : <p className="mt-3 text-sm text-slate-500">Sin Fact Run.</p>}
            {selectedRun && selectedRun.state !== 'FROZEN' && <form action={`/api/audits/${audit.id}/fact-runs`} method="post" className="mt-4"><input type="hidden" name="action" value="FREEZE" /><input type="hidden" name="factRunId" value={selectedRun.id} /><button className="w-full rounded-xl bg-brand px-5 py-3 font-semibold text-white" type="submit">Congelar análisis</button></form>}
            <h3 className="mt-5 font-semibold text-ink">Facts</h3>
            {facts.length === 0 ? <p className="mt-2 text-sm text-slate-500">Sin facts efectivos.</p> : facts.map((fact) => <div key={fact.id} className="mt-3 rounded-xl border border-slate-200 p-3 text-sm"><p className="font-semibold">{fact.factType}</p><p className="break-all text-xs text-slate-500">Fact: {fact.id}</p><p className="break-all text-xs text-slate-500">Source: {JSON.stringify(fact.sourceRef)}</p></div>)}
          </div>

          <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <h2 className="text-xl font-bold text-ink">Machine Decision</h2>
            {latestEngineRun.data?.[0] ? <div className="mt-3 text-sm"><p><strong>Resultado:</strong> {latestEngineRun.data[0].suggested_outcome ?? 'INDETERMINADO'}</p><p><strong>Estado:</strong> {latestEngineRun.data[0].outcome_status}</p><p className="break-all text-xs text-slate-500">Fact Run: {latestEngineRun.data[0].fact_run_id}</p><p className="break-all text-xs text-slate-500">factsFingerprint: {latestEngineRun.data[0].facts_fingerprint}</p></div> : <p className="mt-3 text-sm text-slate-500">Sin evaluación persistida.</p>}
          </div>
        </div>
      </div>
    </section>
  );
}
