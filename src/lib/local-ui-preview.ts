import type { AppRole, CaseSummary, FlokzuCaseData, WorkflowState } from './api';

/**
 * Roles que la vista previa local puede representar. Es SOLO presentación: el
 * preview nunca llama a la API ni resuelve sesión, así que cambiar este valor no
 * altera ninguna autorización real.
 */
export const PREVIEW_ROLES: readonly AppRole[] = ['user', 'coordinator', 'manager'];

export const PREVIEW_ROLE_LABELS: Record<AppRole, string> = {
  user: 'Asesor',
  coordinator: 'Coordinador',
  manager: 'Gerente',
};

/**
 * Rol que representa la vista previa local.
 *
 * Por defecto `coordinator`, para conservar el comportamiento previo de
 * `?preview=dashboard` (todas las entradas de navegación visibles) y poder
 * cambiar a Asesor o Gerente con `?role=`. Solo se lee en modo desarrollo.
 */
export function getLocalPreviewRole(
  search: string = typeof window === 'undefined' ? '' : window.location.search,
): AppRole {
  const raw = new URLSearchParams(search).get('role');
  return (PREVIEW_ROLES as readonly string[]).includes(raw ?? '') ? (raw as AppRole) : 'coordinator';
}

/**
 * Estados del flujo humano de dos etapas que la vista previa local puede
 * simular. Es SOLO presentación: no hay ninguna revisión ni decisión persistida.
 */
export const PREVIEW_WORKFLOW_STATES: readonly WorkflowState[] = [
  'PENDING_ADVISOR',
  'PENDING_COORDINATOR',
  'FINALIZED',
];

/**
 * Estado del flujo que representa la vista previa local.
 *
 * Se lee de `?workflow=`; por defecto `PENDING_COORDINATOR` para que el rol por
 * defecto (Coordinador) muestre de entrada su formulario de finalización. Un
 * valor ausente o inválido cae a ese mismo estado. Solo se lee en desarrollo.
 */
export function getLocalPreviewWorkflowState(
  search: string = typeof window === 'undefined' ? '' : window.location.search,
): WorkflowState {
  const raw = new URLSearchParams(search).get('workflow');
  return (PREVIEW_WORKFLOW_STATES as readonly string[]).includes(raw ?? '')
    ? (raw as WorkflowState)
    : 'PENDING_COORDINATOR';
}

/**
 * Enlace de la vista previa local que cambia rol/estado y CONSERVA el fragmento.
 *
 * El enrutado es por hash: sin el fragmento, cada cambio de rol recargaría en el
 * dashboard en vez de quedarse en la ruta que el revisor estaba viendo. Se
 * compone a mano porque `URLSearchParams` no cubre el fragmento.
 */
export function localPreviewHref(role: AppRole, workflow: WorkflowState, hash: string): string {
  const fragment = hash === '' ? '' : hash.startsWith('#') ? hash : `#${hash}`;
  return `?preview=dashboard&role=${role}&workflow=${workflow}${fragment}`;
}

/** Datos sintéticos, usados únicamente por `?preview=dashboard` en desarrollo. */
export function getLocalPreviewCases(): CaseSummary[] {
  const now = Date.now();
  const minute = 60_000;
  return [
    { id: 'demo-case-001', assignedTo: '10000000-0000-4000-8000-000000000001', assignedName: 'Andrea Torres', country: 'MX', channel: 'WHATSAPP', workflowState: 'PENDING_ADVISOR', creatorRole: 'coordinator', creatorId: '20000000-0000-4000-8000-000000000001', status: 'COMPLETED', studentIdentifier: 'MAT-DEMO-001', evidenceCount: 4, createdAt: new Date(now - 18 * minute).toISOString(), updatedAt: new Date(now - 14 * minute).toISOString(), effectiveResolution: { result: 'CANCELACION_VENTA', source: 'AI' } },
    { id: 'demo-case-002', assignedTo: '10000000-0000-4000-8000-000000000001', assignedName: 'Andrea Torres', creatorRole: 'user', creatorId: '10000000-0000-4000-8000-000000000001', status: 'READY', studentIdentifier: 'MAT-DEMO-002', evidenceCount: 3, createdAt: new Date(now - 48 * minute).toISOString(), updatedAt: new Date(now - 48 * minute).toISOString() },
    { id: 'demo-case-003', creatorRole: 'coordinator', creatorId: '20000000-0000-4000-8000-000000000002', status: 'ERROR', studentIdentifier: null, evidenceCount: 2, createdAt: new Date(now - 3 * 60 * minute).toISOString(), updatedAt: new Date(now - 40 * minute).toISOString() },
    { id: 'demo-case-004', assignedTo: '10000000-0000-4000-8000-000000000001', assignedName: 'Andrea Torres', creatorRole: 'user', creatorId: '10000000-0000-4000-8000-000000000002', status: 'DRAFT', studentIdentifier: null, evidenceCount: 0, createdAt: new Date(now - 22 * minute).toISOString(), updatedAt: new Date(now - 22 * minute).toISOString() },
    { id: 'demo-case-005', country: 'CO', channel: 'CRM', workflowState: 'PENDING_COORDINATOR', creatorRole: 'coordinator', creatorId: '20000000-0000-4000-8000-000000000001', status: 'COMPLETED', studentIdentifier: 'MAT-DEMO-005', evidenceCount: 3, createdAt: new Date(now - 2 * 86400_000).toISOString(), updatedAt: new Date(now - 2 * 86400_000).toISOString(), effectiveResolution: { result: 'BAJA', source: 'HUMAN' } },
    { id: 'demo-case-006', creatorRole: 'user', creatorId: '10000000-0000-4000-8000-000000000003', status: 'AUDITING', studentIdentifier: 'MAT-DEMO-006', evidenceCount: 4, createdAt: new Date(now - 3 * 86400_000).toISOString(), updatedAt: new Date(now - 3 * 86400_000).toISOString() },
    { id: 'demo-case-007', workflowState: 'PENDING_ADVISOR', creatorRole: 'coordinator', creatorId: '20000000-0000-4000-8000-000000000002', status: 'COMPLETED', studentIdentifier: 'MAT-DEMO-007', evidenceCount: 2, createdAt: new Date(now - 4 * 86400_000).toISOString(), updatedAt: new Date(now - 4 * 86400_000).toISOString(), effectiveResolution: { result: 'EVIDENCIA_INSUFICIENTE', source: 'AI' } },
    { id: 'demo-case-008', workflowState: 'FINALIZED', effectiveResolution: { result: 'BAJA', source: 'HUMAN' }, creatorRole: 'user', creatorId: '10000000-0000-4000-8000-000000000001', status: 'READY', studentIdentifier: 'MAT-DEMO-008', evidenceCount: 5, createdAt: new Date(now - 5 * 86400_000).toISOString(), updatedAt: new Date(now - 5 * 86400_000).toISOString() },
    { id: 'demo-case-009', workflowState: 'PENDING_ADVISOR', creatorRole: 'coordinator', creatorId: '20000000-0000-4000-8000-000000000001', status: 'COMPLETED', studentIdentifier: 'MAT-DEMO-009', evidenceCount: 6, createdAt: new Date(now - 6 * 86400_000).toISOString(), updatedAt: new Date(now - 6 * 86400_000).toISOString(), effectiveResolution: { result: 'CANCELACION_VENTA_PETICION_CLIENTE', source: 'AI' } },
    { id: 'demo-case-010', creatorRole: 'user', creatorId: '10000000-0000-4000-8000-000000000002', status: 'DRAFT', studentIdentifier: 'MAT-DEMO-010', evidenceCount: 0, createdAt: new Date(now - 7 * 86400_000).toISOString(), updatedAt: new Date(now - 7 * 86400_000).toISOString() },
  ];
}

export function localPreviewCaseLabel(id: string): string {
  const match = /^demo-case-(\d{3})$/.exec(id);
  return match ? `DEMO-${match[1]}` : id;
}

/** Contexto ficticio para inspección visual local; no se importa ni llama a la API. */
export const LOCAL_PREVIEW_FLOKZU: FlokzuCaseData = {
  academic: { campus: 'UTEL Ecuador', university: 'UTEL', countryReported: 'Ecuador', program: 'Administración de empresas', level: 'Licenciatura', block: 'A', programKey: 'ADM-001', entryDate: '2026-08-01' },
  procedure: { policyReported: '01 · Solicitud de cancelación de venta', motive: 'Solicitud del estudiante', description: 'Solicitud de demostración para revisar el contexto administrativo del expediente. El estudiante solicita seguimiento a su trámite. Los datos reportados por Flokzu se conservan separados de las evidencias cargadas. La fecha administrativa corresponde al registro del ticket y debe distinguirse del inicio de clases confirmado. Este texto es ficticio y no se envía al auditor.', requestDate: '2026-10-12', administrativeStartDate: '2026-10-10' },
  operations: { currentTask: '[BACKOFFICE] [REVISION BO] [CV]', statusReported: 'En revisión', finalizedReported: 'No', reviewerReported: 'Asesor de muestra', supervisorReported: 'Supervisor de muestra', requesterReported: 'Solicitante de muestra', requesterArea: 'Éxito estudiantil' },
  evidenceReferences: [{ label: 'Evidencia de acceso al aula', value: 'captura-demo.png' }],
};
