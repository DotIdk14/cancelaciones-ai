import { describe, expect, it, vi } from 'vitest';
import type { DatabaseClient, FactExtractionRun } from '@cancelaciones/db';
import { stableFingerprint } from '@cancelaciones/domain';
import { FoundationFakeDb, missingFunctionError, type FakeRow } from './foundation-fake-db';
import { freezeFactRunWithSnapshot, getFrozenEffectiveFacts, isFoundationObjectMissing } from './fact-run-snapshot';

const AUDIT_ID = 'audit-1';
const RUN_ID = 'run-1';
const ACTOR_ID = 'actor-1';
const POLICY_SOURCE_ID = 'gdm-gam-prd-mlg-003-local-unverified';
const CREATED_AT = '2026-09-25T00:00:00.000Z';

const frozenRun: FactExtractionRun = {
  id: RUN_ID,
  auditId: AUDIT_ID,
  policyCode: 'GDM_GAM_PRD_MLG_003',
  policyVersion: '5',
  extractorVersion: 'deterministic-facts-v1',
  artifactSetFingerprint: 'artifact-fp',
  state: 'FROZEN',
  frozenAt: CREATED_AT,
  createdAt: CREATED_AT,
};

function seedRun(db: FoundationFakeDb, state: 'DRAFT' | 'PROCESSING' | 'FROZEN' = 'FROZEN') {
  db.table('audits').push({ id: AUDIT_ID, display_name: 'Caso', status: 'PROCESSING', external_case_id: 'E2E-1', created_by: ACTOR_ID, created_at: CREATED_AT, updated_at: CREATED_AT });
  db.table('fact_extraction_runs').push({ id: RUN_ID, audit_id: AUDIT_ID, policy_code: 'GDM_GAM_PRD_MLG_003', policy_version: '5', extractor_version: 'deterministic-facts-v1', artifact_set_fingerprint: 'artifact-fp', state, frozen_at: state === 'FROZEN' ? CREATED_AT : null, created_at: CREATED_AT });
}

function seedFacts(db: FoundationFakeDb) {
  db.table('facts').push(
    { id: 'fact-level', audit_id: AUDIT_ID, run_id: RUN_ID, fact_type: 'student.level', classification: 'OBSERVABLE', value: 'LICENCIATURA', source_ref: { evidenceId: 'ev-1', artifactId: 'art-1', page: 1 }, confidence: 0.9, created_at: CREATED_AT },
    { id: 'fact-login', audit_id: AUDIT_ID, run_id: RUN_ID, fact_type: 'classroom.hasLogin', classification: 'OBSERVABLE', value: false, source_ref: { evidenceId: 'ev-1', artifactId: 'art-1', page: 2 }, confidence: 0.8, created_at: CREATED_AT },
    { id: 'fact-contact', audit_id: AUDIT_ID, run_id: RUN_ID, fact_type: 'contact.effectiveContact', classification: 'OBSERVABLE', value: false, source_ref: { evidenceId: 'ev-2', artifactId: 'art-2' }, confidence: 0.7, created_at: CREATED_AT },
  );
}

function review(row: FakeRow): FakeRow {
  return { id: `review-${row.fact_id}`, audit_id: AUDIT_ID, fact_id: 'fact-contact', decision: 'VALID', status: 'ACCEPTED', corrected_value: true, reviewed_by: ACTOR_ID, created_at: CREATED_AT, ...row };
}

function seedFrozenSnapshotRow(db: FoundationFakeDb, facts: unknown[]) {
  db.table('fact_run_frozen_snapshots').push({
    id: 'snapshot-1',
    audit_id: AUDIT_ID,
    fact_run_id: RUN_ID,
    facts,
    provenance: { schemaVersion: 'fact-run-frozen-snapshot-provenance-v1', origin: 'EXTRACTED', entries: [] },
    fact_reviews_snapshot: [],
    extractor_version: 'deterministic-facts-v1',
    policy_source_id: POLICY_SOURCE_ID,
    canonical_facts_fingerprint: 'c'.repeat(64),
    effective_facts_fingerprint: 'e'.repeat(64),
    fact_count: facts.length,
    integrity_hash: 'a'.repeat(64),
    frozen_by: ACTOR_ID,
    frozen_at: CREATED_AT,
    created_at: CREATED_AT,
  });
}

describe('detección de disponibilidad de la fundación de política', () => {
  it('reconoce AUSENCIA de objeto (PGRST202/205, 42P01, 42883, fake local) y no confunde negocio', () => {
    expect(isFoundationObjectMissing('freeze_fact_run_v1', { message: 'Unsupported rpc freeze_fact_run_v1' })).toBe(true);
    expect(isFoundationObjectMissing('freeze_fact_run_v1', missingFunctionError('freeze_fact_run_v1'))).toBe(true);
    expect(isFoundationObjectMissing('x', { message: `Could not find the table 'public.fact_run_frozen_snapshots' in the schema cache`, code: 'PGRST205' })).toBe(true);
    expect(isFoundationObjectMissing('x', { message: 'ERROR: relation "public.fact_run_frozen_snapshots" does not exist', code: '42P01' })).toBe(true);
    expect(isFoundationObjectMissing('x', { message: 'ERROR: column "x" does not exist', code: '42703' })).toBe(true);
    // Errores de NEGOCIO: no son ausencia. Confundirlos haría que un fallo de
    // autorización pareciera "funciona porque cayó al camino viejo".
    expect(isFoundationObjectMissing('freeze_fact_run_v1', { message: 'AUTH_REQUIRED' })).toBe(false);
    expect(isFoundationObjectMissing('freeze_fact_run_v1', { message: 'FACT_RUN_EMPTY' })).toBe(false);
    expect(isFoundationObjectMissing('freeze_fact_run_v1', { message: 'FORBIDDEN' })).toBe(false);
    expect(isFoundationObjectMissing('freeze_fact_run_v1', { message: 'POLICY_SOURCE_NOT_REGISTERED: x' })).toBe(false);
    expect(isFoundationObjectMissing('freeze_fact_run_v1', { message: 'JWT expired' })).toBe(false);
    expect(isFoundationObjectMissing('freeze_fact_run_v1', null)).toBe(false);
  });
});

// ============================================================================
// MEDICIÓN REAL — 2026-09-25
// ============================================================================
// Sonda de SOLO LECTURA contra el proyecto real de producción
// (`https://4pw4jdzv.us-west.insforge.app`) con el cliente que construye esta
// misma app (`createServerClient` de `@insforge/sdk/ssr`, baseUrl + anon key de
// `apps/web/.env`, camino anon-key). Los cuerpos de abajo son VERBATIM.
//
// CONTROL: `from('fact_extraction_runs').select('id').limit(1)` → HTTP 200, `[]`.
// Auth, conectividad y el camino de PostgREST funcionan, así que los tres
// errores siguientes son AUSENCIAS REALES y no una sonda que falla.
//
// Lo que fijan estos tests y por qué importa: `MISSING_OBJECT_PATTERNS` es la
// ÚNICA razón por la que producción no se rompe con la migración sin aplicar.
// Si un refactor deja de reconocer estas formas, el resultado NO es un test
// rojo: es un pipeline de evaluación caído en producción. Que falle aquí, no
// allí, es el objetivo.
//
// LÍMITE HONESTO: la sonda corrió por el camino anon-key, SIN sesión de
// usuario. La forma de una denegación RLS bajo sesión autenticada NO está
// medida. El caso `42501` de abajo es una GUARDA sobre la inferencia, no
// evidencia del backend real.

/**
 * Cuerpo de error tal y como lo entrega `@supabase/postgrest-js` al parsear la
 * respuesta cruda de PostgREST: un objeto PLANO, no una `InsForgeError`.
 */
type ObservedPostgrestError = {
  code: string;
  details: string | null;
  hint: string | null;
  message: string;
};

/** 1) TABLA ausente — `from('fact_run_frozen_snapshots').select(…).eq(…).limit(1)` → HTTP 404. */
const OBSERVED_MISSING_TABLE: ObservedPostgrestError = {
  code: '42P01',
  details: null,
  hint: null,
  message: 'relation "public.fact_run_frozen_snapshots" does not exist',
};

/** 2) COLUMNA ausente — `from('fact_extraction_runs').select('parent_fact_run_id')` → HTTP 400. */
const OBSERVED_MISSING_COLUMN: ObservedPostgrestError = {
  code: '42703',
  details: null,
  hint: null,
  message: 'column fact_extraction_runs.parent_fact_run_id does not exist',
};

/** 3) RPC ausente — `rpc('__probe__')` → HTTP 404. */
const OBSERVED_MISSING_RPC: ObservedPostgrestError = {
  code: 'PGRST202',
  details: 'Searched for the function public.__probe__ without parameters or with a single unnamed json/jsonb parameter, but no matches were found in the schema cache.',
  hint: null,
  message: 'Could not find the function public.__probe__ without parameters in the schema cache',
};

// Respuestas AUTORITATIVAS que NO son ausencia. Misma forma de cuerpo que los
// anteriores, porque llegan por el mismo camino; lo que las diferencia es que el
// objeto SÍ existe y el servidor tiene algo que decir.
const BUSINESS_AUTH_REQUIRED: ObservedPostgrestError = { code: 'P0001', details: null, hint: null, message: 'AUTH_REQUIRED' };
const BUSINESS_FORBIDDEN: ObservedPostgrestError = { code: 'P0001', details: null, hint: null, message: 'FORBIDDEN' };
const BUSINESS_FROZEN_SNAPSHOT_MISSING: ObservedPostgrestError = { code: 'P0001', details: null, hint: null, message: 'FROZEN_SNAPSHOT_MISSING' };
/** `PGRST116` NO está en `PGRST20[245]`: pedir 1 fila y recibir N no es ausencia. */
const OBSERVED_MULTIPLE_ROWS: ObservedPostgrestError = {
  code: 'PGRST116',
  details: 'Results contain 2 rows, application/vnd.pgrst.object+json requires 1 row',
  hint: null,
  message: 'JSON object requested, multiple (or no) rows returned',
};

interface ObservedReadErrorQuery {
  select(columns?: string): ObservedReadErrorQuery;
  eq(column: string, value: unknown): ObservedReadErrorQuery;
  order(column: string, options?: { ascending?: boolean }): ObservedReadErrorQuery;
  limit(count: number): Promise<{ data: null; error: ObservedPostgrestError }>;
  single(): Promise<{ data: null; error: ObservedPostgrestError }>;
}

/**
 * Inyección de error de LECTURA para un solo caso: una tabla responde con un
 * cuerpo REAL medido en vez de con el mensaje del fake.
 *
 * `foundation-fake-db.ts` NO se toca (fuera del alcance de esta corrección) y
 * ningún fake existente se debilita: esto no cambia `FoundationFakeDb`, sólo lo
 * envuelve y sustituye la respuesta de `fact_run_frozen_snapshots`. Delega todo
 * lo demás, para que el camino legacy siga calculando con datos de verdad.
 */
class ObservedReadErrorDb implements DatabaseClient {
  constructor(
    private readonly inner: FoundationFakeDb,
    private readonly error: ObservedPostgrestError,
  ) {}

  from(table: string) {
    if (table !== 'fact_run_frozen_snapshots') return this.inner.from(table);
    const error = this.error;
    const query: ObservedReadErrorQuery = {
      select: () => query,
      eq: () => query,
      order: () => query,
      limit: () => Promise.resolve({ data: null, error }),
      single: () => Promise.resolve({ data: null, error }),
    };
    return query;
  }

  rpc(fn: string, args: Record<string, unknown> = {}) {
    return this.inner.rpc(fn, args);
  }
}

describe('formas de objeto ausente MEDIDAS contra el backend real (2026-09-25)', () => {
  it('reconoce como AUSENCIA las tres formas observadas (42P01, 42703, PGRST202)', () => {
    expect(isFoundationObjectMissing('fact_run_frozen_snapshots', OBSERVED_MISSING_TABLE)).toBe(true);
    expect(isFoundationObjectMissing('fact_extraction_runs', OBSERVED_MISSING_COLUMN)).toBe(true);
    expect(isFoundationObjectMissing('__probe__', OBSERVED_MISSING_RPC)).toBe(true);
  });

  it('la forma medida es un objeto PLANO de @supabase/postgrest-js, no una InsForgeError', () => {
    // REGISTRO DE LA SONDA, no comportamiento productivo: lo que se congela
    // aquí es la FORMA que devolvió el backend, para que quede escrito por qué
    // `error.code` se lee en esta ruta. El razonamiento anterior de la cabecera
    // ("code siempre undefined") venía de mirar `InsForgeError`, que sólo usan
    // los caminos del SDK que NO son PostgREST. Si algún día estos cuerpos
    // cambian de forma, este test lo delata y obliga a remedir.
    for (const observed of [OBSERVED_MISSING_TABLE, OBSERVED_MISSING_COLUMN, OBSERVED_MISSING_RPC]) {
      expect(observed.constructor.name).toBe('Object');
      expect(Object.keys(observed)).toEqual(['code', 'details', 'hint', 'message']);
      expect(typeof observed.code).toBe('string');
      expect(observed.code.length).toBeGreaterThan(0);
    }
  });

  it('sin `code`, el mensaje de la TABLA ausente sigue casando: los patrones de message están vivos', () => {
    expect(isFoundationObjectMissing('fact_run_frozen_snapshots', { message: OBSERVED_MISSING_TABLE.message })).toBe(true);
  });

  it('sin `code`, el mensaje del RPC ausente sigue casando: los patrones de message están vivos', () => {
    expect(isFoundationObjectMissing('__probe__', { message: OBSERVED_MISSING_RPC.message })).toBe(true);
  });

  it('sin `code`, el mensaje de la COLUMNA ausente NO casa: lo lleva exclusivamente el 42703', () => {
    // Lo que es REALMENTE cierto, no lo que convendría. Postgres emite el
    // nombre de columna SIN comillas, así que `/column "[^"]+" does not
    // exist/i` no casa, y ningún otro patrón de `message` casa tampoco. Este
    // cuerpo lo reconoce el `code` `42703` y sólo el `code`. No se "arregla"
    // aquí: se documenta, para que nadie confunda message-cubre-todo con
    // "la detección es robusta por mensajes".
    expect(isFoundationObjectMissing('fact_extraction_runs', { message: OBSERVED_MISSING_COLUMN.message })).toBe(false);
    expect(isFoundationObjectMissing('fact_extraction_runs', { ...OBSERVED_MISSING_COLUMN, code: 'UNKNOWN_CODE' })).toBe(false);
  });

  it('AUSENCIA ≠ FALLO: los errores de negocio y de infraestructura NO degradan', () => {
    expect(isFoundationObjectMissing('persist_policy_evaluation_v1', BUSINESS_AUTH_REQUIRED)).toBe(false);
    expect(isFoundationObjectMissing('persist_policy_evaluation_v1', BUSINESS_FORBIDDEN)).toBe(false);
    expect(isFoundationObjectMissing('freeze_fact_run_v1', BUSINESS_FROZEN_SNAPSHOT_MISSING)).toBe(false);
    // PGRST116 = "results contain N rows" cuando se pidió un único objeto. Es
    // una respuesta autoritativa del servidor, no una ausencia: degradar aquí
    // devolvería un hecho inventado.
    expect(isFoundationObjectMissing('fact_run_frozen_snapshots', OBSERVED_MULTIPLE_ROWS)).toBe(false);
    // Denegación de permiso. INFERENCIA, NO MEDICIÓN: la sonda corrió por el
    // camino anon-key y no se observó ninguna denegación RLS. Lo medido es que
    // la forma que este repo asume para ella (`42501`) NO es ausencia, y este
    // test congela esa frontera para que nadie la afloje.
    expect(isFoundationObjectMissing('fact_run_frozen_snapshots', { code: '42501', message: 'permission denied for table fact_run_frozen_snapshots' })).toBe(false);
    // Fallo de red: no hay cuerpo, no hay código. Ante la duda se propaga.
    expect(isFoundationObjectMissing('fact_run_frozen_snapshots', { message: 'fetch failed' })).toBe(false);
    expect(isFoundationObjectMissing('fact_run_frozen_snapshots', null)).toBe(false);
  });

  it('el patrón MUERTO de columna no casa con el mensaje real (guarda de regresión)', () => {
    // MEDIDO: el patrón `/column "[^"]+" does not exist/i`, que sigue en
    // `MISSING_OBJECT_PATTERNS`, es INERTE contra el backend real porque las
    // comillas nunca aparecen. Se deja a propósito (el `code` 42703 ya resuelve),
    // pero quien intente "arreglarlo" tiene aquí la forma verdadera.
    const deadPattern = /column "[^"]+" does not exist/i;
    expect(deadPattern.test(OBSERVED_MISSING_COLUMN.message)).toBe(false);
    // El patrón en sí está bien construido: casa con la forma CON comillas. Lo
    // que no existe en producción es esa forma.
    expect(deadPattern.test('ERROR: column "fact_extraction_runs.parent_fact_run_id" does not exist')).toBe(true);
  });

  it('con el cuerpo REAL de tabla ausente degrada sin lanzar y avisa (readFrozenSnapshot)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const inner = new FoundationFakeDb();
    seedRun(inner);
    seedFacts(inner);
    inner.table('fact_reviews').push(review({ fact_id: 'fact-contact' }));
    const db = new ObservedReadErrorDb(inner, OBSERVED_MISSING_TABLE);

    // Si `readFrozenSnapshot` LANZARA —como afirmaba la cabecera antes de la
    // medición— esta línea reventaría el test con el mensaje real de InsForge.
    const result = await getFrozenEffectiveFacts({ database: db, auditId: AUDIT_ID, factRunId: RUN_ID, run: frozenRun });

    expect(result.source).toBe('LEGACY_REVIEW_APPLIED');
    expect(result.degradation).toBe('FROZEN_SNAPSHOT_TABLE_ABSENT');
    expect(result.persistenceError).toBeNull();
    expect(result.persisted).toBe(false);
    expect(result.snapshotId).toBeNull();
    // El cálculo sigue siendo el de HOY: los tres hechos, con la review
    // retrospective aplicada. Degradar no puede cambiar el resultado.
    expect(result.facts.map((fact) => fact.id)).toEqual(['fact-level', 'fact-login', 'fact-contact']);
    expect(result.facts.find((fact) => fact.id === 'fact-contact')?.value).toBe(true);
    // La degradación NO es silenciosa: código estable grepable.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('FROZEN_SNAPSHOT_TABLE_ABSENT'));
    // Y no intenta sellar nada sobre una tabla que no existe.
    expect(inner.writesOn('fact_run_frozen_snapshots')).toEqual([]);
    warn.mockRestore();
  });
});

describe('getFrozenEffectiveFacts — snapshot congelado (R-8)', () => {
  it('lee los hechos del snapshot y NO vuelve a consultar fact_reviews', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    seedRun(db);
    seedFacts(db);
    db.table('fact_reviews').push(review({ fact_id: 'fact-contact' }));
    seedFrozenSnapshotRow(db, [
      { id: 'fact-level', type: 'student.level', value: 'LICENCIATURA', source: { evidenceId: 'ev-1', artifactId: 'art-1', page: 1 }, extractionConfidence: 0.9 },
      { id: 'fact-login', type: 'classroom.hasLogin', value: false, source: { evidenceId: 'ev-1', artifactId: 'art-1', page: 2 }, extractionConfidence: 0.8 },
      { id: 'fact-contact', type: 'contact.effectiveContact', value: false, source: { evidenceId: 'ev-2', artifactId: 'art-2' }, extractionConfidence: 0.7 },
    ]);

    const result = await getFrozenEffectiveFacts({ database: db, auditId: AUDIT_ID, factRunId: RUN_ID, run: frozenRun });

    expect(result.source).toBe('SNAPSHOT');
    expect(result.persisted).toBe(true);
    expect(result.snapshotId).toBe('snapshot-1');
    // La revisión humana existe en la base y NO se aplicó retrospectivamente:
    // ése es exactamente el corte de R-8.
    expect(db.readCount('fact_reviews')).toBe(0);
    expect(result.facts.map((fact) => [fact.id, fact.value])).toEqual([
      ['fact-level', 'LICENCIATURA'],
      ['fact-login', false],
      ['fact-contact', false],
    ]);
    expect(result.effectiveFactsFingerprint).toBe('e'.repeat(64));
  });

  it('segunda lectura con snapshot y con review nueva devuelve el MISMO hecho y la MISMA huella', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    seedRun(db);
    seedFrozenSnapshotRow(db, [{ id: 'fact-contact', type: 'contact.effectiveContact', value: false, source: { evidenceId: 'ev-2' } }]);

    const first = await getFrozenEffectiveFacts({ database: db, auditId: AUDIT_ID, factRunId: RUN_ID, run: frozenRun });
    db.table('fact_reviews').push(review({ fact_id: 'fact-contact', corrected_value: true, created_at: '2026-09-26T00:00:00.000Z' }));
    const second = await getFrozenEffectiveFacts({ database: db, auditId: AUDIT_ID, factRunId: RUN_ID, run: frozenRun });

    expect(second.facts).toEqual(first.facts);
    expect(second.effectiveFactsFingerprint).toBe(first.effectiveFactsFingerprint);
  });

  it('rechaza un snapshot con forma inválida en vez de producir hechos silenciosamente distintos', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    seedRun(db);
    seedFrozenSnapshotRow(db, 'no-es-un-array' as unknown as unknown[]);

    await expect(getFrozenEffectiveFacts({ database: db, auditId: AUDIT_ID, factRunId: RUN_ID, run: frozenRun })).rejects.toThrow('FROZEN_SNAPSHOT_PAYLOAD_INVALID');
  });
});

describe('getFrozenEffectiveFacts — captura única del run legacy (Step 1/2)', () => {
  it('captura UNA vez, marca IMPORTED/HUMAN, persiste y la segunda llamada no cambia', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    seedRun(db);
    seedFacts(db);
    db.table('fact_reviews').push(review({ fact_id: 'fact-contact' }));

    const first = await getFrozenEffectiveFacts({ database: db, auditId: AUDIT_ID, factRunId: RUN_ID, run: frozenRun });

    expect(first.source).toBe('LEGACY_CAPTURED');
    expect(first.persisted).toBe(true);
    expect(first.snapshotId).not.toBeNull();
    // provenance: objeto (CHECK del servidor) con `entries` (el array que el
    // plan inspecciona con .some()).
    const provenance = first.provenance;
    expect(provenance).not.toBeNull();
    expect(provenance!.origin).toBe('IMPORTED');
    expect(provenance!.entries.some((entry) => entry.extractionMethod === 'HUMAN' && entry.factId === 'fact-contact')).toBe(true);
    expect(provenance!.entries.every((entry) => entry.factId !== 'fact-level' || entry.extractionMethod === 'IMPORTED')).toBe(true);
    expect(db.rows('fact_run_frozen_snapshots')).toHaveLength(1);
    expect(String(db.rows('fact_run_frozen_snapshots')[0].integrity_hash)).toMatch(/^[a-f0-9]{64}$/);

    // Se añade una review nueva: la captura ya sellada no se toca.
    db.table('fact_reviews').push(review({ fact_id: 'fact-login', corrected_value: true, created_at: '2026-09-26T00:00:00.000Z' }));
    const second = await getFrozenEffectiveFacts({ database: db, auditId: AUDIT_ID, factRunId: RUN_ID, run: frozenRun });

    expect(second.source).toBe('SNAPSHOT');
    expect(second.facts).toEqual(first.facts);
    expect(stableFingerprint(second.facts)).toBe(stableFingerprint(first.facts));
    expect(db.rows('fact_run_frozen_snapshots')).toHaveLength(1);
  });

  it('el primer cálculo es byte-equivalente al comportamiento de hoy (INVALID filtra, corrected_value sustituye)', async () => {
    const db = new FoundationFakeDb();
    seedRun(db);
    seedFacts(db);
    db.table('fact_reviews').push(
      review({ fact_id: 'fact-contact', corrected_value: true }),
      review({ fact_id: 'fact-login', decision: 'INVALID', corrected_value: null, created_at: '2026-09-25T01:00:00.000Z' }),
    );

    const result = await getFrozenEffectiveFacts({ database: db, auditId: AUDIT_ID, factRunId: RUN_ID, run: frozenRun });

    // Orden y valores idénticos a `mapStoredFactsToPolicyFacts(facts)` + el map
    // de `corrected_value` que hacía evaluation.ts antes de esta tarea.
    expect(result.facts).toEqual([
      { id: 'fact-level', type: 'student.level', value: 'LICENCIATURA', source: { evidenceId: 'ev-1', artifactId: 'art-1', page: 1 }, extractionConfidence: 0.9 },
      { id: 'fact-contact', type: 'contact.effectiveContact', value: true, source: { evidenceId: 'ev-2', artifactId: 'art-2' }, extractionConfidence: 0.7 },
    ]);
  });

  it('con la tabla ausente degrada al cálculo de hoy, lo avisa y no escribe nada', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = new FoundationFakeDb();
    seedRun(db);
    seedFacts(db);
    db.table('fact_reviews').push(review({ fact_id: 'fact-contact' }));

    const result = await getFrozenEffectiveFacts({ database: db, auditId: AUDIT_ID, factRunId: RUN_ID, run: frozenRun });

    expect(result.source).toBe('LEGACY_REVIEW_APPLIED');
    expect(result.persisted).toBe(false);
    expect(result.snapshotId).toBeNull();
    expect(result.degradation).toBe('FROZEN_SNAPSHOT_TABLE_ABSENT');
    expect(result.facts.map((fact) => fact.id)).toEqual(['fact-level', 'fact-login', 'fact-contact']);
    expect(result.facts.find((fact) => fact.id === 'fact-contact')?.value).toBe(true);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('FROZEN_SNAPSHOT_TABLE_ABSENT'));
    expect(db.writesOn('fact_run_frozen_snapshots')).toEqual([]);
    warn.mockRestore();
  });

  it('si la captura no se puede persistir lo dice con un código estable y devuelve el cálculo de hoy', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // Mundo "con migración": la tabla existe pero su INSERT está revocado. El
    // error 42501 NO es ausencia de objeto, así que no puede degradarse en
    // silencio: se avisa y se devuelve el cálculo correcto de todos modos.
    const db = new FoundationFakeDb().withFoundationApplied().withSnapshotInsertRevoked();
    seedRun(db);
    seedFacts(db);

    const result = await getFrozenEffectiveFacts({ database: db, auditId: AUDIT_ID, factRunId: RUN_ID, run: frozenRun });

    expect(result.source).toBe('LEGACY_CAPTURED');
    expect(result.persisted).toBe(false);
    expect(result.degradation).toBe('FROZEN_SNAPSHOT_CAPTURE_NOT_PERSISTED');
    expect(result.persistenceError).toMatch(/permission denied/);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('FROZEN_SNAPSHOT_CAPTURE_NOT_PERSISTED'));
    expect(result.facts).toHaveLength(3);
    warn.mockRestore();
  });
});

describe('freezeFactRunWithSnapshot — RPC y degradación (C1 / Step 7)', () => {
  it('con el RPC disponible sella por freeze_fact_run_v1 y NO hace UPDATE directo del estado', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    seedRun(db, 'PROCESSING');
    seedFacts(db);
    db.onRpc('freeze_fact_run_v1', () => ({
      data: [{ out_snapshot_id: 'snapshot-1', out_fact_run_id: RUN_ID, out_audit_id: AUDIT_ID, out_canonical_facts_fingerprint: 'c'.repeat(64), out_effective_facts_fingerprint: 'e'.repeat(64), out_fact_count: 3, out_frozen_at: CREATED_AT }],
      error: null,
    }));

    const result = await freezeFactRunWithSnapshot({ database: db, factRunId: RUN_ID, actorId: ACTOR_ID, policySourceId: POLICY_SOURCE_ID });

    expect(result.transport).toBe('RPC');
    expect(result.state).toBe('FROZEN');
    expect(result.snapshotId).toBe('snapshot-1');
    expect(result.factCount).toBe(3);
    const call = db.rpcCalls.find((entry) => entry.fn === 'freeze_fact_run_v1');
    expect(call).toBeDefined();
    const args = call!.args;
    expect(args.p_fact_run_id).toBe(RUN_ID);
    expect(args.p_policy_source_id).toBe(POLICY_SOURCE_ID);
    expect(Array.isArray(args.p_facts)).toBe(true);
    expect(String(args.p_canonical_facts_fingerprint)).toMatch(/^[a-f0-9]{64}$/);
    expect(String(args.p_effective_facts_fingerprint)).toMatch(/^[a-f0-9]{64}$/);
    expect((args.p_provenance as { origin: string }).origin).toBe('EXTRACTED');
    expect(Array.isArray(args.p_fact_reviews_snapshot)).toBe(true);
    expect(db.writesOn('fact_extraction_runs')).toEqual([]);
  });

  it('sin RPC recorre la máquina de estados legal (PROCESSING -> FROZEN) y avisa con código estable', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = new FoundationFakeDb();
    seedRun(db, 'PROCESSING');
    seedFacts(db);

    const result = await freezeFactRunWithSnapshot({ database: db, factRunId: RUN_ID, actorId: ACTOR_ID, policySourceId: POLICY_SOURCE_ID });

    expect(result.transport).toBe('LEGACY_STATE_WALK');
    expect(result.state).toBe('FROZEN');
    expect(result.snapshotId).toBeNull();
    expect(result.degradation).toBe('FREEZE_FACT_RUN_RPC_ABSENT');
    expect(db.rows('fact_extraction_runs')[0]).toMatchObject({ state: 'FROZEN' });
    expect(db.writesOn('fact_extraction_runs').map((write) => (write.values[0] as { state: string }).state)).toEqual(['FROZEN']);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('FREEZE_FACT_RUN_RPC_ABSENT'));
    warn.mockRestore();
  });

  it('sin RPC y con el run en DRAFT camina DRAFT -> PROCESSING -> FROZEN (transición simple prohibida por el guard)', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = new FoundationFakeDb();
    seedRun(db, 'DRAFT');
    seedFacts(db);

    const result = await freezeFactRunWithSnapshot({ database: db, factRunId: RUN_ID, actorId: ACTOR_ID, policySourceId: POLICY_SOURCE_ID });

    expect(result.transport).toBe('LEGACY_STATE_WALK');
    expect(db.writesOn('fact_extraction_runs').map((write) => (write.values[0] as { state: string }).state)).toEqual(['PROCESSING', 'FROZEN']);
    vi.restoreAllMocks();
  });

  it('un error REAL del RPC se propaga: no degrada a un update que sí escribiría', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    seedRun(db, 'PROCESSING');
    seedFacts(db);
    db.onRpc('freeze_fact_run_v1', () => ({ data: null, error: { message: 'FACT_RUN_EMPTY' } }));

    await expect(freezeFactRunWithSnapshot({ database: db, factRunId: RUN_ID, actorId: ACTOR_ID, policySourceId: POLICY_SOURCE_ID })).rejects.toThrow('FACT_RUN_EMPTY');
    expect(db.writesOn('fact_extraction_runs')).toEqual([]);
  });

  it('rechaza congelar un run sin hechos en vez de sellar un snapshot vacío', async () => {
    const db = new FoundationFakeDb().withFoundationApplied();
    seedRun(db, 'PROCESSING');

    await expect(freezeFactRunWithSnapshot({ database: db, factRunId: RUN_ID, actorId: ACTOR_ID, policySourceId: POLICY_SOURCE_ID })).rejects.toThrow('FACT_RUN_EMPTY');
  });
});
