'use client';

// Panel de comentarios manuales de otras áreas. Los campos vacíos se ignoran.
export function ManualCommentsPanel({ auditId, comments, saved }: {
  auditId: string;
  comments: { backOfficeComment?: string | null; helpdeskComment?: string | null; schoolServicesComment?: string | null; financeComment?: string | null; additionalComment?: string | null } | null;
  saved?: boolean;
}) {
  return (
    <section id="comentarios" className="rounded-lg border border-line bg-surface-1 p-4">
      <h2 className="font-semibold text-ink">Comentarios</h2>
      <div className="mt-3 flex gap-2 text-xs text-muted"><span className="rounded-md bg-surface-3 px-3 py-1 text-ink">Todos</span><span>BO</span><span>HelpDesk</span><span>SER</span><span>Finanzas</span></div>
      {saved && <div className="mt-4 rounded-lg border border-success/20 bg-success/10 px-3 py-2 text-sm font-medium text-success">Comentarios guardados correctamente.</div>}
      <form action={`/api/audits/${auditId}/comments`} method="post" className="mt-5 space-y-4">
        <CommentArea id="back_office_comment" label="Comentarios Back Office" value={comments?.backOfficeComment ?? ''} />
        <CommentArea id="helpdesk_comment" label="Comentarios HelpDesk" value={comments?.helpdeskComment ?? ''} />
        <CommentArea id="school_services_comment" label="Comentarios SER / Servicios Escolares" value={comments?.schoolServicesComment ?? ''} />
        <CommentArea id="finance_comment" label="Comentarios Finanzas" value={comments?.financeComment ?? ''} />
        <CommentArea id="additional_comment" label="Comentarios adicionales" value={comments?.additionalComment ?? ''} />
        <div className="flex justify-end">
          <button type="submit" className="inline-flex items-center rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-background transition hover:bg-white">Guardar comentarios</button>
        </div>
      </form>
    </section>
  );
}

function CommentArea({ id, label, value }: { id: string; label: string; value: string }) {
  return (
    <div>
      <label htmlFor={id} className="mb-2 block text-sm font-medium text-muted">{label}</label>
      <textarea id={id} name={id} defaultValue={value} rows={3} className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink outline-none transition placeholder:text-subtle focus:border-brand" placeholder={label} />
    </div>
  );
}
