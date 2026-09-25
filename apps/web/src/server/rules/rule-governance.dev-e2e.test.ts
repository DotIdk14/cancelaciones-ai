import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createAdminClient, createClient } from '@insforge/sdk';
import { createRuleGovernanceRepository } from '@cancelaciones/db';

const DEV_BRANCH_APPKEY = '4pw4jdzv-cif';

function requireDevEnv() {
  const baseUrl = process.env.NEXT_PUBLIC_INSFORGE_URL;
  const anonKey = process.env.NEXT_PUBLIC_INSFORGE_ANON_KEY;
  const apiKey = process.env.INSFORGE_DEV_API_KEY;
  const actorId = process.env.INSFORGE_DEV_ACTOR_ID;
  if (!baseUrl || !anonKey || !apiKey || !actorId) throw new Error('DEV_INFRA_NOT_CONFIGURED: NEXT_PUBLIC_INSFORGE_URL, NEXT_PUBLIC_INSFORGE_ANON_KEY, INSFORGE_DEV_API_KEY e INSFORGE_DEV_ACTOR_ID son obligatorios. No hay fallback.');
  if (!baseUrl.includes(DEV_BRANCH_APPKEY)) throw new Error(`REFUSING_NON_DEV_INSFORGE_URL: esperado appkey DEV ${DEV_BRANCH_APPKEY}.`);
  return { baseUrl, anonKey, apiKey, actorId };
}

async function cleanup(client: ReturnType<typeof createClient>, ruleKeys: string[]) {
  for (const ruleKey of ruleKeys) {
    const existing = await createRuleGovernanceRepository(client.database).listRules({ ruleKey });
    for (const rule of existing) {
      await client.database.from('rules').update({ status: 'DRAFT' }).eq('id', rule.id);
      await client.database.from('evidence_requirements').delete().eq('rule_id', rule.id);
      await client.database.from('rule_conditions').delete().eq('rule_id', rule.id);
      await client.database.from('rules').delete().eq('id', rule.id);
    }
  }
}

describe('RULE GOVERNANCE DEV INFRA E2E', () => {
  it('crea rule, valida evidence requirements, respeta inmutabilidad de version y aisla versiones', async () => {
    const env = requireDevEnv();
    const client = createAdminClient({ baseUrl: env.baseUrl, apiKey: env.apiKey });
    const suffix = randomUUID().slice(0, 8);
    const ruleKey = `governance-e2e-${suffix}`;
    const repo = createRuleGovernanceRepository(client.database);

    try {
      const v1 = await repo.createRule({ ruleKey, version: '1', name: 'Regla E2E v1', createdBy: env.actorId });
      expect(v1.status).toBe('DRAFT');

      const req = await repo.createEvidenceRequirement({
        ruleId: v1.id,
        requirementKey: 'solicitud',
        evidenceType: 'PDF',
        documentRole: 'EVIDENCE',
        required: true,
        minCount: 1,
        orderIndex: 1,
      });
      expect(req.requirementKey).toBe('solicitud');
      expect(req.documentRole).toBe('EVIDENCE');

      const updated = await repo.updateEvidenceRequirement(req.id, { name: 'Solicitud de cancelación' });
      expect(updated.name).toBe('Solicitud de cancelación');

      const version2 = await repo.createRule({ ruleKey, version: '2', name: 'Regla E2E v2' });
      await repo.createEvidenceRequirement({ ruleId: version2.id, requirementKey: 'solicitud_v2', evidenceType: 'PDF', required: false, minCount: 0 });

      expect(await repo.listEvidenceRequirements(v1.id)).toHaveLength(1);
      expect(await repo.listEvidenceRequirements(version2.id)).toHaveLength(1);

      // Versión publicada (APPROVED) queda inmutable
      await repo.updateRuleStatus(v1.id, 'APPROVED');
      await expect(repo.updateEvidenceRequirement(req.id, { name: 'No permitido' })).rejects.toThrow(/RULE_VERSION_IMMUTABLE|rule version/i);
      await expect(repo.createEvidenceRequirement({ ruleId: v1.id, requirementKey: 'nueva', evidenceType: 'PDF' })).rejects.toThrow(/RULE_VERSION_IMMUTABLE|rule version/i);
      await expect(repo.deleteEvidenceRequirement(req.id)).rejects.toThrow(/RULE_VERSION_IMMUTABLE|rule version/i);

      // La versión 2 sigue siendo DRAFT y editable
      await repo.createEvidenceRequirement({ ruleId: version2.id, requirementKey: 'adicional', evidenceType: 'TEXT' });
      expect(await repo.listEvidenceRequirements(version2.id)).toHaveLength(2);

      // Borrado de rule no-DRAFT queda bloqueado; DRAFT sí se puede borrar en cascada
      const blockedDelete = await client.database.from('rules').delete().eq('id', v1.id);
      expect(blockedDelete.error?.message ?? '').toMatch(/RULE_VERSION_IMMUTABLE/);

      // Puntero de resolución: la version activa no comparte requirements con la DRAFT
      const activeRule = (await repo.listRules({ ruleKey })).find((r) => r.version === '1');
      const draftRule = (await repo.listRules({ ruleKey })).find((r) => r.version === '2');
      expect(activeRule?.status).toBe('APPROVED');
      expect(draftRule?.status).toBe('DRAFT');
      expect(activeRule?.id).not.toBe(draftRule?.id);

      // Validación a nivel repositorio: requisito inválido se rechaza sin escribir
      await expect(repo.createEvidenceRequirement({ ruleId: version2.id, requirementKey: '', evidenceType: 'PDF' })).rejects.toThrow('INVALID_REQUIREMENT_KEY');
      await expect(repo.createEvidenceRequirement({ ruleId: version2.id, requirementKey: 'x', evidenceType: 'UNKNOWN' as never })).rejects.toThrow('INVALID_EVIDENCE_TYPE');

      // RLS/grant: cliente anon sin sesión no debe leer requirements
      const anonymous = createClient({ baseUrl: env.baseUrl, anonKey: env.anonKey });
      const anonRead = await anonymous.database.from('evidence_requirements').select('id').eq('rule_id', v1.id).limit(10);
      expect(anonRead.data ?? []).toEqual([]);
    } finally {
      await cleanup(client, [ruleKey]);
    }
  }, 60_000);
});