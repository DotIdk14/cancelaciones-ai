import { AI_DECISION_V1_ALREADY_EXISTS, createPolicyFoundationRepository, type DatabaseClient } from '@cancelaciones/db';
import { describe, expect, it } from 'vitest';
import { buildAiDecisionV1Snapshot, hashAiDecisionV1Snapshot, type AiDecisionV1Snapshot, type AiDecisionV1SnapshotHashable } from './ai-decision-snapshot';

/** 200 caracteres: cualquier slice de 120 rompería la cobertura del hash. */
const LONG_TEXT = `MOTIVO:${'X'.repeat(194)}FIN`;

const SNAPSHOT_FIELDS = [
  'auditId',
  'factRunId',
  'decisionVersion',
  'policyCode',
  'policyVersion',
  'policySourceId',
  'engineVersion',
  'promptVersion',
  'extractorVersion',
  'provider',
  'model',
  'inputFingerprint',
  'decisionSnapshot',
  'ruleTraceSnapshot',
  'evidenceSnapshot',
  'createdAt',
  'hash',
] as const;

function snapshotInput(overrides: Partial<AiDecisionV1SnapshotHashable> = {}): AiDecisionV1SnapshotHashable {
  return {
    auditId: 'audit-1',
    factRunId: 'fact-run-1',
    decisionVersion: 'AI_DECISION_V1',
    policyCode: 'GDM_GAM_PRD_MLG_003',
    policyVersion: '5',
    policySourceId: 'policy-source-1',
    engineVersion: 'policy-engine-5.8.0',
    promptVersion: 'policy-reasoner-v1',
    extractorVersion: 'deterministic-v1',
    provider: 'OpenRouter',
    model: 'google/gemini-2.5-flash',
    inputFingerprint: 'f'.repeat(64),
    decisionSnapshot: {
      probableOutcome: 'CANCELACION_VENTA',
      justification: LONG_TEXT,
      evidenceRefs: [{ evidenceId: 'evidence-1', artifactId: 'artifact-1' }],
    },
    ruleTraceSnapshot: {
      ruleRefs: [{ ruleId: '5.1', section: '5.1', justification: LONG_TEXT }],
      evaluatedRules: [{ ruleId: '5.1', status: 'SATISFIED' }],
    },
    evidenceSnapshot: {
      evidenceRefs: [{ evidenceId: 'evidence-1', artifactId: 'artifact-1' }],
      exclusions: [{ evidenceId: 'evidence-2', reason: 'HUMAN_DECISION_DOCUMENT' }],
    },
    createdAt: '2026-09-25T00:00:00.000Z',
    ...overrides,
  };
}

interface FakeDbOptions {
  selectError?: { code: string; message: string } | null;
  insertError?: { code: string; message: string } | null;
}

/**
 * DB en memoria mínima. `update` y `delete` lanzan: la tabla de snapshots es
 * append-only y este fake falla ruidosamente si el repositorio intenta mutar.
 */
function createFakeDatabase(options: FakeDbOptions = {}) {
  const rows: Array<Record<string, unknown>> = [];
  const insertCalls: Array<Array<Record<string, unknown>>> = [];
  const selectFilters: Array<Array<[string, unknown]>> = [];

  const matches = (row: Record<string, unknown>, filters: Array<[string, unknown]>): boolean =>
    filters.every(([column, value]) => row[column] === value);

  const database: DatabaseClient = {
    from(table: string) {
      if (table !== 'ai_decision_snapshots') throw new Error(`TABLA NO ESPERADA: ${table}`);
      const filters: Array<[string, unknown]> = [];
      const selectChain = {
        select: () => selectChain,
        eq: (column: string, value: unknown) => {
          filters.push([column, value]);
          return selectChain;
        },
        limit: async () => {
          selectFilters.push([...filters]);
          if (options.selectError) return { data: null, error: options.selectError };
          return { data: rows.filter((row) => matches(row, filters)), error: null };
        },
      };
      return {
        select: () => selectChain,
        insert: (payload: Array<Record<string, unknown>>) => {
          const insertChain = {
            select: () => insertChain,
            single: async () => {
              insertCalls.push(payload);
              if (options.insertError) return { data: null, error: options.insertError };
              rows.push(...payload);
              return { data: payload[0] ?? null, error: null };
            },
          };
          return insertChain;
        },
        update: () => {
          throw new Error('UPDATE PROHIBIDO: ai_decision_snapshots es append-only');
        },
        delete: () => {
          throw new Error('DELETE PROHIBIDO: ai_decision_snapshots es append-only');
        },
      };
    },
  };

  return { database, rows, insertCalls, selectFilters };
}

describe('buildAiDecisionV1Snapshot', () => {
  it('expone exactamente el conjunto de campos del contrato AI_DECISION_V1', () => {
    const snapshot = buildAiDecisionV1Snapshot(snapshotInput());
    expect([...Object.keys(snapshot)].sort()).toEqual([...SNAPSHOT_FIELDS].sort());
    expect(snapshot.decisionVersion).toBe('AI_DECISION_V1');
  });

  it('es determinista: mismo input, mismo hash', () => {
    expect(buildAiDecisionV1Snapshot(snapshotInput()).hash).toBe(buildAiDecisionV1Snapshot(snapshotInput()).hash);
  });

  it('el hash del snapshot completo coincide con el hash recomputado', () => {
    const snapshot = buildAiDecisionV1Snapshot(snapshotInput());
    expect(hashAiDecisionV1Snapshot(snapshot)).toBe(snapshot.hash);
  });

  it('cambia el hash al cambiar evidenceRefs (sin truncar)', () => {
    const base = buildAiDecisionV1Snapshot(snapshotInput());
    const moved = buildAiDecisionV1Snapshot(snapshotInput({
      decisionSnapshot: {
        probableOutcome: 'CANCELACION_VENTA',
        justification: LONG_TEXT,
        evidenceRefs: [{ evidenceId: 'evidence-OTRA', artifactId: 'artifact-1' }],
      },
    }));

    expect(moved.hash).not.toBe(base.hash);
  });

  it('cambia el hash al cambiar policyCode', () => {
    const base = buildAiDecisionV1Snapshot(snapshotInput());
    const other = buildAiDecisionV1Snapshot(snapshotInput({ policyCode: 'GDM_GAM_PRD_MLG_004' }));

    expect(other.hash).not.toBe(base.hash);
  });

  it('cubre el texto completo: el ultimo caracter de un string de 200 cambia el hash', () => {
    const base = buildAiDecisionV1Snapshot(snapshotInput());
    const tailMutated = buildAiDecisionV1Snapshot(snapshotInput({
      decisionSnapshot: {
        probableOutcome: 'CANCELACION_VENTA',
        justification: `${LONG_TEXT.slice(0, LONG_TEXT.length - 1)}Z`,
        evidenceRefs: [{ evidenceId: 'evidence-1', artifactId: 'artifact-1' }],
      },
    }));

    expect(tailMutated.hash).not.toBe(base.hash);
  });

  const fieldMutations: Array<[string, Partial<AiDecisionV1SnapshotHashable>]> = [
    ['auditId', { auditId: 'audit-2' }],
    ['factRunId', { factRunId: 'fact-run-2' }],
    ['policyCode', { policyCode: 'GDM_GAM_PRD_MLG_004' }],
    ['policyVersion', { policyVersion: '4' }],
    ['policySourceId', { policySourceId: 'policy-source-2' }],
    ['engineVersion', { engineVersion: 'policy-engine-6.0.0' }],
    ['promptVersion', { promptVersion: 'policy-reasoner-v2' }],
    ['promptVersion null', { promptVersion: null }],
    ['extractorVersion', { extractorVersion: 'deterministic-v2' }],
    ['provider', { provider: 'Anthropic' }],
    ['provider null', { provider: null }],
    ['model', { model: 'google/gemini-2.5-pro' }],
    ['model null', { model: null }],
    ['inputFingerprint', { inputFingerprint: 'a'.repeat(64) }],
    ['createdAt', { createdAt: '2026-09-26T00:00:00.000Z' }],
    ['decisionSnapshot', { decisionSnapshot: { probableOutcome: 'BAJA' } }],
    ['ruleTraceSnapshot', { ruleTraceSnapshot: { ruleRefs: [{ ruleId: '5.2', section: '5.2', justification: 'otra' }] } }],
    ['evidenceSnapshot', { evidenceSnapshot: { evidenceRefs: [{ evidenceId: 'evidence-OTRA', artifactId: 'artifact-1' }] } }],
  ];

  it.each(fieldMutations)('cambia el hash al mutar %s', (_field, patch) => {
    const base = buildAiDecisionV1Snapshot(snapshotInput());
    const mutated = hashAiDecisionV1Snapshot({ ...base, ...patch });

    expect(mutated).not.toBe(base.hash);
  });

  it('incluye decisionVersion en el hash', () => {
    const base = buildAiDecisionV1Snapshot(snapshotInput());
    // El contrato fija 'AI_DECISION_V1'; el cast permite verificar que el hash
    // tambien cubre ese campo sin relajar el tipo público.
    const altered = { ...base, decisionVersion: 'AI_DECISION_V2' } as unknown as AiDecisionV1Snapshot;

    expect(hashAiDecisionV1Snapshot(altered)).not.toBe(base.hash);
  });

  it('ignora el campo hash al recomputar', () => {
    const base = buildAiDecisionV1Snapshot(snapshotInput());

    expect(hashAiDecisionV1Snapshot({ ...base, hash: '0'.repeat(64) })).toBe(base.hash);
  });

  it('no depende del orden de las claves: Postgres (JSONB) reordena al leer', () => {
    const base = buildAiDecisionV1Snapshot(snapshotInput());
    const reordered = buildAiDecisionV1Snapshot(snapshotInput({
      decisionSnapshot: {
        evidenceRefs: [{ evidenceId: 'evidence-1', artifactId: 'artifact-1' }],
        justification: LONG_TEXT,
        probableOutcome: 'CANCELACION_VENTA',
      },
    }));

    expect(reordered.hash).toBe(base.hash);
  });

  it('sí depende del orden de los elementos: el orden de las evidencias es Significant', () => {
    const base = buildAiDecisionV1Snapshot(snapshotInput());
    const reordered = buildAiDecisionV1Snapshot(snapshotInput({
      evidenceSnapshot: {
        evidenceRefs: [
          { evidenceId: 'evidence-1', artifactId: 'artifact-1' },
          { evidenceId: 'evidence-2', artifactId: 'artifact-2' },
        ],
        exclusions: [],
      },
    }));

    expect(reordered.hash).not.toBe(base.hash);
  });
});

describe('createPolicyFoundationRepository.appendAiDecisionV1', () => {
  it('inserta la fila una sola vez y devuelve el snapshot persistido', async () => {
    const fake = createFakeDatabase();
    const repository = createPolicyFoundationRepository(fake.database);
    const snapshot = buildAiDecisionV1Snapshot(snapshotInput());

    const appended = await repository.appendAiDecisionV1(snapshot);

    expect(appended).toEqual(snapshot);
    expect(fake.rows).toHaveLength(1);
    expect(fake.insertCalls).toHaveLength(1);
    expect(fake.rows[0]).toEqual({
      audit_id: 'audit-1',
      fact_run_id: 'fact-run-1',
      decision_version: 'AI_DECISION_V1',
      policy_code: 'GDM_GAM_PRD_MLG_003',
      policy_version: '5',
      policy_source_id: 'policy-source-1',
      engine_version: 'policy-engine-5.8.0',
      prompt_version: 'policy-reasoner-v1',
      extractor_version: 'deterministic-v1',
      provider: 'OpenRouter',
      model: 'google/gemini-2.5-flash',
      input_fingerprint: 'f'.repeat(64),
      decision_snapshot: snapshot.decisionSnapshot,
      rule_trace_snapshot: snapshot.ruleTraceSnapshot,
      evidence_snapshot: snapshot.evidenceSnapshot,
      created_at: '2026-09-25T00:00:00.000Z',
      hash: snapshot.hash,
    });
  });

  it('falla con AI_DECISION_V1_ALREADY_EXISTS ante colision de audit, version e input fingerprint', async () => {
    const fake = createFakeDatabase();
    const repository = createPolicyFoundationRepository(fake.database);
    const snapshot = buildAiDecisionV1Snapshot(snapshotInput());
    await repository.appendAiDecisionV1(snapshot);

    await expect(repository.appendAiDecisionV1(buildAiDecisionV1Snapshot(snapshotInput()))).rejects.toThrow(AI_DECISION_V1_ALREADY_EXISTS);
    expect(fake.rows).toHaveLength(1);
  });

  it('no muta la fila existente cuando el append se rechaza', async () => {
    const fake = createFakeDatabase();
    const repository = createPolicyFoundationRepository(fake.database);
    const first = buildAiDecisionV1Snapshot(snapshotInput());
    await repository.appendAiDecisionV1(first);
    const before = JSON.stringify(fake.rows);
    const insertCallsBefore = fake.insertCalls.length;

    await expect(repository.appendAiDecisionV1(buildAiDecisionV1Snapshot(snapshotInput({
      createdAt: '2027-01-01T00:00:00.000Z',
      decisionSnapshot: { probableOutcome: 'OTRO_OUTCOME' },
    })))).rejects.toThrow(AI_DECISION_V1_ALREADY_EXISTS);

    expect(JSON.stringify(fake.rows)).toBe(before);
    expect(fake.insertCalls).toHaveLength(insertCallsBefore);
  });

  it('permite append cuando cambia el inputFingerprint (crece, nunca reemplaza)', async () => {
    const fake = createFakeDatabase();
    const repository = createPolicyFoundationRepository(fake.database);
    await repository.appendAiDecisionV1(buildAiDecisionV1Snapshot(snapshotInput()));

    const second = buildAiDecisionV1Snapshot(snapshotInput({ inputFingerprint: 'b'.repeat(64) }));
    await repository.appendAiDecisionV1(second);

    expect(fake.rows).toHaveLength(2);
    expect(fake.rows.map((row) => row.hash)).toEqual([buildAiDecisionV1Snapshot(snapshotInput()).hash, second.hash]);
  });

  it('permite append cuando cambia el auditId', async () => {
    const fake = createFakeDatabase();
    const repository = createPolicyFoundationRepository(fake.database);
    await repository.appendAiDecisionV1(buildAiDecisionV1Snapshot(snapshotInput()));

    await repository.appendAiDecisionV1(buildAiDecisionV1Snapshot(snapshotInput({ auditId: 'audit-2' })));

    expect(fake.rows).toHaveLength(2);
  });

  it('mapea una violacion de unicidad del servidor a AI_DECISION_V1_ALREADY_EXISTS', async () => {
    const fake = createFakeDatabase({ insertError: { code: '23505', message: 'duplicate key value violates unique constraint "ai_decision_snapshots_identity"' } });
    const repository = createPolicyFoundationRepository(fake.database);

    await expect(repository.appendAiDecisionV1(buildAiDecisionV1Snapshot(snapshotInput())))
      .rejects.toThrow(AI_DECISION_V1_ALREADY_EXISTS);
    expect(fake.rows).toHaveLength(0);
  });

  it('propaga el error de lectura sin tragarselo', async () => {
    const fake = createFakeDatabase({ selectError: { code: '42501', message: 'permission denied for table ai_decision_snapshots' } });
    const repository = createPolicyFoundationRepository(fake.database);

    await expect(repository.appendAiDecisionV1(buildAiDecisionV1Snapshot(snapshotInput())))
      .rejects.toThrow('permission denied for table ai_decision_snapshots');
    expect(fake.insertCalls).toHaveLength(0);
  });

  it('propaga un fallo de insercion distinto de colision', async () => {
    const fake = createFakeDatabase({ insertError: { code: '57014', message: 'connection terminated unexpectedly' } });
    const repository = createPolicyFoundationRepository(fake.database);

    await expect(repository.appendAiDecisionV1(buildAiDecisionV1Snapshot(snapshotInput())))
      .rejects.toThrow('connection terminated unexpectedly');
  });
});
