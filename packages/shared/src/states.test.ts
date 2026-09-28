import { describe, expect, it } from 'vitest';
import {
  AUDIT_RUN_STATUSES,
  AUDIT_RUN_TRANSITIONS,
  canTransitionAuditRunStatus,
  isTerminalAuditRunStatus,
  OPEN_TOOL_EXECUTION_STATUSES,
  TERMINAL_AUDIT_RUN_STATUSES,
  TERMINAL_TOOL_EXECUTION_STATUSES,
  TOOL_EXECUTION_STATUSES,
  TOOL_EXECUTION_TRANSITIONS,
  isTerminalToolExecutionStatus,
  type AuditRunStatus,
} from './states';

describe('estados del audit run', () => {
  it('no deja salir de los estados terminales', () => {
    for (const status of TERMINAL_AUDIT_RUN_STATUSES) {
      expect(AUDIT_RUN_TRANSITIONS[status]).toEqual([]);
      for (const destino of AUDIT_RUN_STATUSES) {
        expect(canTransitionAuditRunStatus(status, destino)).toBe(false);
      }
    }
  });

  it('clasifica como terminal exactamente a los tres estados terminales', () => {
    for (const status of AUDIT_RUN_STATUSES) {
      const esperadoTerminal = (TERMINAL_AUDIT_RUN_STATUSES as readonly string[]).includes(status);
      expect(isTerminalAuditRunStatus(status), `estado ${status}`).toBe(esperadoTerminal);
    }
    expect(AUDIT_RUN_STATUSES).toHaveLength(7);
  });

  it('permite desde ANALYZING una transición legal a cada terminal', () => {
    for (const terminal of TERMINAL_AUDIT_RUN_STATUSES) {
      expect(canTransitionAuditRunStatus('ANALYZING', terminal)).toBe(true);
    }
  });

  it('rechaza volver de REVIEWING a PROCESSING_EVIDENCE', () => {
    expect(canTransitionAuditRunStatus('REVIEWING', 'PROCESSING_EVIDENCE')).toBe(false);
    expect(AUDIT_RUN_TRANSITIONS.REVIEWING).not.toContain('PROCESSING_EVIDENCE');
  });

  it('encadena el camino feliz completo sin saltos', () => {
    const camino: AuditRunStatus[] = ['CREATED', 'PROCESSING_EVIDENCE', 'ANALYZING', 'REVIEWING', 'COMPLETED'];
    for (let i = 0; i < camino.length - 1; i += 1) {
      expect(canTransitionAuditRunStatus(camino[i], camino[i + 1])).toBe(true);
    }
  });
});

describe('estados de la ejecución de tools', () => {
  it('trata SUCCEEDED y FAILED como terminales sin salida', () => {
    for (const status of TERMINAL_TOOL_EXECUTION_STATUSES) {
      expect(TOOL_EXECUTION_TRANSITIONS[status]).toEqual([]);
      expect(isTerminalToolExecutionStatus(status)).toBe(true);
    }
    for (const status of TOOL_EXECUTION_STATUSES) {
      const esperadoTerminal = (TERMINAL_TOOL_EXECUTION_STATUSES as readonly string[]).includes(status);
      expect(isTerminalToolExecutionStatus(status), `estado ${status}`).toBe(esperadoTerminal);
    }
  });

  it('permite que una tool en WAITING_EXTERNAL termine en FAILED', () => {
    expect(OPEN_TOOL_EXECUTION_STATUSES).toContain('WAITING_EXTERNAL');
    expect(TOOL_EXECUTION_TRANSITIONS.WAITING_EXTERNAL).toContain('FAILED');
  });
});
