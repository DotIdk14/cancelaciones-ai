import { createHash } from 'node:crypto';
import { createFactRepository, type DatabaseClient, type FactExtractionRun, type StoredFact } from '@cancelaciones/db';
import { stableFingerprint } from '@cancelaciones/domain';
import type { Fact } from '@cancelaciones/policy-engine';
import { mapSnapshotFactsToPolicyFacts, mapStoredFactsToPolicyFacts } from '@/server/policy/frozen-fact-run';
import { isFoundationObjectMissing, warnFoundationDegradation, type FoundationErrorLike } from './foundation-objects';

export { isFoundationObjectMissing } from './foundation-objects';

/**
 * ============================================================================
 * CONGELADO DE HECHOS EFECTIVOS (Task 10, Steps 1, 2 y 7)
 * ============================================================================
 *
 * QUÉ RESUELVE
 * Un Fact Run FROZEN tiene hoy dos fuentes de verdad que se contradicen: la tabla
 * `facts` (inmutable en la práctica) y `fact_reviews` (append-only, growing).
 * `evaluation.ts` aplicaba las reviews retrospectivamente en cada evaluación, así
 * que adding una review cambiaba retroactivamente el outcome de una evaluación
 * ya registrada. Eso contradice PRESERVE_MACHINE_DECISION y TRACE_EVERY_DECISION.
 *
 * Este módulo introduce `fact_run_frozen_snapshots` como la única fuente de los
 * hechos que verá el motor normativo, y `freeze_fact_run_v1` como la única vía
 * de escritura.
 *
 * ============================================================================
 * R-8: LA PUERTA QUE PROTEGE LOS OUTCOMES
 * ============================================================================
 * Aplicar correcciones humanas SÓLO es correcto si ya existe un snapshot
 * sellado. Sin snapshot, `getFrozenEffectiveFacts` devuelve EXACTAMENTE lo que
 * devolvía `evaluation.ts` antes de esta tarea (mismo orden, mismo filtrado de
 * `INVALID`, misma sustitución de `corrected_value`), para que el primer cálculo
 * sea byte-equivalente y NINGÚN outcome cambie. La eliminación de la
 * aplicación retrospectiva de reviews ocurre únicamente cuando el snapshot
 * existe, y por eso sólo puede pasar después de aplicar la migración.
 *
 * ============================================================================
 * R-3 / C1: LA MIGRACIÓN TODAVÍA NO ESTÁ APLICADA
 * ============================================================================
 * `freeze_fact_run_v1` y `fact_run_frozen_snapshots` no existen en ninguna base
 * de datos real. Cada camino de este módulo DETECTA la ausencia y degrada al
 * comportamiento de HOY, con un aviso de código estable. Un error de negocio
 * del RPC nunca degrada: se propaga.
 */

/** Snapshot de una revisión humana tal como estaba en el instante del sellado. */
export interface FrozenFactReviewRecord {
  reviewId: string | null;
  factId: string;
  decision: 'VALID' | 'INVALID' | string;
  correctedValue: unknown;
  reviewedBy: string | null;
  createdAt: string;
}

export type FactExtractionMethod = 'AI' | 'HUMAN' | 'IMPORTED' | 'UNKNOWN';
export type FactProvenanceOrigin = 'EXTRACTED' | 'IMPORTED' | 'HUMAN_CORRECTION';

export interface FactProvenanceEntry {
  factId: string;
  factType: string;
  /** `HUMAN` para un hecho corregido o confirmado por una persona. */
  extractionMethod: FactExtractionMethod;
  origin: FactProvenanceOrigin;
  reviewId: string | null;
  corrected: boolean;
}

/**
 * `provenance` es un OBJETO porque el servidor lo valida con
 * `jsonb_typeof(provenance) = 'object'` (migración, §5). Los entries viven
 * dentro de `entries`; el plan los inspecciona como array (`.some(...)`).
 */
export interface FactRunProvenance {
  schemaVersion: 'fact-run-frozen-snapshot-provenance-v1';
  origin: FactProvenanceOrigin;
  extractorVersion: string;
  policySourceId: string;
  capturedAt: string;
  entries: FactProvenanceEntry[];
}

export type FrozenFactsSource = 'SNAPSHOT' | 'LEGACY_CAPTURED' | 'LEGACY_REVIEW_APPLIED';

export interface FrozenEffectiveFacts {
  /**
   * EXACTAMENTE el array que se entrega a `evaluatePolicy`. Es la razón de que
   * `evaluation.factsFingerprint` no pueda moverse: mismo array, misma huella.
   */
  facts: Fact[];
  source: FrozenFactsSource;
  /** `true` si el resultado quedó durable en `fact_run_frozen_snapshots`. */
  persisted: boolean;
  snapshotId: string | null;
  canonicalFactsFingerprint: string;
  effectiveFactsFingerprint: string;
  provenance: FactRunProvenance | null;
  factReviews: FrozenFactReviewRecord[];
  /** Código estable de degradación, o `null` si no hubo ninguna. */
  degradation: string | null;
  /** Detalle del error que impidió persistir la captura, si lo hubo. */
  persistenceError: string | null;
}

const FROZEN_SNAPSHOT_TABLE = 'fact_run_frozen_snapshots';
const SNAPSHOT_COLUMNS = 'id,audit_id,fact_run_id,facts,provenance,fact_reviews_snapshot,extractor_version,policy_source_id,canonical_facts_fingerprint,effective_facts_fingerprint,fact_count,integrity_hash,frozen_at,created_at';
const REVIEW_COLUMNS = 'id,fact_id,decision,corrected_value,reviewed_by,created_at';

export const FREEZE_FACT_RUN_RPC = 'freeze_fact_run_v1';
export const DERIVE_FACT_RUN_RPC = 'create_derived_fact_run_v1';
export const PERSIST_POLICY_EVALUATION_RPC = 'persist_policy_evaluation_v1';

export const DEGRADATION_FROZEN_SNAPSHOT_TABLE_ABSENT = 'FROZEN_SNAPSHOT_TABLE_ABSENT';
export const DEGRADATION_CAPTURE_NOT_PERSISTED = 'FROZEN_SNAPSHOT_CAPTURE_NOT_PERSISTED';
export const DEGRADATION_FREEZE_RPC_ABSENT = 'FREEZE_FACT_RUN_RPC_ABSENT';
export const DEGRADATION_DERIVE_RPC_ABSENT = 'DERIVE_FACT_RUN_RPC_ABSENT';
export const DEGRADATION_FINGERPRINT_COLUMN_ABSENT = 'DERIVED_FACT_RUN_FINGERPRINT_COLUMN_ABSENT';
export const DEGRADATION_PERSIST_RPC_ABSENT = 'PERSIST_POLICY_EVALUATION_RPC_ABSENT';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

function snapshotProvenance(value: unknown): FactRunProvenance | null {
  if (typeof value !== 'object' || value === null) return null;
  const record = value as { origin?: unknown; extractorVersion?: unknown; policySourceId?: unknown; capturedAt?: unknown; entries?: unknown };
  return {
    schemaVersion: 'fact-run-frozen-snapshot-provenance-v1',
    origin: (record.origin as FactProvenanceOrigin) ?? 'EXTRACTED',
    extractorVersion: typeof record.extractorVersion === 'string' ? record.extractorVersion : '',
    policySourceId: typeof record.policySourceId === 'string' ? record.policySourceId : '',
    capturedAt: typeof record.capturedAt === 'string' ? record.capturedAt : '',
    entries: Array.isArray(record.entries) ? (record.entries as FactProvenanceEntry[]) : [],
  };
}

function readErrorMessage(error: FoundationErrorLike | null): string {
  return typeof error?.message === 'string' ? error.message : 'error desconocido';
}

/**
 * Lee las revisiones humanas de una auditoría y devuelve, por hecho, SÓLO la
 * más reciente. Es la consulta EXACTA que hacía `evaluation.ts` (misma
 * selección, mismo orden descendente por `created_at`) para que la ruta legacy
 * produzca un resultado byte-idéntico.
 */
export async function readLatestFactReviews(input: { database: DatabaseClient; auditId: string }): Promise<{ reviews: FrozenFactReviewRecord[]; latestByFact: Map<string, FrozenFactReviewRecord> }> {
  const result = await input.database.from('fact_reviews').select(REVIEW_COLUMNS).eq('audit_id', input.auditId).order('created_at', { ascending: false });
  if (result.error) throw new Error(result.error.message ?? 'FACT_REVIEWS_READ_FAILED');
  const reviews: FrozenFactReviewRecord[] = (result.data ?? []).map((row: { id?: unknown; fact_id: unknown; decision: unknown; corrected_value?: unknown; reviewed_by?: unknown; created_at: unknown }) => ({
    reviewId: row.id ? String(row.id) : null,
    factId: String(row.fact_id),
    decision: String(row.decision),
    correctedValue: row.corrected_value ?? null,
    reviewedBy: row.reviewed_by ? String(row.reviewed_by) : null,
    createdAt: String(row.created_at ?? ''),
  }));
  const latestByFact = new Map<string, FrozenFactReviewRecord>();
  for (const review of reviews) if (!latestByFact.has(review.factId)) latestByFact.set(review.factId, review);
  return { reviews, latestByFact };
}

/**
 * Aplica las revisiones humanas sobre los hechos mapeados. Es la MISMA
 * operación, en el MISMO orden, que el código original de `evaluation.ts`
 * (líneas 37-43 antes de esta tarea): primero se descarta lo `INVALID`, después
 * se sustituye `value` por `corrected_value`. Cambiar este orden cambiaría el
 * `factsFingerprint` y, con él, la identidad del engine run.
 */
export function applyLatestFactReviews(facts: Fact[], latestByFact: Map<string, FrozenFactReviewRecord>): Fact[] {
  return facts
    .filter((fact) => latestByFact.get(fact.id)?.decision !== 'INVALID')
    .map((fact) => {
      const review = latestByFact.get(fact.id);
      if (!review || review.correctedValue === null || review.correctedValue === undefined) return fact;
      return { ...fact, value: review.correctedValue };
    });
}

function buildProvenance(input: {
  origin: FactProvenanceOrigin;
  extractorVersion: string;
  policySourceId: string;
  capturedAt: string;
  facts: Fact[];
  reviews: Map<string, FrozenFactReviewRecord>;
}): FactRunProvenance {
  return {
    schemaVersion: 'fact-run-frozen-snapshot-provenance-v1',
    origin: input.origin,
    extractorVersion: input.extractorVersion,
    policySourceId: input.policySourceId,
    capturedAt: input.capturedAt,
    entries: input.facts.map((fact) => {
      const review = input.reviews.get(fact.id);
      const corrected = review != null && review.correctedValue !== null && review.correctedValue !== undefined;
      return {
        factId: fact.id,
        factType: fact.type,
        extractionMethod: review ? 'HUMAN' : input.origin === 'EXTRACTED' ? 'AI' : 'IMPORTED',
        origin: input.origin,
        reviewId: null,
        corrected,
      };
    }),
  };
}

async function readFrozenSnapshot(database: DatabaseClient, factRunId: string): Promise<{ row: Record<string, unknown> | null; tableAbsent: boolean }> {
  const result = await database.from(FROZEN_SNAPSHOT_TABLE).select(SNAPSHOT_COLUMNS).eq('fact_run_id', factRunId).limit(1);
  if (result.error) {
    if (isFoundationObjectMissing(FROZEN_SNAPSHOT_TABLE, result.error)) return { row: null, tableAbsent: true };
    throw new Error(result.error.message ?? 'FROZEN_SNAPSHOT_READ_FAILED');
  }
  const row = (result.data ?? [])[0];
  return { row: row ? (row as Record<string, unknown>) : null, tableAbsent: false };
}

/**
 * Persiste la captura de un run legacy. Es MEJOR ESFUERZO deliberado: el
 * cálculo de `facts` ya es correcto y correcto sin persistir, así que un
 * `INSERT` rehusado no puede romper el pipeline — pero tampoco puede pasar
 * desapercibido. Se avisa con un código estable y el motivo travels en
 * `persistenceError`.
 */
async function persistLegacyCapture(input: {
  database: DatabaseClient;
  auditId: string;
  factRunId: string;
  facts: Fact[];
  canonicalFactsFingerprint: string;
  effectiveFactsFingerprint: string;
  provenance: FactRunProvenance;
  factReviews: FrozenFactReviewRecord[];
  capturedAt: string;
}): Promise<{ snapshotId: string | null; error: string | null }> {
  const integrityHash = sha256(stableFingerprint({
    auditId: input.auditId,
    factRunId: input.factRunId,
    extractorVersion: input.provenance.extractorVersion,
    policySourceId: input.provenance.policySourceId,
    canonicalFingerprint: input.canonicalFactsFingerprint,
    effectiveFingerprint: input.effectiveFactsFingerprint,
    facts: input.facts,
    provenance: input.provenance,
    factReviews: input.factReviews,
  }));
  const inserted = await input.database.from(FROZEN_SNAPSHOT_TABLE).insert([{
    audit_id: input.auditId,
    fact_run_id: input.factRunId,
    facts: input.facts,
    provenance: input.provenance,
    fact_reviews_snapshot: input.factReviews,
    extractor_version: input.provenance.extractorVersion,
    policy_source_id: input.provenance.policySourceId,
    canonical_facts_fingerprint: input.canonicalFactsFingerprint,
    effective_facts_fingerprint: input.effectiveFactsFingerprint,
    fact_count: input.facts.length,
    integrity_hash: integrityHash,
    frozen_at: input.capturedAt,
  }]).select('id').single();
  if (inserted.error || !inserted.data) return { snapshotId: null, error: readErrorMessage(inserted.error) };
  return { snapshotId: String(inserted.data.id), error: null };
}

/**
 * ============================================================================
 * Hechos efectivos de un Fact Run FROZEN.
 * ============================================================================
 * Tres salidas, en este orden de preferencia:
 *
 *  1. `SNAPSHOT` — hay snapshot sellado: se leen sus hechos y NO se consulta
 *     `fact_reviews`. Es el corte de R-8.
 *  2. `LEGACY_CAPTURED` — hay tabla pero el run no tiene snapshot: se captura
 *     UNA vez el estado actual (facts + reviews) y se persiste. La segunda
 *     llamada devuelve el mismo snapshot aunque se añada otra review.
 *  3. `LEGACY_REVIEW_APPLIED` — la tabla no existe: exactamente el
 *     comportamiento previo, con aviso de código estable.
 */
export async function getFrozenEffectiveFacts(input: {
  database: DatabaseClient;
  auditId: string;
  factRunId: string;
  run: FactExtractionRun;
  policySourceId?: string;
}): Promise<FrozenEffectiveFacts> {
  const snapshot = await readFrozenSnapshot(input.database, input.factRunId);

  if (snapshot.row) {
    return {
      facts: mapSnapshotFactsToPolicyFacts(snapshot.row.facts),
      source: 'SNAPSHOT',
      persisted: true,
      snapshotId: String(snapshot.row.id),
      canonicalFactsFingerprint: String(snapshot.row.canonical_facts_fingerprint ?? ''),
      effectiveFactsFingerprint: String(snapshot.row.effective_facts_fingerprint ?? ''),
      provenance: snapshotProvenance(snapshot.row.provenance),
      factReviews: Array.isArray(snapshot.row.fact_reviews_snapshot) ? (snapshot.row.fact_reviews_snapshot as FrozenFactReviewRecord[]) : [],
      degradation: null,
      persistenceError: null,
    };
  }

  // ---- Camino legacy: el cálculo NO cambia respecto a evaluation.ts ----
  const storedFacts: StoredFact[] = await createFactRepository(input.database).listFactsByRun(input.factRunId);
  const canonicalFacts = mapStoredFactsToPolicyFacts(storedFacts);
  const { reviews, latestByFact } = await readLatestFactReviews({ database: input.database, auditId: input.auditId });
  const effectiveFacts = applyLatestFactReviews(canonicalFacts, latestByFact);
  const canonicalFactsFingerprint = sha256(stableFingerprint(canonicalFacts));
  const effectiveFactsFingerprint = sha256(stableFingerprint(effectiveFacts));

  if (snapshot.tableAbsent) {
    warnFoundationDegradation(
      DEGRADATION_FROZEN_SNAPSHOT_TABLE_ABSENT,
      `La tabla ${FROZEN_SNAPSHOT_TABLE} no existe: auditoría ${input.auditId}, Fact Run ${input.factRunId}. Se recalcula con el comportamiento previo (facts + reviews en vivo). Aplique la migración 20260925120000_policy-foundation-immutability.sql para sellar los hechos.`,
    );
    return {
      facts: effectiveFacts,
      source: 'LEGACY_REVIEW_APPLIED',
      persisted: false,
      snapshotId: null,
      canonicalFactsFingerprint,
      effectiveFactsFingerprint,
      provenance: null,
      factReviews: reviews,
      degradation: DEGRADATION_FROZEN_SNAPSHOT_TABLE_ABSENT,
      persistenceError: null,
    };
  }

  const capturedAt = input.run.frozenAt ?? new Date().toISOString();
  const provenance = buildProvenance({
    origin: 'IMPORTED',
    extractorVersion: input.run.extractorVersion,
    policySourceId: input.policySourceId ?? 'UNKNOWN',
    capturedAt,
    facts: effectiveFacts,
    reviews: latestByFact,
  });
  const persisted = await persistLegacyCapture({
    database: input.database,
    auditId: input.auditId,
    factRunId: input.factRunId,
    facts: effectiveFacts,
    canonicalFactsFingerprint,
    effectiveFactsFingerprint,
    provenance,
    factReviews: reviews,
    capturedAt,
  });

  if (!persisted.snapshotId) {
    warnFoundationDegradation(
      DEGRADATION_CAPTURE_NOT_PERSISTED,
      `No fue posible sellar la captura del Fact Run ${input.factRunId} (auditoría ${input.auditId}): ${persisted.error}. El cálculo de esta evaluación es correcto, pero mientras no haya snapshot las revisiones humanas siguen aplicándose en vivo.`,
    );
  }

  return {
    facts: effectiveFacts,
    source: 'LEGACY_CAPTURED',
    persisted: Boolean(persisted.snapshotId),
    snapshotId: persisted.snapshotId,
    canonicalFactsFingerprint,
    effectiveFactsFingerprint,
    provenance,
    factReviews: reviews,
    degradation: persisted.snapshotId ? null : DEGRADATION_CAPTURE_NOT_PERSISTED,
    persistenceError: persisted.error,
  };
}

export interface FreezeFactRunResult {
  factRunId: string;
  state: 'FROZEN';
  frozenAt: string;
  snapshotId: string | null;
  canonicalFactsFingerprint: string;
  effectiveFactsFingerprint: string;
  factCount: number;
  transport: 'RPC' | 'LEGACY_STATE_WALK';
  degradation: string | null;
}

interface FreezeRpcRow {
  out_snapshot_id?: unknown;
  out_fact_run_id?: unknown;
  out_canonical_facts_fingerprint?: unknown;
  out_effective_facts_fingerprint?: unknown;
  out_fact_count?: unknown;
  out_frozen_at?: unknown;
}

/**
 * ============================================================================
 * Freeze de un Fact Run con snapshot atómico (Step 7 / C1)
 * ============================================================================
 * Camino preferente: `freeze_fact_run_v1`, que en UNA transacción valida al
 * actor, exige el run en PROCESSING, sella el snapshot con el `integrity_hash`
 * calculado EN EL SERVIDOR y pasa el run a FROZEN. El hash lo calcula el
 * servidor a propósito: si el llamador mandara el suyo, podría sellar un
 * snapshot cuyo hash no corresponde a sus bytes.
 *
 * Degradación (R-3): si el RPC no existe, se recorre la máquina de estados
 * LEGAL — DRAFT -> PROCESSING -> FROZEN — con dos `UPDATE`. El paso único
 * DRAFT -> FROZEN que hacía `packages/db` antes queda PROHIBIDO por
 * `guard_fact_run_transition`, y encadenarlo también es lo correcto para la
 * base sin migración.
 *
 * Un error de NEGOCIO del RPC (`FACT_RUN_EMPTY`, `AUTH_REQUIRED`, `FORBIDDEN`,
 * `POLICY_SOURCE_NOT_REGISTERED`...) se propaga: degradar ahí escribiría un
 * FROZEN sin snapshot y sin motivo registrado.
 */
export async function freezeFactRunWithSnapshot(input: {
  database: DatabaseClient;
  factRunId: string;
  actorId: string;
  policySourceId: string;
  run?: FactExtractionRun;
}): Promise<FreezeFactRunResult> {
  const factsRepo = createFactRepository(input.database);
  const run = input.run ?? await factsRepo.findRunById(input.factRunId);
  if (!run) throw new Error('FACT_RUN_NOT_FOUND');
  if (run.state === 'FROZEN') {
    return { factRunId: run.id, state: 'FROZEN', frozenAt: run.frozenAt ?? new Date().toISOString(), snapshotId: null, canonicalFactsFingerprint: '', effectiveFactsFingerprint: '', factCount: 0, transport: 'LEGACY_STATE_WALK', degradation: null };
  }

  const storedFacts = await factsRepo.listFactsByRun(run.id);
  if (storedFacts.length === 0) throw new Error('FACT_RUN_EMPTY');
  const canonicalFacts = mapStoredFactsToPolicyFacts(storedFacts);
  const { reviews, latestByFact } = await readLatestFactReviews({ database: input.database, auditId: run.auditId });
  const effectiveFacts = applyLatestFactReviews(canonicalFacts, latestByFact);
  if (effectiveFacts.length === 0) throw new Error('FACT_RUN_EMPTY');

  const canonicalFactsFingerprint = sha256(stableFingerprint(canonicalFacts));
  const effectiveFactsFingerprint = sha256(stableFingerprint(effectiveFacts));
  const frozenAt = new Date().toISOString();
  const provenance = buildProvenance({
    origin: 'EXTRACTED',
    extractorVersion: run.extractorVersion,
    policySourceId: input.policySourceId,
    capturedAt: frozenAt,
    facts: effectiveFacts,
    reviews: latestByFact,
  });

  if (typeof input.database.rpc === 'function') {
    const result = await input.database.rpc(FREEZE_FACT_RUN_RPC, {
      p_fact_run_id: run.id,
      p_facts: effectiveFacts,
      p_provenance: provenance,
      p_policy_source_id: input.policySourceId,
      p_canonical_facts_fingerprint: canonicalFactsFingerprint,
      p_effective_facts_fingerprint: effectiveFactsFingerprint,
      p_fact_reviews_snapshot: reviews,
      p_fact_count: effectiveFacts.length,
    });
    if (result?.error) {
      if (!isFoundationObjectMissing(FREEZE_FACT_RUN_RPC, result.error)) {
        throw new Error(result.error.message ?? 'FACT_RUN_FREEZE_FAILED');
      }
    } else {
      const row = ((result?.data ?? []) as FreezeRpcRow[])[0];
      if (row?.out_fact_run_id) {
        return {
          factRunId: String(row.out_fact_run_id),
          state: 'FROZEN',
          frozenAt: row.out_frozen_at ? String(row.out_frozen_at) : frozenAt,
          snapshotId: row.out_snapshot_id ? String(row.out_snapshot_id) : null,
          canonicalFactsFingerprint: String(row.out_canonical_facts_fingerprint ?? canonicalFactsFingerprint),
          effectiveFactsFingerprint: String(row.out_effective_facts_fingerprint ?? effectiveFactsFingerprint),
          factCount: typeof row.out_fact_count === 'number' ? row.out_fact_count : effectiveFacts.length,
          transport: 'RPC',
          degradation: null,
        };
      }
    }
    warnFoundationDegradation(
      DEGRADATION_FREEZE_RPC_ABSENT,
      `${FREEZE_FACT_RUN_RPC} no está disponible: auditoría ${run.auditId}, Fact Run ${run.id}. Se congela con la máquina de estados legal (DRAFT -> PROCESSING -> FROZEN) y SIN snapshot sellado. Aplique la migración 20260925120000_policy-foundation-immutability.sql.`,
    );
  } else {
    warnFoundationDegradation(
      DEGRADATION_FREEZE_RPC_ABSENT,
      `${FREEZE_FACT_RUN_RPC} no está disponible (el cliente no expone rpc): auditoría ${run.auditId}, Fact Run ${run.id}. Se congela con la máquina de estados legal y SIN snapshot sellado.`,
    );
  }

  if (run.state === 'DRAFT') {
    const toProcessing = await input.database.from('fact_extraction_runs').update({ state: 'PROCESSING' }).eq('id', run.id);
    if (toProcessing.error) throw new Error(toProcessing.error.message ?? 'FACT_RUN_FREEZE_FAILED');
  }
  const toFrozen = await input.database.from('fact_extraction_runs').update({ state: 'FROZEN', frozen_at: frozenAt }).eq('id', run.id);
  if (toFrozen.error) throw new Error(toFrozen.error.message ?? 'FACT_RUN_FREEZE_FAILED');

  return {
    factRunId: run.id,
    state: 'FROZEN',
    frozenAt,
    snapshotId: null,
    canonicalFactsFingerprint,
    effectiveFactsFingerprint,
    factCount: effectiveFacts.length,
    transport: 'LEGACY_STATE_WALK',
    degradation: DEGRADATION_FREEZE_RPC_ABSENT,
  };
}
