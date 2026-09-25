import { describe, expect, it } from 'vitest';
import { createPolicySourceRegistry } from './source-registry';
import type { PolicySourceRecord, PolicySourceStatus } from './source-registry';

const pending = {
  policyCode: 'GDM_GAM_PRD_MLG_003',
  policyVersion: 'UNVERIFIED_LOCAL',
  documentId: 'gdm-gam-prd-mlg-003-local-unverified',
  sha256: '71faf64634805b1b4820132cdfcc1304d740ff00d1e9573dd850222c9496c7d2',
  status: 'PENDING_VERIFICATION' as const,
};

describe('PolicySourceRegistry', () => {
  it('registra una fuente pendiente sin declararla canónica', () => {
    const registry = createPolicySourceRegistry([pending]);
    expect(registry.get(pending.policyCode, pending.policyVersion)?.status).toBe('PENDING_VERIFICATION');
    expect(registry.canonicalSources()).toEqual([]);
  });

  it('registra fuentes LEGACY y SUPERSEDED y sólo devuelve las CANONICAL', () => {
    const statusCoverage: Record<PolicySourceStatus, true> = {
      CANONICAL: true,
      LEGACY: true,
      PENDING_VERIFICATION: true,
      SUPERSEDED: true,
    };
    const sources: PolicySourceRecord[] = [
      { ...pending, policyVersion: 'LEGACY_LOCAL', documentId: 'legacy-local', status: 'LEGACY' },
      { ...pending, policyVersion: 'SUPERSEDED_OFFICIAL', documentId: 'superseded-official', status: 'SUPERSEDED' },
      { ...pending, policyVersion: 'CURRENT_OFFICIAL', documentId: 'current-official', status: 'CANONICAL' },
    ];
    const registry = createPolicySourceRegistry(sources);

    expect(statusCoverage).toEqual({
      CANONICAL: true,
      LEGACY: true,
      PENDING_VERIFICATION: true,
      SUPERSEDED: true,
    });
    expect(registry.get(sources[0].policyCode, sources[0].policyVersion)?.status).toBe('LEGACY');
    expect(registry.get(sources[1].policyCode, sources[1].policyVersion)?.status).toBe('SUPERSEDED');
    expect(registry.canonicalSources()).toEqual([sources[2]]);
  });

  it('rechaza SHA-256 inválido y versiones duplicadas', () => {
    expect(() => createPolicySourceRegistry([{ ...pending, sha256: 'bad' }])).toThrow(/POLICY_SOURCE_SHA256_INVALID/);
    expect(() => createPolicySourceRegistry([pending, pending])).toThrow(/POLICY_SOURCE_DUPLICATE/);
  });

  it('exige referencia completa de policy para reglas futuras', () => {
    const registry = createPolicySourceRegistry([pending]);
    expect(registry.requireReference({
      policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: 'UNVERIFIED_LOCAL',
      documentId: 'gdm-gam-prd-mlg-003-local-unverified', section: '5.2', page: 3, citation: 'test',
    }).status).toBe('PENDING_VERIFICATION');
  });
});
