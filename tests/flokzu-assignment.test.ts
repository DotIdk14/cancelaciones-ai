import { describe, expect, it } from 'vitest';
import { distributeFlokzuAssignments } from '../src/server/flokzu-import.js';

describe('distribución Flokzu', () => {
  it('reparte tickets de revisión entre usuarios según la carga y omite otras etapas', () => {
    const rows = [
      { externalCaseId: 'CaVe-1', eligibleForAuditAssignment: true },
      { externalCaseId: 'CaVe-2', eligibleForAuditAssignment: true },
      { externalCaseId: 'CaVe-3', eligibleForAuditAssignment: false },
      { externalCaseId: 'CaVe-4', eligibleForAuditAssignment: true },
      { externalCaseId: 'CaVe-5', eligibleForAuditAssignment: true },
      { externalCaseId: 'CaVe-6', eligibleForAuditAssignment: true },
    ];
    const assignments = distributeFlokzuAssignments(rows, ['advisor-a', 'advisor-b', 'advisor-c'], new Map([['advisor-a', 4], ['advisor-b', 4], ['advisor-c', 5]]));
    expect(assignments.has('CaVe-3')).toBe(false);
    expect([...assignments.values()].filter((user) => user === 'advisor-a')).toHaveLength(2);
    expect([...assignments.values()].filter((user) => user === 'advisor-b')).toHaveLength(2);
    expect([...assignments.values()].filter((user) => user === 'advisor-c')).toHaveLength(1);
  });

  it('deja los tickets sin asignación cuando no hay usuarios elegibles', () => {
    const rows = [{ externalCaseId: 'CaVe-1', eligibleForAuditAssignment: true }];
    expect(distributeFlokzuAssignments(rows, [], new Map())).toEqual(new Map());
  });
});
