import { describe, expect, it } from 'vitest';
import {
  assertMachineUnchanged,
  buildDictamenText,
  buildHumanReview,
  buildReportSnapshot,
  buildRuleTraceRef,
  computeDocumentFingerprint,
  computeSnapshotFingerprint,
  freezeMachineDecision,
  isHumanApproval,
  mapDictamenFields,
  mapManualCommentsForPdf,
  sha256Hex,
  sha256HexBytes,
  validateEvidenceSelection,
} from './index';

const machine = {
  engineRunId: 'erun_1',
  factRunId: 'frun_1',
  machineOutcome: 'CANCELACION_DE_VENTA',
  machineReason: 'Regla 5.1 aplica: solicitud antes de inicio y sin servicio devengado.',
  machineDecisionStatus: 'DECIDED',
  factsFingerprint: 'facts-fp-1',
  rulesFingerprint: 'rules-fp-1',
};

const comments = {
  backOfficeComment: 'Alumno solicito cancelacion por telefono.',
  helpdeskComment: 'Ticket abierto por HelpDesk.',
  schoolServicesComment: 'SER valido la matricula.',
  financeComment: 'Sin pagos registrados.',
  additionalComment: 'Comentario adicional del auditor.',
};

describe('hashes', () => {
  it('sha256Hex es determinista', () => {
    expect(sha256Hex('abc')).toBe(sha256Hex('abc'));
    expect(sha256Hex('abc')).toMatch(/^[0-9a-f]{64}$/);
  });
  it('sha256HexBytes hashea bytes', () => {
    const hash = sha256HexBytes(new TextEncoder().encode('abc'));
    expect(hash).toBe(sha256Hex('abc'));
  });
});

describe('freezeMachineDecision (inmutabilidad de la decision de maquina)', () => {
  it('extrae solo campos inmutables', () => {
    const frozen = freezeMachineDecision(machine);
    expect(frozen.engineRunId).toBe('erun_1');
    expect(frozen.machineOutcome).toBe('CANCELACION_DE_VENTA');
    expect(frozen.machineDecisionStatus).toBe('DECIDED');
  });
  it('exige engineRunId', () => {
    expect(() => freezeMachineDecision({ engineRunId: '' })).toThrow(/engineRunId/);
  });
  it('assertMachineUnchanged rechaza cambios', () => {
    const frozen = freezeMachineDecision(machine);
    expect(assertMachineUnchanged(frozen, freezeMachineDecision(machine))).toBe(true);
    expect(assertMachineUnchanged(frozen, freezeMachineDecision({ ...machine, machineOutcome: 'RETENCION' }))).toBe(false);
  });
});

describe('buildHumanReview (revision humana separada)', () => {
  it('APPROVE confirma el resultado sugerido y preserva la maquina', () => {
    const result = buildHumanReview({
      decisionType: 'APPROVE',
      machineOutcome: machine.machineOutcome,
      reviewedBy: 'user_1',
      reviewedAt: '2026-09-23T10:00:00.000Z',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.humanOutcome).toBe('CANCELACION_DE_VENTA');
    expect(result.decision.decisionType).toBe('APPROVE');
    expect(isHumanApproval(result.decision)).toBe(true);
  });
  it('CORRECT exige humanOutcome y humanReason', () => {
    const missing = buildHumanReview({ decisionType: 'CORRECT', reviewedBy: 'user_1' });
    expect(missing.ok).toBe(false);
    if (missing.ok) return;
    expect(missing.code).toBe('MISSING_HUMAN_OUTCOME');

    const noReason = buildHumanReview({ decisionType: 'CORRECT', humanOutcome: 'RETENCION', reviewedBy: 'user_1' });
    expect(noReason.ok).toBe(false);
    if (!noReason.ok) expect(noReason.code).toBe('MISSING_HUMAN_REASON');
  });
  it('CORRECT valido persiste outcome, causa y razon', () => {
    const result = buildHumanReview({
      decisionType: 'CORRECT',
      humanOutcome: 'RETENCION',
      humanCause: 'Gestion de retencion efectiva antes del cierre',
      humanReason: 'Evidencia de gestion 5.3.b confirma retencion.',
      reviewedBy: 'user_1',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.decision.humanOutcome).toBe('RETENCION');
    expect(result.decision.humanCause).toBe('Gestion de retencion efectiva antes del cierre');
    expect(result.decision.humanReason).toBe('Evidencia de gestion 5.3.b confirma retencion.');
    expect(isHumanApproval(result.decision)).toBe(false);
  });
  it('valida decisionType y reviewedBy', () => {
    const badType = buildHumanReview({ decisionType: 'X' as never, reviewedBy: 'u' });
    expect(badType.ok).toBe(false);
    const noUser = buildHumanReview({ decisionType: 'APPROVE', reviewedBy: '' });
    expect(noUser.ok).toBe(false);
  });
});

describe('mapManualCommentsForPdf (comentarios de areas al Dictamen)', () => {
  it('mapea los 4 campos de area', () => {
    const mapped = mapManualCommentsForPdf(comments, false);
    expect(mapped).toHaveLength(4);
    expect(mapped[0]).toMatchObject({ id: 'back_office', value: 'Alumno solicito cancelacion por telefono.' });
    expect(mapped[1].id).toBe('helpdesk');
    expect(mapped[2].id).toBe('school_services');
    expect(mapped[3].id).toBe('finance');
  });
  it('additional_comment NUNCA se inserta automaticamente', () => {
    const mapped = mapManualCommentsForPdf(comments, false);
    expect(mapped.some((m) => m.id === 'additional')).toBe(false);
  });
  it('additional_comment solo aparece si includeAdditional es true', () => {
    const mapped = mapManualCommentsForPdf(comments, true);
    expect(mapped).toHaveLength(5);
    expect(mapped[4].id).toBe('additional');
    expect(mapped[4].value).toBe('Comentario adicional del auditor.');
  });
  it('ignora valores vacios o no string', () => {
    const mapped = mapManualCommentsForPdf({ backOfficeComment: '   ', helpdeskComment: null }, false);
    expect(mapped[0].value).toBeNull();
    expect(mapped[1].value).toBeNull();
  });
});

describe('validateEvidenceSelection (seleccion con trazabilidad)', () => {
  it('acepta evidencia de la misma auditoria', () => {
    const result = validateEvidenceSelection({ evidenceId: 'ev_1' }, new Set(['ev_1']));
    expect(result.ok).toBe(true);
  });
  it('rechaza evidencia de otra auditoria (cross-audit)', () => {
    const result = validateEvidenceSelection({ evidenceId: 'ev_other' }, new Set(['ev_1']));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('EVIDENCE_NOT_IN_AUDIT');
  });
  it('exige evidenceId', () => {
    const result = validateEvidenceSelection({ evidenceId: '' }, new Set());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('MISSING_EVIDENCE_ID');
  });
});

describe('buildRuleTraceRef', () => {
  it('normaliza rastro y descarta refs sin evidenceId', () => {
    const ref = buildRuleTraceRef({
      ruleIds: ['5.1', '5.3'],
      factIds: ['f1'],
      evidenceRefs: [{ evidenceId: 'ev_1', sha256: 'aa' }, { artifactId: 'x' }],
      suggestedOutcome: 'CANCELACION_DE_VENTA',
      decisionStatus: 'DECIDED',
    });
    expect(ref.ruleIds).toEqual(['5.1', '5.3']);
    expect(ref.evidenceRefs).toEqual([{ evidenceId: 'ev_1', artifactId: null, sha256: 'aa' }]);
  });
});

describe('report snapshot y fingerprints', () => {
  const baseSnapshot = {
    auditId: 'audit_1',
    factRunId: 'frun_1',
    engineRunId: 'erun_1',
    policyCode: 'GDM_GAM_PRD_MLG_003',
    policyVersion: '2026.1',
    machine: freezeMachineDecision(machine),
    human: null,
    manualComments: { ...comments },
    selectedEvidence: [{ evidenceId: 'ev_1', page: 1, selectedAt: '2026-09-23T10:00:00.000Z' }],
    templateHash: 'tpl-hash-1',
    ruleTrace: buildRuleTraceRef({ ruleIds: ['5.1'] }),
  };

  it('buildReportSnapshot valida campos obligatorios', () => {
    expect(buildReportSnapshot({ ...baseSnapshot, engineRunId: '' }).ok).toBe(false);
    expect(buildReportSnapshot({ ...baseSnapshot, policyCode: '' }).ok).toBe(false);
    expect(buildReportSnapshot({ ...baseSnapshot, templateHash: '' }).ok).toBe(false);
    const okResult = buildReportSnapshot(baseSnapshot);
    expect(okResult.ok).toBe(true);
  });

  it('fingerprint es determinista y excluye timestamps de persistencia', () => {
    const a = computeSnapshotFingerprint(baseSnapshot);
    const b = computeSnapshotFingerprint({
      ...baseSnapshot,
      selectedEvidence: [{ evidenceId: 'ev_1', page: 1, selectedAt: '2026-09-23T11:00:00.000Z' }],
    });
    expect(a).toBe(b);
  });

  it('fingerprint cambia si cambia el contenido (decision humana, evidencia, comentarios)', () => {
    const original = computeSnapshotFingerprint(baseSnapshot);
    expect(computeSnapshotFingerprint({ ...baseSnapshot, human: null })).toBe(original);
    const withHuman = buildHumanReview({
      decisionType: 'APPROVE',
      machineOutcome: machine.machineOutcome,
      reviewedBy: 'user_1',
    });
    if (!withHuman.ok) throw new Error('review should be ok');
    expect(computeSnapshotFingerprint({ ...baseSnapshot, human: withHuman.decision })).not.toBe(original);
    expect(computeSnapshotFingerprint({ ...baseSnapshot, selectedEvidence: [{ evidenceId: 'ev_2' }] })).not.toBe(original);
    expect(computeSnapshotFingerprint({ ...baseSnapshot, manualComments: { ...comments, backOfficeComment: 'otro' } })).not.toBe(original);
  });

  it('computeDocumentFingerprint: mismo snapshot aprobado -> mismo final', () => {
    const f1 = computeDocumentFingerprint({
      auditId: 'audit_1',
      kind: 'FINAL',
      snapshotFingerprint: 'snap-fp',
      templateHash: 'tpl',
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '2026.1',
    });
    const f2 = computeDocumentFingerprint({
      auditId: 'audit_1',
      kind: 'FINAL',
      snapshotFingerprint: 'snap-fp',
      templateHash: 'tpl',
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '2026.1',
    });
    expect(f1).toBe(f2);
  });
});

describe('buildDictamenText', () => {
  it('sin revision humana queda pendiente', () => {
    expect(buildDictamenText({ machineOutcome: 'CANCELACION_DE_VENTA' })).toContain('Pendiente de revisión humana.');
  });
  it('APPROVE confirma', () => {
    const review = buildHumanReview({ decisionType: 'APPROVE', machineOutcome: 'CANCELACION_DE_VENTA', reviewedBy: 'u' });
    if (!review.ok) throw new Error('ok');
    const text = buildDictamenText({ machineOutcome: 'CANCELACION_DE_VENTA', humanDecision: review.decision });
    expect(text).toContain('Se confirma el resultado sugerido: CANCELACION_DE_VENTA');
  });
  it('CORRECT muestra el cambio y el motivo', () => {
    const review = buildHumanReview({
      decisionType: 'CORRECT',
      humanOutcome: 'RETENCION',
      humanReason: 'Evidencia de gestion.',
      reviewedBy: 'u',
    });
    if (!review.ok) throw new Error('ok');
    const text = buildDictamenText({ machineOutcome: 'CANCELACION_DE_VENTA', humanDecision: review.decision });
    expect(text).toContain('CANCELACION_DE_VENTA -> RETENCION');
    expect(text).toContain('Motivo: Evidencia de gestion.');
  });
});

describe('mapDictamenFields (campos del Dictamen)', () => {
  it('mapea campos conocidos sin inventar ausentes', () => {
    const entries = mapDictamenFields({
      facts: [
        { factType: 'student.identity.name', value: 'Alumno Sintetico' },
        { factType: 'student.identity.enrollmentId', value: 'MAT-001' },
        { factType: 'student.email', value: 'alumno@example.com' },
        { factType: 'student.program', value: 'Ingenieria' },
        { factType: 'student.phone', value: '+52 55 0000 0000' },
      ],
      policyCode: 'GDM_GAM_PRD_MLG_003',
      policyVersion: '2026.1',
      machineOutcome: 'CANCELACION_DE_VENTA',
    });
    const byId = new Map(entries.map((e) => [e.id, e.value]));
    expect(byId.get('nombre')).toBe('Alumno Sintetico');
    expect(byId.get('matricula')).toBe('MAT-001');
    expect(byId.get('correo')).toBe('alumno@example.com');
    expect(byId.get('politicaAplica')).toBe('GDM_GAM_PRD_MLG_003 V2026.1');
    expect(byId.get('dictamen')).toContain('Pendiente de revisión humana.');
    expect(byId.has('primerPago')).toBe(false);
    expect(byId.has('asignadoADictaminar')).toBe(false);
  });

  it('mapea comentarios de areas a los campos del Dictamen', () => {
    const entries = mapDictamenFields({
      comments: mapManualCommentsForPdf(comments, false),
    });
    const byId = new Map(entries.map((e) => [e.id, e.value]));
    expect(byId.get('descripcionBackOffice')).toBe(comments.backOfficeComment);
    expect(byId.get('descripcionHelpDesk')).toBe(comments.helpdeskComment);
    expect(byId.get('descripcionSER')).toBe(comments.schoolServicesComment);
    expect(byId.get('descripcionFinanzas')).toBe(comments.financeComment);
    expect(byId.size).toBe(5);
    expect(byId.get('dictamen')).toContain('Pendiente de revisión humana.');
  });
});