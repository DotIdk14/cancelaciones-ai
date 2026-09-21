import Link from 'next/link';
import { notFound } from 'next/navigation';
import { createAuditRepository, createEvidenceRepository, createJobRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';

export const dynamic = 'force-dynamic';

export default async function AuditDetailPage({ params }: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await params;
  const client = await createInsForgeServerClient();
  const audits = createAuditRepository(client.database);
  const audit = await audits.findById(auditId);
  if (!audit) notFound();

  const evidences = await createEvidenceRepository(client.database).listByAudit(auditId);
  const jobs = await createJobRepository(client.database).listByAudit(auditId);

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
              <button className="w-full rounded-xl border border-slate-300 px-5 py-3 font-semibold text-slate-700 hover:bg-slate-50" type="submit">Encolar job sintetico</button>
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
        </div>
      </div>
    </section>
  );
}
