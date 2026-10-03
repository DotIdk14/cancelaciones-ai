import type { CaseSummary } from './api';

/** Datos sintéticos, usados únicamente por `?preview=dashboard` en desarrollo. */
export function getLocalPreviewCases(): CaseSummary[] {
  const now = Date.now();
  const minute = 60_000;
  return [
    { id: 'demo-case-001', status: 'COMPLETED', studentIdentifier: 'MAT-DEMO-001', evidenceCount: 4, createdAt: new Date(now - 18 * minute).toISOString(), updatedAt: new Date(now - 14 * minute).toISOString(), effectiveResolution: { result: 'CANCELACION_VENTA', source: 'AI' } },
    { id: 'demo-case-002', status: 'READY', studentIdentifier: 'MAT-DEMO-002', evidenceCount: 3, createdAt: new Date(now - 48 * minute).toISOString(), updatedAt: new Date(now - 48 * minute).toISOString() },
    { id: 'demo-case-003', status: 'ERROR', studentIdentifier: null, evidenceCount: 2, createdAt: new Date(now - 3 * 60 * minute).toISOString(), updatedAt: new Date(now - 40 * minute).toISOString() },
    { id: 'demo-case-004', status: 'DRAFT', studentIdentifier: null, evidenceCount: 0, createdAt: new Date(now - 22 * minute).toISOString(), updatedAt: new Date(now - 22 * minute).toISOString() },
    { id: 'demo-case-005', status: 'COMPLETED', studentIdentifier: 'MAT-DEMO-005', evidenceCount: 3, createdAt: new Date(now - 2 * 86400_000).toISOString(), updatedAt: new Date(now - 2 * 86400_000).toISOString(), effectiveResolution: { result: 'BAJA', source: 'HUMAN' } },
    { id: 'demo-case-006', status: 'AUDITING', studentIdentifier: 'MAT-DEMO-006', evidenceCount: 4, createdAt: new Date(now - 3 * 86400_000).toISOString(), updatedAt: new Date(now - 3 * 86400_000).toISOString() },
    { id: 'demo-case-007', status: 'COMPLETED', studentIdentifier: 'MAT-DEMO-007', evidenceCount: 2, createdAt: new Date(now - 4 * 86400_000).toISOString(), updatedAt: new Date(now - 4 * 86400_000).toISOString(), effectiveResolution: { result: 'EVIDENCIA_INSUFICIENTE', source: 'AI' } },
    { id: 'demo-case-008', status: 'READY', studentIdentifier: 'MAT-DEMO-008', evidenceCount: 5, createdAt: new Date(now - 5 * 86400_000).toISOString(), updatedAt: new Date(now - 5 * 86400_000).toISOString() },
    { id: 'demo-case-009', status: 'COMPLETED', studentIdentifier: 'MAT-DEMO-009', evidenceCount: 6, createdAt: new Date(now - 6 * 86400_000).toISOString(), updatedAt: new Date(now - 6 * 86400_000).toISOString(), effectiveResolution: { result: 'CANCELACION_VENTA_PETICION_CLIENTE', source: 'AI' } },
    { id: 'demo-case-010', status: 'DRAFT', studentIdentifier: 'MAT-DEMO-010', evidenceCount: 0, createdAt: new Date(now - 7 * 86400_000).toISOString(), updatedAt: new Date(now - 7 * 86400_000).toISOString() },
  ];
}

export function localPreviewCaseLabel(id: string): string {
  const match = /^demo-case-(\d{3})$/.exec(id);
  return match ? `DEMO-${match[1]}` : id;
}
