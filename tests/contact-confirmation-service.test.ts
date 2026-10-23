import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runAudit, healStaleAudit } from '../src/server/audit-service';
import { computeEvidenceFingerprint, fingerprintWithContactContext } from '../src/server/audit-fingerprint';
import { auditSkill } from '../src/skills/audit/execute';
import { setTestEnv } from './helpers/env';
import { fakeClient, getAuditById, latestAudit, resetStore, seedAudit, seedCase, seedEvidence } from './helpers/fake-store';
import { validAuditResult } from './fixtures/audit-result';
import * as aiProvider from '../src/server/ai/provider';
import { checkPaidQuota } from '../src/server/quotas';
import { ApiError } from '../src/server/errors';
import { listAudits } from './helpers/fake-store';
import { resetEnvCache } from '../src/server/env';

vi.mock('../src/server/cases', async () => import('./helpers/fake-store'));
vi.mock('../src/server/area-comments', () => ({ listAreaComments: async () => [] }));
vi.mock('../src/server/quotas', () => ({ checkPaidQuota: vi.fn() }));
vi.mock('../src/server/student-history', () => ({ assertNoRedundantAudit: vi.fn() }));
vi.mock('../src/server/audit-versions', async (original) => ({
  ...await original<typeof import('../src/server/audit-versions')>(),
  getActiveAuditVersion: async () => null,
}));
vi.mock('../src/skills/audit/execute', () => ({
  PDF_MIN_TEXT_CHARS: 80,
  auditSkill: { executeWithMetadata: vi.fn() },
}));

const provider = vi.mocked(auditSkill.executeWithMetadata);
afterEach(() => vi.restoreAllMocks());
let base: string;
beforeEach(() => {
  vi.clearAllMocks();
  setTestEnv();
  resetStore();
  seedCase({ id: 'case-1' });
  const evidence = seedEvidence({ id: 'ev-1', case_id: 'case-1', mime_type: 'audio/mpeg', processing_status: 'READY', transcript_json: { transcript: 'Solicitud del estudiante.', durationSeconds: 4, speakers: [] } });
  base = computeEvidenceFingerprint([evidence]);
  seedAudit({ id: 'previous-audit', case_id: 'case-1', status: 'ERROR', evidence_fingerprint: base, error_category: 'SCHEMA_VALIDATION_ERROR', provider_metadata: {
    openrouterAttempts: [{ model: 'test', format: 'json_schema', failureCategory: 'SCHEMA_VALIDATION_ERROR', detail: '5.2 observedValues exactos' }],
  } });
  provider.mockResolvedValue({ result: structuredClone(validAuditResult), model: 'test', usage: validAuditResult.usage, attempts: [] });
});

describe('continuación durable después de confirmar contacto', () => {
  it('rechaza un proveedor incompatible antes de consumir cuota o crear otra auditoría', async () => {
    const before = listAudits().length;
    vi.spyOn(aiProvider, 'preflightAiProvider').mockRejectedValueOnce(new ApiError(502, 'UNSUPPORTED_MODEL_CAPABILITY', 'Doce adjuntos exceden el límite del proveedor.'));
    await expect(runAudit(fakeClient, 'case-1', { userId: 'actor-server',
      contactAnswer: { auditId: 'previous-audit', performed: true } })).rejects.toMatchObject({ category: 'UNSUPPORTED_MODEL_CAPABILITY' });
    expect(listAudits()).toHaveLength(before); expect(checkPaidQuota).not.toHaveBeenCalled(); expect(provider).not.toHaveBeenCalled();
  });

  it('persiste el proveedor real antes de inferir y lo mantiene durante el Skill', async () => {
    vi.stubEnv('COPILOT_MODEL', 'synthetic-vision'); resetEnvCache();
    const manifest = { format: 'lossless-image-pdf-v1' as const, sha256: 'synthetic-container-hash', sizeBytes: 100, pages: [] };
    vi.spyOn(aiProvider, 'preflightAiProvider').mockResolvedValueOnce({ provider: 'github-copilot',
      bundle: { sources: [], manifest, part: { type: 'file', file: { filename: 'evidencias-visuales.pdf', file_data: 'data:application/pdf;base64,cGRm' } } } });
    provider.mockImplementationOnce(async () => {
      expect(await aiProvider.selectAiProvider()).toBe('github-copilot');
      expect(await latestAudit(fakeClient, 'case-1')).toMatchObject({ provider: 'github-copilot', model: 'synthetic-vision', status: 'RUNNING', provider_metadata: { evidenceTransport: manifest } });
      return { result: { ...structuredClone(validAuditResult), model: { ...validAuditResult.model, provider: 'github-copilot' as const } }, model: 'synthetic-vision', usage: validAuditResult.usage, attempts: [] };
    });
    await runAudit(fakeClient, 'case-1', { userId: 'actor-server', contactAnswer: { auditId: 'previous-audit', performed: true } });
    expect(await latestAudit(fakeClient, 'case-1')).toMatchObject({ provider: 'github-copilot', status: 'COMPLETED', provider_metadata: { evidenceTransport: manifest } });
  });
  it('persiste el cambio por creditos antes de Copilot y corrige solo metadata tecnica al finalizar', async () => {
    vi.stubEnv('AI_PROVIDER_MODE', 'auto'); vi.stubEnv('COPILOT_MODEL', 'copilot-proposal'); resetEnvCache();
    vi.spyOn(aiProvider, 'prepareCopilotProvider').mockResolvedValueOnce({ provider: 'github-copilot' });
    provider.mockImplementationOnce(async () => {
      expect(await aiProvider.selectAiProvider()).toBe('openrouter');
      await aiProvider.activateCreditFallback(Date.now() + 10000);
      expect(await latestAudit(fakeClient, 'case-1')).toMatchObject({ status: 'RUNNING', provider: 'github-copilot',
        provider_metadata: { creditFallback: { from: 'openrouter', to: 'github-copilot', reason: 'PAYMENT_REQUIRED' } } });
      return { result: structuredClone(validAuditResult), model: 'copilot-review', usage: validAuditResult.usage, attempts: [] };
    });
    await runAudit(fakeClient, 'case-1', { userId: 'actor-server', contactAnswer: { auditId: 'previous-audit', performed: true } });
    const audit = await latestAudit(fakeClient, 'case-1');
    expect(audit).toMatchObject({ status: 'COMPLETED', provider: 'github-copilot', model: 'copilot-review',
      result_json: { model: { provider: 'github-copilot' } }, provider_metadata: { creditFallback: { reason: 'PAYMENT_REQUIRED' } } });
    expect(checkPaidQuota).toHaveBeenCalledOnce(); expect(provider).toHaveBeenCalledOnce();
  });
  it('Sí persiste actor y fecha antes del proveedor, cambia la huella y reutiliza el dictamen posterior', async () => {
    provider.mockImplementationOnce(async (input) => {
      const running = await latestAudit(fakeClient, 'case-1');
      expect(running?.status).toBe('RUNNING');
      expect(running?.provider_metadata).toMatchObject({ contactConfirmation: { actorId: 'actor-server', performed: true, sourceAuditId: 'previous-audit', evidenceFingerprint: base } });
      expect(input.humanContactPerformed).toBe(true);
      return { result: structuredClone(validAuditResult), model: 'test', usage: validAuditResult.usage, attempts: [] };
    });
    const result = await runAudit(fakeClient, 'case-1', { userId: 'actor-server', contactAnswer: { auditId: 'previous-audit', performed: true } });
    expect(result.phase).toBe('done');
    const completed = await latestAudit(fakeClient, 'case-1');
    expect(completed?.status).toBe('COMPLETED');
    expect(completed?.evidence_fingerprint).toBe(fingerprintWithContactContext(base, completed?.provider_metadata));
    expect(completed?.evidence_fingerprint).not.toBe(base);
    expect((await getAuditById(fakeClient, 'previous-audit'))?.status).toBe('ERROR');
    await runAudit(fakeClient, 'case-1', { userId: 'actor-server' });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it('No guarda la respuesta, no crea otro intento y no llama a IA', async () => {
    await runAudit(fakeClient, 'case-1', { userId: 'actor-server', contactAnswer: { auditId: 'previous-audit', performed: false } });
    expect((await latestAudit(fakeClient, 'case-1'))?.id).toBe('previous-audit');
    expect((await latestAudit(fakeClient, 'case-1'))?.provider_metadata).toMatchObject({ contactConfirmation: { performed: false, actorId: 'actor-server' } });
    await expect(runAudit(fakeClient, 'case-1', { userId: 'actor-server' })).rejects.toMatchObject({ status: 409 });
    expect(provider).not.toHaveBeenCalled();
  });

  it('rechaza confirmaciones sin actor, sobre otro intento o sobre evidencia que cambió antes de pagar IA', async () => {
    await expect(runAudit(fakeClient, 'case-1', { contactAnswer: { auditId: 'previous-audit', performed: true } })).rejects.toMatchObject({ status: 409 });
    await expect(runAudit(fakeClient, 'case-1', { userId: 'actor-server', contactAnswer: { auditId: 'otra', performed: true } })).rejects.toMatchObject({ status: 409 });
    seedEvidence({ id: 'ev-2', case_id: 'case-1', processing_status: 'READY' });
    await expect(runAudit(fakeClient, 'case-1', { userId: 'actor-server', contactAnswer: { auditId: 'previous-audit', performed: true } })).rejects.toMatchObject({ status: 409 });
    expect(provider).not.toHaveBeenCalled();
  });

  it('conserva la confirmación si una ejecución es interrumpida por timeout de infraestructura', async () => {
    const contactConfirmation = { performed: true, actorId: 'actor-server', confirmedAt: '2026-10-21T21:00:00.000Z', sourceAuditId: 'previous-audit', evidenceFingerprint: base };
    seedAudit({ id: 'running', case_id: 'case-1', status: 'RUNNING', created_at: '2099-01-01T00:00:00Z', deadline_at: '2000-01-01T00:00:00Z', provider_metadata: { contactConfirmation } });
    await healStaleAudit(fakeClient, 'case-1');
    expect((await getAuditById(fakeClient, 'running'))?.provider_metadata).toMatchObject({ stale: true, contactConfirmation });
    expect(provider).not.toHaveBeenCalled();
  });
});
