import { describe, expect, it } from 'vitest';
import { stableFingerprint } from '@cancelaciones/domain';
import { evaluatePolicy } from '@cancelaciones/policy-engine';
import type { StoredFact } from '@cancelaciones/db';
import { buildEvidenceGraph, graphStats, graphToPolicyFacts } from './evidence-graph';

function storedFact(overrides: Partial<StoredFact>): StoredFact {
  return {
    id: 'fact-x', auditId: 'audit-48680', runId: 'run-1',
    factType: 'student.level', classification: 'OBSERVABLE', value: 'Estudiante',
    sourceRef: { evidenceId: 'evidence-1' }, confidence: 0.8, createdAt: '2026-09-24T00:00:00Z',
    ...overrides,
  };
}

/** Réplica de los hechos reales de la auditoría 48680 (migración finish-audit-48680). */
const facts48680: StoredFact[] = [
  storedFact({ id: 'f1', factType: 'classroom.hasActivities', value: true, sourceRef: { evidenceId: '6cc376b7' }, confidence: 0.8 }),
  storedFact({ id: 'f2', factType: 'classroom.hasActivities', value: false, sourceRef: { evidenceId: 'b42eaa86' }, confidence: 0.8 }),
  storedFact({ id: 'f3', factType: 'contact.effectiveContact', value: { email: 'a@b.com', phoneNumbers: [{ type: 'cellular', number: '+521234' }] }, sourceRef: { evidenceId: '51058508' }, confidence: 1 }),
  storedFact({ id: 'f4', factType: 'contact.callAttempts', value: { events: [{ id: 'a1', kind: 'CALL', occurredAt: '2026-09-10T14:13:00', status: 'Finalizado' }], observedCount: 45, sourceCompleteness: 'PARTIAL' }, sourceRef: { evidenceId: 'e146c17a' }, confidence: 0.85 }),
  storedFact({ id: 'f5', factType: 'contact.writtenInteractions', value: { events: [{ id: 'w1', kind: 'WHATSAPP', occurredAt: '2026-09-09T15:41:00', status: 'Finalizado' }], observedCount: 32, sourceCompleteness: 'PARTIAL' }, sourceRef: { evidenceId: 'b42eaa86' }, confidence: 0.85 }),
  storedFact({ id: 'f6', factType: 'student.level', value: 'Estudiante', sourceRef: { evidenceId: 'dfeee33b' }, confidence: 0.9 }),
];

describe('evidence graph (A1)', () => {
  it('detecta la contradiccion real de classroom.hasActivities de la auditoria 48680', () => {
    const graph = buildEvidenceGraph({ auditId: 'audit-48680', runId: 'run-1', storedFacts: facts48680 });
    const conflict = graph.conflicts.find((c) => c.factType === 'classroom.hasActivities');
    expect(conflict).toBeDefined();
    expect(conflict?.entries.map((e) => e.evidenceId).sort()).toEqual(['6cc376b7', 'b42eaa86']);
    expect(graph.notes.some((n) => n.factType === 'classroom.hasActivities' && /resuelta/.test(n.note))).toBe(true);
  });

  it('normaliza contact.effectiveContact recibido como datos de contacto (forma degenerada 48680)', () => {
    const graph = buildEvidenceGraph({ auditId: 'audit-48680', runId: 'run-1', storedFacts: facts48680 });
    expect(graph.resolvedFacts.some((f) => f.factType === 'contact.effectiveContact')).toBe(false);
    expect(graph.notes.some((n) => n.factType === 'contact.effectiveContact' && /efectividad NO confirmada/.test(n.note))).toBe(true);
  });

  it('conserva los conteos observados de contacto aunque la fuente sea PARTIAL', () => {
    const graph = buildEvidenceGraph({ auditId: 'audit-48680', runId: 'run-1', storedFacts: facts48680 });
    const calls = graph.resolvedFacts.find((f) => f.factType === 'contact.callAttempts')?.value as { observedCount: number; sourceCompleteness: string };
    expect(calls.observedCount).toBe(45);
    expect(calls.sourceCompleteness).toBe('PARTIAL');
  });

  it('produce hechos resueltos deterministas: mismo input -> mismo fingerprint', () => {
    const a = buildEvidenceGraph({ auditId: 'audit-48680', runId: 'run-1', storedFacts: facts48680 });
    const b = buildEvidenceGraph({ auditId: 'audit-48680', runId: 'run-1', storedFacts: facts48680 });
    expect(stableFingerprint(graphToPolicyFacts(a))).toBe(stableFingerprint(graphToPolicyFacts(b)));
  });

  it('reporta hechos faltantes del inventario (classroom.hasGrades) sin bloqueo mudo', () => {
    const graph = buildEvidenceGraph({ auditId: 'audit-48680', runId: 'run-1', storedFacts: facts48680 });
    expect(graph.missingFacts).toContain('classroom.hasGrades');
    expect(graphStats(graph).conflicts).toBe(1);
    expect(graphStats(graph).factConfidenceAvg).toBeGreaterThan(0.8);
  });

  it('la evaluacion sobre hechos resueltos del grafo conserva softwareCoverageGaps visibles', () => {
    const graph = buildEvidenceGraph({ auditId: 'audit-48680', runId: 'run-1', storedFacts: facts48680 });
    const evaluation = evaluatePolicy({ policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5', facts: graphToPolicyFacts(graph) });
    expect(evaluation.softwareCoverageGaps.some((gap) => gap.includes('5.3'))).toBe(true);
    expect(evaluation.factsFingerprint).toBeTruthy();
  });
});