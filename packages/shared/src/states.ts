export const AUDIT_RUN_STATUSES = [
  'CREATED',
  'PROCESSING_EVIDENCE',
  'ANALYZING',
  'REVIEWING',
  'COMPLETED',
  'NEEDS_INPUT',
  'FAILED',
] as const;
export type AuditRunStatus = (typeof AUDIT_RUN_STATUSES)[number];

/** Estados terminales: un run que llega a uno de ellos no se reescribe ni se relanza. */
export const TERMINAL_AUDIT_RUN_STATUSES = ['COMPLETED', 'NEEDS_INPUT', 'FAILED'] as const;
export type TerminalAuditRunStatus = (typeof TERMINAL_AUDIT_RUN_STATUSES)[number];

/**
 * Grafo de transiciones del run. Es la única fuente de verdad: si un estado
 * no aparece como destino aquí, el cambio se rechaza en el servidor y no
 * depende de que cada llamador recuerde la regla.
 */
export const AUDIT_RUN_TRANSITIONS: Record<AuditRunStatus, readonly AuditRunStatus[]> = {
  CREATED: ['PROCESSING_EVIDENCE', 'FAILED'],
  PROCESSING_EVIDENCE: ['ANALYZING', 'FAILED'],
  ANALYZING: ['REVIEWING', 'COMPLETED', 'NEEDS_INPUT', 'FAILED'],
  REVIEWING: ['COMPLETED', 'NEEDS_INPUT', 'FAILED'],
  COMPLETED: [],
  NEEDS_INPUT: [],
  FAILED: [],
};

const TERMINAL_AUDIT_RUN_STATUS_SET: ReadonlySet<string> = new Set(TERMINAL_AUDIT_RUN_STATUSES);

export function isTerminalAuditRunStatus(status: AuditRunStatus): status is TerminalAuditRunStatus {
  return TERMINAL_AUDIT_RUN_STATUS_SET.has(status);
}

export function canTransitionAuditRunStatus(from: AuditRunStatus, to: AuditRunStatus): boolean {
  if (isTerminalAuditRunStatus(from)) return false;
  return AUDIT_RUN_TRANSITIONS[from].includes(to);
}

export const TOOL_EXECUTION_STATUSES = [
  'PENDING',
  'RUNNING',
  'WAITING_EXTERNAL',
  'SUCCEEDED',
  'FAILED',
] as const;
export type ToolExecutionStatus = (typeof TOOL_EXECUTION_STATUSES)[number];

/** Estados terminales: la tool terminó y su resultado no se reescribe. */
export const TERMINAL_TOOL_EXECUTION_STATUSES = ['SUCCEEDED', 'FAILED'] as const;
export type TerminalToolExecutionStatus = (typeof TERMINAL_TOOL_EXECUTION_STATUSES)[number];

/**
 * Estados abiertos: una tool en uno de ellos tiene un reloj corriendo contra su
 * timeout_at. Si el proceso muere, el barrido durable usa esta lista para
 * cerrarlas en vez de esperar a que nadie las retome.
 */
export const OPEN_TOOL_EXECUTION_STATUSES = ['PENDING', 'RUNNING', 'WAITING_EXTERNAL'] as const;
export type OpenToolExecutionStatus = (typeof OPEN_TOOL_EXECUTION_STATUSES)[number];

export const TOOL_EXECUTION_TRANSITIONS: Record<ToolExecutionStatus, readonly ToolExecutionStatus[]> = {
  PENDING: ['RUNNING', 'SUCCEEDED', 'FAILED'],
  RUNNING: ['WAITING_EXTERNAL', 'SUCCEEDED', 'FAILED'],
  WAITING_EXTERNAL: ['RUNNING', 'SUCCEEDED', 'FAILED'],
  SUCCEEDED: [],
  FAILED: [],
};

const TERMINAL_TOOL_EXECUTION_STATUS_SET: ReadonlySet<string> = new Set(TERMINAL_TOOL_EXECUTION_STATUSES);
const OPEN_TOOL_EXECUTION_STATUS_SET: ReadonlySet<string> = new Set(OPEN_TOOL_EXECUTION_STATUSES);

export function isTerminalToolExecutionStatus(status: ToolExecutionStatus): status is TerminalToolExecutionStatus {
  return TERMINAL_TOOL_EXECUTION_STATUS_SET.has(status);
}

export function isOpenToolExecutionStatus(status: ToolExecutionStatus): status is OpenToolExecutionStatus {
  return OPEN_TOOL_EXECUTION_STATUS_SET.has(status);
}

export function canTransitionToolExecutionStatus(from: ToolExecutionStatus, to: ToolExecutionStatus): boolean {
  if (isTerminalToolExecutionStatus(from)) return false;
  return TOOL_EXECUTION_TRANSITIONS[from].includes(to);
}

/** Estados del caso (`audits.status`): el ciclo de vida que ve el usuario, más grueso que el run. */
export const AUDIT_STATUSES = ['DRAFT', 'PROCESSING', 'COMPLETED', 'NEEDS_INPUT', 'FAILED'] as const;
export type AuditStatus = (typeof AUDIT_STATUSES)[number];

export const TERMINAL_AUDIT_STATUSES = ['COMPLETED', 'NEEDS_INPUT', 'FAILED'] as const;
export type TerminalAuditStatus = (typeof TERMINAL_AUDIT_STATUSES)[number];

export const AUDIT_STATUS_TRANSITIONS: Record<AuditStatus, readonly AuditStatus[]> = {
  DRAFT: ['PROCESSING', 'FAILED'],
  PROCESSING: ['COMPLETED', 'NEEDS_INPUT', 'FAILED'],
  COMPLETED: [],
  NEEDS_INPUT: [],
  FAILED: [],
};

const TERMINAL_AUDIT_STATUS_SET: ReadonlySet<string> = new Set(TERMINAL_AUDIT_STATUSES);

export function isTerminalAuditStatus(status: AuditStatus): status is TerminalAuditStatus {
  return TERMINAL_AUDIT_STATUS_SET.has(status);
}

export function canTransitionAuditStatus(from: AuditStatus, to: AuditStatus): boolean {
  if (isTerminalAuditStatus(from)) return false;
  return AUDIT_STATUS_TRANSITIONS[from].includes(to);
}
