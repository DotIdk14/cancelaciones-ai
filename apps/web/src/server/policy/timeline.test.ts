import { describe, expect, it } from 'vitest';
import type { AuditManualComments, HumanDecisionExtract, StoredFact } from '@cancelaciones/db';
import { buildCaseTimeline } from './timeline';

function storedFact(overrides: Partial<StoredFact>): StoredFact {
  return {
    id: 'fact-x', auditId: 'audit-t', runId: 'run-1',
    factType: 'student.level', classification: 'OBSERVABLE', value: 'Estudiante',
    sourceRef: { evidenceId: 'evidence-1' }, confidence: 0.9, createdAt: '2026-09-24T00:00:00Z',
    ...overrides,
  };
}

const comments: AuditManualComments = {
  id: 'comments-1', auditId: 'audit-t',
  backOfficeComment: 'se rechaza la solicitud por documentacion incompleta',
  helpdeskComment: null, schoolServicesComment: null, financeComment: null, additionalComment: null,
  createdAt: '2026-09-01T10:00:00Z', updatedAt: '2026-09-01T10:00:00Z', updatedBy: null,
};

const human: HumanDecisionExtract = {
  id: 'extract-1', auditId: 'audit-t', runId: 'run-h', evidenceId: null,
  extractorVersion: 'human-decision-v1', resolution: 'CANCELACION VENTA POR ESTUDIANTE ILOCALIZABLE',
  decisionDate: '2026-09-20T12:00:00Z', motives: ['estudiante ilocalizable'], conditionsConsidered: [],
  datesConsidered: [], facts: [], evidenceMentioned: [], rulesMentioned: [], observations: [],
  areasInvolved: [], externalInformation: [], provider: null, model: null, promptVersion: null,
  rawTextHash: null, createdBy: 'human-1', createdAt: '2026-09-20T12:05:00Z',
};

describe('timeline del caso (capa temporal)', () => {
  it('ordena cronologicamente ticket > comentarios > intentos de contacto > dictamen', () => {
    const facts = [
      storedFact({
        id: 'f-calls', factType: 'contact.callAttempts',
        value: { events: [{ id: 'call-1', kind: 'CALL', occurredAt: '2026-09-10T14:13:00', status: 'Finalizado' }], observedCount: 1, sourceCompleteness: 'COMPLETE' },
      }),
    ];
    const timeline = buildCaseTimeline({ auditId: 'audit-t', storedFacts: facts, manualComments: comments, humanDecisionExtract: human });
    expect(timeline.events.length).toBeGreaterThanOrEqual(3);
    const kinds = timeline.events.map((event) => event.kind);
    // El comentario temprano NO es resolución final.
    expect(timeline.finalResolution?.kind).toBe('DICTAMEN');
    expect(timeline.finalResolution?.occurredAt).toBe('2026-09-20T12:00:00Z');
    const order = timeline.events.map((event) => event.occurredAt);
    expect([...order].sort()).toEqual(order);
    expect(kinds).toContain('COMMENT');
    expect(kinds).toContain('CONTACT_ATTEMPT');
    expect(kinds).toContain('DICTAMEN');
  });

  it('advierte si hay comentarios de rechazo previos sin dictamen final', () => {
    const timeline = buildCaseTimeline({ auditId: 'audit-t', storedFacts: [], manualComments: comments, humanDecisionExtract: null });
    expect(timeline.finalResolution).toBeNull();
    expect(timeline.warnings.some((w) => /rechazo/.test(w))).toBe(true);
  });

  it('no trata comentarios tempranos como resolucion final', () => {
    const timeline = buildCaseTimeline({ auditId: 'audit-t', storedFacts: [], manualComments: comments, humanDecisionExtract: null });
    const rejection = timeline.events.find((event) => event.kind === 'COMMENT' && /rechaz/i.test(event.detail));
    expect(rejection?.isFinalResolution ?? false).toBe(false);
  });
});