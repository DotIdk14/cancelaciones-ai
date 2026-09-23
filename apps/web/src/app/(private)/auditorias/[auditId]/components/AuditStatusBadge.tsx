'use client';

// Etiqueta de estado reutilizable para auditorias y flujos de dictamen.
import type { AuditStatus } from './types';

const statusStyles: Record<string, { label: string; className: string }> = {
  DRAFT: { label: 'Borrador', className: 'border-line bg-surface-3 text-muted' },
  PROCESSING: { label: 'En proceso', className: 'border-warning/20 bg-warning/10 text-warning' },
  READY: { label: 'Lista', className: 'border-success/20 bg-success/10 text-success' },
  FROZEN: { label: 'Congelada', className: 'border-success/20 bg-success/10 text-success' },
  COMPLETED: { label: 'Completada', className: 'border-success/20 bg-success/10 text-success' },
  FAILED: { label: 'Fallida', className: 'border-danger/20 bg-danger/10 text-danger' },
  REVIEW: { label: 'En revisión', className: 'border-warning/20 bg-warning/10 text-warning' },
  FINAL: { label: 'Final', className: 'border-success/20 bg-success/10 text-success' },
};

export function AuditStatusBadge({ status }: { status: AuditStatus }) {
  const style = statusStyles[status] ?? { label: status, className: 'border-line bg-surface-3 text-muted' };
  return <span className={`inline-flex rounded-full border px-3 py-1 text-xs font-medium ${style.className}`}>{style.label}</span>;
}
