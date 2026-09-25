import { describe, expect, it, vi } from 'vitest';
import { buildDecisionTrace } from './decision-trace';
import type { DatabaseClient } from '@cancelaciones/db';

/**
 * Estos tests fijan la restricción que hace que un trace sirva de algo:
 *
 *     TRACE != POLICY ENGINE
 *
 * Si el read model empezara a "completar" lo que el motor no persistió,
 * devolvería una explicación con apariencia de evidencia que en realidad es una
 * segunda evaluación. Y como esa segunda evaluación puede discrepar de la
 * original, dej we'd be 並存的 dos verdades sobre por qué se decidió. Por eso
 * aquí se prueba que los huecos se DECLARAN.
 */

const AUDIT_ID = 'audit-1';
const RUN_ID = 'run-1';
const FACT_RUN_ID = 'fact-run-1';

const EVALUATION = {
  policyCode: 'GDM_GAM_PRD_MLG_003',
  policyVersion: '5',
  rulesFingerprint: 'rules-fp',
  factsFingerprint: 'facts-fp',
  evaluatedRules: [
    {
      ruleId: 'GDM-V5-5.8-A-NON-LICENCIATURA',
      category: 'OUTCOME_RULE',
      status: 'SATISFIED',
      source: { documentCode: 'GDM_GAM_PRD_MLG_003', version: '5', section: '5.8.a', page: 9 },
      conditions: [
        { id: 'no-effective-contact', description: 'No existe contacto efectivo', state: 'TRUE', factIds: ['f-contact'], evidenceRefs: [], missingFacts: [], observedValue: 'Contacto efectivo: no' },
        { id: 'student-level', description: 'Nivel academico', state: 'TRUE', factIds: ['f-level'], evidenceRefs: [], missingFacts: [], observedValue: undefined },
      ],
      factsUsed: ['f-contact', 'f-level'],
      missingFacts: [],
      evidenceRefs: [],
      outcomeEffect: 'CANCELACION_VENTA',
    },
    {
      ruleId: 'GDM-V5-5.2-A-CONTACT-ATTEMPTS',
      category: 'PROCESS_RULE',
      status: 'UNKNOWN',
      source: { documentCode: 'GDM_GAM_PRD_MLG_003', version: '5', section: '5.2', page: 3 },
      conditions: [
        { id: 'calls-count', description: 'Al menos 16 llamadas', state: 'UNKNOWN', factIds: ['f-contact'], evidenceRefs: [], missingFacts: [], observedValue: '45 llamadas; fuente partial' },
      ],
      factsUsed: ['f-contact'],
      missingFacts: ['classroom.hasGrades'],
      evidenceRefs: [],
    },
  ],
  satisfiedRules: ['GDM-V5-5.8-A-NON-LICENCIATURA'],
  unknownRules: ['GDM-V5-5.2-A-CONTACT-ATTEMPTS'],
  notApplicableRules: [],
  missingData: [{ factType: 'classroom.hasGrades', rulesAffected: ['GDM-V5-5.2-A-CONTACT-ATTEMPTS'], whyNeeded: 'x', severity: 'IMPORTANT' }],
  conflicts: [],
  suggestedOutcome: 'CANCELACION_VENTA',
  outcomeStatus: 'DETERMINED_WITH_WARNINGS',
  decisionStatus: 'REVIEW_REQUIRED',
  reviewRequired: true,
  suggestedReason: 'Falta acreditar calificaciones',
  decisiveRules: ['GDM-V5-5.8-A-NON-LICENCIATURA'],
  supportingRules: [],
  opposingRules: [],
  pendingRules: ['GDM-V5-5.2-A-CONTACT-ATTEMPTS'],
  conflictingRules: [],
  blockedRules: [],
  exclusions: [],
  missingEvidence: ['classroom.hasGrades'],
  missingFacts: ['classroom.hasGrades'],
  missingNormativeSources: [],
  softwareCoverageGaps: ['Sección 5.3 no formalizada todavía'],
  nextActions: [{ type: 'UPLOAD_EVIDENCE', description: 'Acreditar classroom.hasGrades', affectedRules: [], severity: 'IMPORTANT', canChangeOutcome: true }],
  explanation: 'x',
  trace: { decision: 'REVIEW_REQUIRED', ruleIds: ['GDM-V5-5.8-A-NON-LICENCIATURA'], factIds: ['f-contact'], evidenceRefs: [] },
};

const SNAPSHOT_FACTS = [
  { id: 'f-contact', type: 'contact.effectiveContact', value: { email: 'a@b.invalid' }, source: { artifactId: 'art-1' }, extractionConfidence: 1 },
  { id: 'f-level', type: 'student.level', value: 'Estudiante', source: { artifactId: 'art-2' }, extractionConfidence: 0.9 },
];

function fakeDb(overrides: { rules?: unknown; envelope?: unknown; human?: unknown; runs?: unknown } = {}) {
  const runs = overrides.runs ?? [{
    id: RUN_ID, audit_id: AUDIT_ID, fact_run_id: FACT_RUN_ID, created_at: '2026-09-25T10:00:00Z',
    status: 'COMPLETED', policy_code: 'GDM_GAM_PRD_MLG_003', policy_version: '5',
    facts_fingerprint: 'facts-fp', rules_fingerprint: 'rules-fp',
    suggested_outcome: 'CANCELACION_VENTA', outcome_status: 'DETERMINED_WITH_WARNINGS', evaluation: EVALUATION,
  }];

  // Un cadena de PostgREST empieza en from().select(); el fake reproduce esa
  // forma para que el test no pueda pasar con una forma de llamada distinta.
  const table = (rows: unknown) => {
    const api: Record<string, unknown> = {};
    for (const method of ['eq', 'in', 'order', 'limit']) api[method] = () => api;
    api.select = () => api;
    api.then = (resolve: (value: unknown) => void) => resolve({ data: rows, error: null });
    return api;
  };

  return {
    from: (name: string) => {
      if (name === 'engine_runs') return table(runs);
      if (name === 'engine_rule_results') return table(overrides.rules ?? [{ rule_id: 'GDM-V5-5.2-A-CONTACT-ATTEMPTS', status: 'UNKNOWN' }, { rule_id: 'GDM-V5-5.8-A-NON-LICENCIATURA', status: 'SATISFIED' }]);
      if (name === 'fact_run_frozen_snapshots') return table([{ facts: SNAPSHOT_FACTS, extractor_version: 'deterministic-facts-v1', policy_source_id: 'gdm-gam-prd-mlg-003-local-unverified' }]);
      if (name === 'audit_evaluation_envelopes') return table(overrides.envelope === null ? [] : (overrides.envelope ?? [{ schema_version: 'audit-evaluation-envelope-v1', envelope_hash: 'env-hash', created_at: '2026-09-25T10:00:01Z' }]));
      if (name === 'audit_runs') return table(overrides.human ?? []);
      if (name === 'audits') return table([{ external_case_id: 'CASE-1', display_name: 'Auditoria de prueba' }]);
      throw new Error(`tabla inesperada en el test: ${name}`);
    },
  } as unknown as DatabaseClient;
}

describe('buildDecisionTrace', () => {
  it('devuelve null si la auditoría no tiene ninguna corrida del motor', async () => {
    const db = fakeDb({ runs: [] });
    expect(await buildDecisionTrace({ database: db, auditId: AUDIT_ID })).toBeNull();
  });

  it('expone la ejecución con sus versiones y huellas', async () => {
    const trace = await buildDecisionTrace({ database: fakeDb(), auditId: AUDIT_ID });
    expect(trace).not.toBeNull();
    expect(trace!.schemaVersion).toBe('audit-decision-trace-v1');
    expect(trace!.readonly).toBe(true);
    expect(trace!.execution).toMatchObject({
      engineRunId: RUN_ID, factRunId: FACT_RUN_ID, policyCode: 'GDM_GAM_PRD_MLG_003', policyVersion: '5',
      extractorVersion: 'deterministic-facts-v1', policySourceId: 'gdm-gam-prd-mlg-003-local-unverified',
      factsFingerprint: 'facts-fp', rulesFingerprint: 'rules-fp',
    });
  });

  it('deja engineVersion en null en vez de inventarla desde el rulesFingerprint', async () => {
    const trace = await buildDecisionTrace({ database: fakeDb(), auditId: AUDIT_ID });
    expect(trace!.execution.engineVersion).toBeNull();
  });

  it('cruza cada hecho con las condiciones que lo consumieron, con el estado persistido', async () => {
    const trace = await buildDecisionTrace({ database: fakeDb(), auditId: AUDIT_ID });
    const contact = trace!.facts.find((fact) => fact.id === 'f-contact');
    expect(contact).toBeDefined();
    // Un mismo hecho puede alimentar dos reglas con estados distintos. El trace
    // lo muestra tal cual: no lo promedia ni lo resuelve.
    expect(contact!.usedBy.map((usage) => [usage.ruleId, usage.conditionState])).toEqual([
      ['GDM-V5-5.8-A-NON-LICENCIATURA', 'TRUE'],
      ['GDM-V5-5.2-A-CONTACT-ATTEMPTS', 'UNKNOWN'],
    ]);
  });

  it('proyecta reglas con condiciones, estado persistido y efecto sobre el outcome', async () => {
    const trace = await buildDecisionTrace({ database: fakeDb(), auditId: AUDIT_ID });
    const outcomeRule = trace!.rules.find((rule) => rule.ruleId === 'GDM-V5-5.8-A-NON-LICENCIATURA');
    expect(outcomeRule).toMatchObject({ status: 'SATISFIED', outcomeEffect: 'CANCELACION_VENTA', decisive: true, persistedStatus: 'SATISFIED' });
    expect(outcomeRule!.conditions).toHaveLength(2);
    expect(outcomeRule!.source).toMatchObject({ section: '5.8.a', page: 9 });
    const processRule = trace!.rules.find((rule) => rule.ruleId === 'GDM-V5-5.2-A-CONTACT-ATTEMPTS');
    expect(processRule).toMatchObject({ status: 'UNKNOWN', outcomeEffect: null, decisive: false });
    expect(processRule!.missingFacts).toEqual(['classroom.hasGrades']);
  });

  it('conserva la evidencia verbatim de la evaluación', async () => {
    const trace = await buildDecisionTrace({ database: fakeDb(), auditId: AUDIT_ID });
    expect(trace!.evaluationVerbatim).toEqual(EVALUATION);
  });

  describe('prohibición de recalcular', () => {
    it('no importa ni invoca el motor normativo', async () => {
      // Si el read model evaluara, tendría que IMPORTAR evaluatePolicy. Se
      // comprueba la sentencia de import, no la palabra suelta: el módulo la
      // menciona en un comentario para explicar por qué no la usa.
      const source = await import('node:fs').then((fs) => fs.readFileSync(new URL('./decision-trace.ts', import.meta.url), 'utf8'));
      const importLines = source.split('\n').filter((line) => /^\s*import\b/.test(line));
      expect(importLines.join('\n')).not.toMatch(/evaluatePolicy/);
      expect(importLines.join('\n')).not.toMatch(/v5Rules|policySets/);
    });

    it('no escribe en la base: sólo usa from().select()', async () => {
      const insert = vi.fn();
      const update = vi.fn();
      const remove = vi.fn();
      const table = () => {
        const api: Record<string, unknown> = {};
        for (const method of ['eq', 'in', 'order', 'limit']) api[method] = () => api;
        api.select = () => api;
        api.insert = insert; api.update = update; api.delete = remove;
        api.then = (resolve: (value: unknown) => void) => resolve({ data: [], error: null });
        return api;
      };
      const db = {
        from: () => table(),
        insert, update, delete: remove,
      } as unknown as DatabaseClient;
      await buildDecisionTrace({ database: db, auditId: AUDIT_ID });
      expect(insert).not.toHaveBeenCalled();
      expect(update).not.toHaveBeenCalled();
      expect(remove).not.toHaveBeenCalled();
    });
  });

  describe('huecos declarados en vez de rellenados', () => {
    it('sin envelope, lo declara y levanta PERSISTENCE_ERROR', async () => {
      const trace = await buildDecisionTrace({ database: fakeDb({ envelope: null }), auditId: AUDIT_ID });
      expect(trace!.envelope).toBeNull();
      expect(trace!.diagnostics.some((d) => d.code === 'PERSISTENCE_ERROR')).toBe(true);
    });

    it('sin snapshot, deja los facts vacíos sin inventarlos', async () => {
      const db = {
        from: (name: string) => {
          const rows = name === 'engine_runs'
            ? [{ id: RUN_ID, audit_id: AUDIT_ID, fact_run_id: null, status: 'COMPLETED', evaluation: EVALUATION, policy_code: 'GDM_GAM_PRD_MLG_003', policy_version: '5' }]
            : name === 'audit_evaluation_envelopes' ? [{ schema_version: 'v1', envelope_hash: 'h', created_at: 'x' }]
            : [];
          const api: Record<string, unknown> = {};
          for (const method of ['eq', 'in', 'order', 'limit']) api[method] = () => api;
          api.select = () => api;
          api.then = (resolve: (value: unknown) => void) => resolve({ data: rows, error: null });
          return api;
        },
      } as unknown as DatabaseClient;
      const trace = await buildDecisionTrace({ database: db, auditId: AUDIT_ID });
      expect(trace!.facts).toEqual([]);
      expect(trace!.execution.extractorVersion).toBeNull();
      expect(trace!.execution.factRunId).toBeNull();
    });

    it('marca los hechos sin type como FACT_NORMALIZATION_GAP en vez de proyectarlos', async () => {
      const db = {
        from: (name: string) => {
          const rows = name === 'engine_runs'
            ? [{ id: RUN_ID, audit_id: AUDIT_ID, fact_run_id: FACT_RUN_ID, status: 'COMPLETED', evaluation: EVALUATION, policy_code: 'p', policy_version: '5' }]
            : name === 'fact_run_frozen_snapshots' ? [{ facts: [{ id: 'x', value: 1 }], extractor_version: 'v', policy_source_id: 's' }]
            : name === 'audit_evaluation_envelopes' ? [{ schema_version: 'v1', envelope_hash: 'h', created_at: 'x' }]
            : [];
          const api: Record<string, unknown> = {};
          for (const method of ['eq', 'in', 'order', 'limit']) api[method] = () => api;
          api.select = () => api;
          api.then = (resolve: (value: unknown) => void) => resolve({ data: rows, error: null });
          return api;
        },
      } as unknown as DatabaseClient;
      const trace = await buildDecisionTrace({ database: db, auditId: AUDIT_ID });
      expect(trace!.facts).toEqual([]);
      expect(trace!.diagnostics.some((d) => d.code === 'FACT_NORMALIZATION_GAP' && d.detail.includes('type'))).toBe(true);
    });
  });

  describe('múltiples corridas', () => {
    it('selecciona la más reciente y declara todas las demás sin ocultarlas', async () => {
      const db = fakeDb({ runs: [
        { id: 'run-nuevo', audit_id: AUDIT_ID, fact_run_id: FACT_RUN_ID, created_at: '2026-09-25T12:00:00Z', status: 'COMPLETED', policy_code: 'GDM_GAM_PRD_MLG_003', policy_version: '5', rules_fingerprint: 'rules-fp-2', outcome_status: 'DETERMINED', suggested_outcome: 'BAJA', evaluation: EVALUATION },
        { id: 'run-viejo', audit_id: AUDIT_ID, fact_run_id: FACT_RUN_ID, created_at: '2026-09-24T12:00:00Z', status: 'COMPLETED', policy_code: 'GDM_GAM_PRD_MLG_003', policy_version: '5', rules_fingerprint: 'rules-fp-1', outcome_status: 'INDETERMINATE', suggested_outcome: null, evaluation: EVALUATION },
      ] });
      const trace = await buildDecisionTrace({ database: db, auditId: AUDIT_ID });
      expect(trace!.execution.engineRunId).toBe('run-nuevo');
      expect(trace!.availableRuns).toHaveLength(2);
      expect(trace!.availableRuns.filter((run) => run.isSelected)).toHaveLength(1);
      // La corrida vieja conserva su rulesFingerprint para poder comparar.
      expect(trace!.availableRuns.find((run) => run.engineRunId === 'run-viejo')!.rulesFingerprint).toBe('rules-fp-1');
    });

    it('permite seleccionar una corrida concreta por id', async () => {
      const db = fakeDb({ runs: [
        { id: 'run-nuevo', audit_id: AUDIT_ID, fact_run_id: FACT_RUN_ID, created_at: '2026-09-25T12:00:00Z', status: 'COMPLETED', policy_code: 'p', policy_version: '5', evaluation: EVALUATION },
        { id: 'run-viejo', audit_id: AUDIT_ID, fact_run_id: FACT_RUN_ID, created_at: '2026-09-24T12:00:00Z', status: 'COMPLETED', policy_code: 'p', policy_version: '5', evaluation: EVALUATION },
      ] });
      const trace = await buildDecisionTrace({ database: db, auditId: AUDIT_ID, engineRunId: 'run-viejo' });
      expect(trace!.execution.engineRunId).toBe('run-viejo');
    });

    it('devuelve null si se pide un engineRunId que no es de esta auditoría', async () => {
      const trace = await buildDecisionTrace({ database: fakeDb(), auditId: AUDIT_ID, engineRunId: 'run-de-otra-auditoria' });
      expect(trace).toBeNull();
    });
  });

  describe('aislamiento de la decisión humana', () => {
    it('sin decisión humana, la sección lo dice en vez de omitirse', async () => {
      const trace = await buildDecisionTrace({ database: fakeDb(), auditId: AUDIT_ID });
      expect(trace!.comparison.humanOutcome).toBeNull();
      expect(trace!.comparison.note).toContain('NO la hay');
    });

    it('con decisión humana, la deja en comparison y no toca la agregación', async () => {
      const db = fakeDb({ human: [{ id: 'h1', run_type: 'HUMAN_DECISION', status: 'COMPLETED', result: { outcome: 'BAJA' }, policy_version: '5' }] });
      const trace = await buildDecisionTrace({ database: db, auditId: AUDIT_ID });
      expect(trace!.comparison.humanOutcome).toBe('BAJA');
      expect(trace!.aggregation.suggestedOutcome).toBe('CANCELACION_VENTA');
      expect(trace!.facts).toHaveLength(2);
    });
  });

  describe('diagnóstico técnico, no normativo', () => {
    it('levanta los códigos que se derivan de campos persistidos', async () => {
      const trace = await buildDecisionTrace({ database: fakeDb(), auditId: AUDIT_ID });
      const codes = trace!.diagnostics.map((d) => d.code);
      expect(codes).toContain('MISSING_EVIDENCE');
      expect(codes).toContain('MISSING_FACT');
      expect(codes).toContain('POLICY_COVERAGE_GAP');
      expect(codes).toContain('RULE_EVALUATION_PATH');
      // 5.7.e salió UNKNOWN y aun así reviewRequired: eso es un hecho de la
      // cobertura del software, no un juicio sobre la política.
      expect(trace!.coverage.softwareCoverageGaps).toContain('Sección 5.3 no formalizada todavía');
    });

    it('no inventa códigos de diagnóstico', async () => {
      const allowed = ['EVIDENCE_EXTRACTION_GAP', 'FACT_NORMALIZATION_GAP', 'MISSING_EVIDENCE', 'MISSING_FACT', 'CONTRADICTORY_EVIDENCE', 'POLICY_COVERAGE_GAP', 'MISSING_NORMATIVE_SOURCE', 'RULE_EVALUATION_PATH', 'OUTCOME_AGGREGATION', 'SYSTEM_ERROR', 'PERSISTENCE_ERROR'];
      const trace = await buildDecisionTrace({ database: fakeDb(), auditId: AUDIT_ID });
      for (const diagnostic of trace!.diagnostics) expect(allowed).toContain(diagnostic.code);
    });
  });
});
