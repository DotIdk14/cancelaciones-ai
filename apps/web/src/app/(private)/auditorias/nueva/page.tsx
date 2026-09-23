import Link from 'next/link';
import { createAudit } from '@/server/actions/audits';
import { NewAuditForm } from './NewAuditForm';

export const dynamic = 'force-dynamic';

export default function NewAuditPage() {
  return (
    <section className="mx-auto max-w-[1320px] px-6 py-8">
      <div className="mb-5 flex flex-col justify-between gap-3 border-b border-line pb-5 lg:flex-row lg:items-end">
        <div>
          <Link href="/auditorias" className="text-sm font-medium text-muted hover:text-ink">← Volver a auditorías</Link>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <h1 className="text-2xl font-semibold text-ink">Preparación del expediente</h1>
            <span className="rounded-md border border-warning/20 bg-warning/10 px-2 py-1 text-xs font-medium text-warning">En captura</span>
          </div>
          <p className="mt-1 text-sm text-muted">Carga un expediente limpio. Los datos se completan con lo capturado y las evidencias reales.</p>
        </div>
        <div className="rounded-lg border border-line bg-surface-1 px-4 py-3">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-subtle">CaVe</p>
          <p className="mt-1 font-mono text-lg font-semibold text-muted">Sin capturar</p>
        </div>
      </div>

      <NewAuditForm action={createAudit} />
    </section>
  );
}
