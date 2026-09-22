import Link from 'next/link';
import { createAudit } from '@/server/actions/audits';

export const dynamic = 'force-dynamic';

export default function NewAuditPage() {
  return (
    <section className="mx-auto max-w-3xl px-6 py-10">
      <Link href="/auditorias" className="text-sm font-medium text-brand hover:underline">Volver a auditorias</Link>
      <div className="mt-6 rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
        <h1 className="text-3xl font-bold text-ink">Nueva auditoria</h1>
        <p className="mt-2 text-slate-600">Asigna un nombre al expediente y después arrastra sus evidencias.</p>
        <form action={createAudit} className="mt-6 space-y-4">
          <label className="block text-sm font-medium text-slate-700">
            Nombre del expediente
            <input name="displayName" required placeholder="Auditoría de Juan Pérez" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-brand" />
          </label>
          <label className="block text-sm font-medium text-slate-700">
            Identificador CaVe opcional
            <input name="externalCaseId" placeholder="CaVe-30344" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 outline-none focus:border-brand" />
          </label>
          <button type="submit" className="rounded-xl bg-brand px-5 py-3 font-semibold text-white hover:bg-teal-800">
            Crear auditoria
          </button>
        </form>
      </div>
    </section>
  );
}
