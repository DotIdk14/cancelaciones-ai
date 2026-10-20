import { describe, expect, it } from 'vitest';
import { capabilitiesForRole } from '../src/server/capabilities.js';
import { computeEvidenceFingerprint } from '../src/server/audit-fingerprint.js';
import { fakeAuthContext } from './helpers/auth.js';
import {
  changeAuditVersionStatus,
  createAuditVersion,
  createEvaluationDataset,
  createEvaluationRun,
  registerCurrentProductionVersion,
  reviewAuditFeedback,
} from '../src/server/continuous-improvement.js';

describe('capacidades de mejora continua', () => {
  it('agrega validación y laboratorio sin alterar las capacidades operativas actuales', () => {
    expect(capabilitiesForRole('user')).toMatchObject({
      canReadAllCases: true, canReviewOwnCases: true, canFinalizeAnyCase: false,
      canWriteOwnedCases: true, canManageCases: false, canImportCases: false,
      canValidateAuditFeedback: false, canManageAiLab: false,
    });
    expect(capabilitiesForRole('coordinator')).toMatchObject({
      canFinalizeAnyCase: true, canValidateAuditFeedback: true, canManageAiLab: false,
    });
    expect(capabilitiesForRole('manager')).toMatchObject({
      canManageCases: true, canValidateAuditFeedback: false, canManageAiLab: true,
    });
  });

  it('falla cerrado para un rol desconocido', () => {
    expect(capabilitiesForRole('auditor' as never)).toMatchObject({
      canValidateAuditFeedback: false, canManageAiLab: false,
    });
  });

  it('separa la caché por snapshot de versión y conserva el hash previo por omisión', () => {
    const evidence = [{ id: 'evidence-1', hash: 'sha256-original', transcript_json: null }] as never;
    const original = computeEvidenceFingerprint(evidence);
    expect(computeEvidenceFingerprint(evidence, null, [], undefined)).toBe(original);
    expect(computeEvidenceFingerprint(evidence, null, [], undefined, 'snapshot-a')).not.toBe(original);
    expect(computeEvidenceFingerprint(evidence, null, [], undefined, 'snapshot-a')).not.toBe(
      computeEvidenceFingerprint(evidence, null, [], undefined, 'snapshot-b'),
    );
  });

  it('hace cumplir permisos nuevos en el backend antes de consultar o escribir', async () => {
    const untouchedClient = {} as never;
    const cases = [
      () => registerCurrentProductionVersion(untouchedClient, fakeAuthContext('user')),
      () => createAuditVersion(untouchedClient, fakeAuthContext('coordinator'), { versionKey: 'v-test', name: 'Test', description: '', instructions: 'x', model: 'x/y', config: {} }),
      () => changeAuditVersionStatus(untouchedClient, fakeAuthContext('coordinator'), 'id', 'ACTIVE'),
      () => createEvaluationDataset(untouchedClient, fakeAuthContext('coordinator'), { name: 'set', description: '', split: 'HELD_OUT', exampleIds: ['id'] }),
      () => createEvaluationRun(untouchedClient, fakeAuthContext('coordinator'), { datasetId: 'id', versionIds: ['a', 'b'], budgetLimit: 1, idempotencyKey: 'test' }),
      () => reviewAuditFeedback(untouchedClient, fakeAuthContext('manager'), { feedbackId: 'id', status: 'REJECTED', note: '', checks: { finalResolution: false, procedureSection: false, evidenceReferences: false, factsSupported: false, priorityRuleChecked: false } }),
    ];
    for (const operation of cases) await expect(operation()).rejects.toMatchObject({ status: 403 });
  });
});
