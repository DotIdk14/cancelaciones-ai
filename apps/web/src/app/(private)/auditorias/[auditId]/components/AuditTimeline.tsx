'use client';

import { formatDateTime } from '@/lib/format';

// Línea de tiempo de la auditoría usando el audit_log durable.
export function AuditTimeline({ events = [] }: { events?: Array<{ id: string; eventType: string; actorId: string | null; createdAt: string; metadata?: Record<string, unknown> | null }> }) {
  if (events.length === 0) {
    return (
      <section className="rounded-lg border border-line bg-surface-1 p-6">
        <h2 className="text-lg font-semibold text-ink">Historial de la auditoría</h2>
        <p className="mt-3 text-sm text-muted">Aún no hay eventos registrados.</p>
      </section>
    );
  }

  return (
    <section className="rounded-lg border border-line bg-surface-1 p-6">
      <h2 className="text-lg font-semibold text-ink">Historial de la auditoría</h2>
      <ol className="mt-4 space-y-3">
        {events.map((event) => (
          <li key={event.id} className="flex gap-3">
            <span className="mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full bg-brand" />
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-ink">{event.eventType}</p>
              <p className="text-xs text-muted">{formatDateTime(event.createdAt)}{event.actorId ? ` · por ${event.actorId}` : ''}</p>
              {event.metadata && Object.keys(event.metadata).length > 0 && <p className="mt-1 text-xs text-muted">{JSON.stringify(event.metadata)}</p>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
