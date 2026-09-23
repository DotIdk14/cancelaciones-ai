import Link from 'next/link';
import { listAuditsForCurrentUser } from '@/server/actions/audits';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function AuditsPage() {
  const audits = await listAuditsForCurrentUser();

  return (
    <section className="mx-auto max-w-[1520px] px-6 py-8">
      <div className="flex flex-col justify-between gap-4 lg:flex-row lg:items-end">
        <div>
          <h1 className="text-3xl font-semibold text-ink">Auditorías</h1>
          <p className="mt-1 text-sm text-muted">Lista de expedientes</p>
        </div>
        <div className="flex flex-col gap-3 lg:min-w-[620px]">
          <div className="flex gap-3">
            <div className="flex-1 rounded-lg border border-line bg-surface-1 px-4 py-2.5 text-sm text-muted">Buscar por expediente, alumno o ticket...</div>
            <Link href="/auditorias/nueva" className="rounded-lg bg-ink px-5 py-2.5 text-center text-sm font-semibold text-background hover:bg-white">+ Nueva auditoría</Link>
          </div>
          <div className="flex flex-wrap justify-end gap-2 text-sm">
            {['Estado: Todos', 'Resultado: Todas', 'Política: Todas', 'Fecha: Todas'].map((filter) => <span key={filter} className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-muted">{filter}</span>)}
            <span className="rounded-lg border border-line bg-surface-2 px-3 py-2 text-muted">Limpiar</span>
          </div>
        </div>
      </div>

      <div className="mt-8 overflow-hidden rounded-lg border border-line bg-surface-1">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-line bg-surface-2 text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">CaVe</th>
              <th className="px-4 py-3 font-medium">Expediente</th>
              <th className="px-4 py-3 font-medium">Estado</th>
              <th className="px-4 py-3 font-medium">Resultado</th>
              <th className="px-4 py-3 font-medium">Creada</th>
              <th className="px-4 py-3 font-medium">Acciones</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {audits.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-muted">Aún no hay auditorías.</td>
              </tr>
            ) : audits.map((audit) => (
              <tr key={audit.id} className="hover:bg-white/[0.03]">
                <td className="px-4 py-4"><a className="font-mono font-semibold text-ink hover:text-brand" href={`/auditorias/${audit.id}`}>{audit.externalCaseId ?? 'Sin CaVe'}</a></td>
                <td className="px-4 py-4"><span className="font-medium text-muted">{audit.displayName ?? 'Sin nombre asignado'}</span><div className="mt-1 font-mono text-xs text-subtle">{audit.id}</div></td>
                <td className="px-4 py-4"><span className="rounded-md bg-surface-3 px-3 py-1 text-xs font-medium text-muted">{audit.status}</span></td>
                <td className="px-4 py-4 text-muted">—</td>
                <td className="px-4 py-4 text-muted">{formatDateTime(audit.createdAt)}</td>
                <td className="px-4 py-4"><a className="rounded-md bg-surface-3 px-4 py-2 text-sm font-medium text-ink hover:bg-white/10" href={`/auditorias/${audit.id}`}>Ver</a></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-line px-4 py-4 text-sm text-muted">Mostrando {audits.length} de {audits.length} auditorías</div>
      </div>
    </section>
  );
}
