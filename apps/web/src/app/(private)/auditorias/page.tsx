import Link from 'next/link';
import { listAuditsForCurrentUser } from '@/server/actions/audits';

export const dynamic = 'force-dynamic';

export default async function AuditsPage() {
  const audits = await listAuditsForCurrentUser();

  return (
    <section className="mx-auto max-w-6xl px-6 py-10">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-4xl font-bold text-ink">Auditorias</h1>
          <p className="mt-2 text-slate-600">Base persistente inicial para expedientes de auditoria.</p>
        </div>
        <Link href="/auditorias/nueva" className="rounded-xl bg-brand px-5 py-3 text-center font-semibold text-white hover:bg-teal-800">
          Nueva auditoria
        </Link>
      </div>

      <div className="mt-8 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-100 text-slate-600">
            <tr>
              <th className="px-4 py-3">ID</th>
              <th className="px-4 py-3">Estado</th>
              <th className="px-4 py-3">Creada</th>
            </tr>
          </thead>
          <tbody>
            {audits.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-8 text-center text-slate-500">Aun no hay auditorias.</td>
              </tr>
            ) : audits.map((audit) => (
              <tr key={audit.id} className="border-t border-slate-100">
                <td className="px-4 py-3 font-mono text-xs text-slate-700"><a className="text-brand hover:underline" href={`/auditorias/${audit.id}`}>{audit.id}</a></td>
                <td className="px-4 py-3"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{audit.status}</span></td>
                <td className="px-4 py-3 text-slate-600">{new Date(audit.createdAt).toLocaleString('es-MX')}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
