import { createHash } from 'node:crypto';
import { createFactRepository, type DatabaseClient } from '@cancelaciones/db';
import { stableFingerprint } from '@cancelaciones/domain';
import type { Fact } from '@cancelaciones/policy-engine';
import {
  DERIVE_FACT_RUN_RPC,
  DEGRADATION_DERIVE_RPC_ABSENT,
  DEGRADATION_FINGERPRINT_COLUMN_ABSENT,
  getFrozenEffectiveFacts,
  type FactProvenanceEntry,
  type FactRunProvenance,
  type FrozenEffectiveFacts,
  type FrozenFactReviewRecord,
} from './fact-run-snapshot';

export type { FrozenFactReviewRecord };
import { isFoundationObjectMissing, warnFoundationDegradation } from './foundation-objects';

/**
 * ============================================================================
 * CORRECCIÓN HUMANA COMO RUN DERIVADO (Task 10, Steps 3 y 4)
 * ============================================================================
 *
 * EL PROBLEMA QUE RESUELVE
 * Una corrección humana sobre un Fact Run FROZEN no puede reescribir ese run:
 * `guard_frozen_fact_run_row` aborta cualquier UPDATE sobre él y
 * `guard_frozen_fact_run_insert` aborta insertar hechos nuevos. Tampoco puede
 * applies en vivo para siempre, porque entonces el outcome de una evaluación ya
 * registrada cambiaría retroactivamente. La única salida que respeta las dos
 * cosas es la TERCERA: un Fact Run NUEVO que declara su padre, con su motivo,
 * su autor y su instante, y su propio snapshot.
 *
 * POR QUÉ EL PADRE NO RECIBE NI UN UPDATE
 * `PRESERVE_MACHINE_DECISION` y `TRACE_EVERY_DECISION`: la decisión de máquina
 * se conserva íntegra y la corrección quedaversionada al lado. El RPC devuelve
 * el `effective_facts_fingerprint` del padre ANTES y DESPUÉS para que el
 * llamador lo compruebe y pueda abortar si se movió.
 */

export interface DerivedFact {
  /**
   * Id del hecho en el Fact Run PADRE al que esta entrada sustituye. No es un id
   * nuevo: es la trazabilidad de la corrección. El servidor no lo usa para
   * insertar (sólo lee fact_type/classification/value/source_ref/confidence).
   */
  id: string;
  factType: string;
  classification: 'OBSERVABLE' | 'HUMAN_CONFIRMED' | 'HUMAN_CORRECTED';
  value: unknown;
  sourceRef: Record<string, unknown>;
  confidence: number | null;
}

export interface DerivedFactRun {
  id: string;
  auditId: string;
  policyCode: string;
  policyVersion: string;
  extractorVersion: string;
  parentFactRunId: string;
  derivationReason: string;
  state: 'DRAFT' | 'PROCESSING' | 'FAILED' | 'FROZEN';
  createdBy: string;
  createdAt: string;
}

export interface DeriveFactRunResult {
  derivedRun: DerivedFactRun;
  derivedFacts: DerivedFact[];
  provenance: FactProvenanceEntry[];
  parentFactRunId: string;
  parentFingerprintBefore: string | null;
  parentFingerprintAfter: string | null;
  parentFingerprintUnchanged: boolean;
  transport: 'RPC' | 'LOCAL_FALLBACK';
  degradation: string | null;
  snapshotId: string | null;
}

const DERIVED_RUN_COLUMNS = 'id,audit_id,policy_code,policy_version,extractor_version,artifact_set_fingerprint,state,frozen_at,created_at,created_by,parent_fact_run_id,derivation_reason';

const sha256 = (value: string): string => createHash('sha256').update(value).digest('hex');

/**
 * El índice único de idempotencia de fact runs es
 * `(audit_id, policy_code_hash, policy_version, extractor_version,
 * artifact_set_fingerprint_hash)`. El derivado hereda todo del padre menos
 * `extractor_version`, así que ÉSA es la única variable libre y tiene que
 * diferir o el INSERT choca con 23505. `create_derived_fact_run_v1` lo valida
 * con `DERIVED_RUN_IDEMPOTENCY_COLLISION`; aquí se garantiza por construcción.
 */
function derivedExtractorVersion(parentExtractorVersion: string): string {
  const candidate = `${parentExtractorVersion}+human-correction`;
  return candidate === parentExtractorVersion ? `${candidate}+1` : candidate;
}

function factToStoredShape(fact: Fact): DerivedFact {
  return {
    id: fact.id,
    factType: fact.type,
    classification: 'OBSERVABLE',
    value: fact.value,
    sourceRef: (fact.source ?? {}) as Record<string, unknown>,
    confidence: fact.extractionConfidence ?? null,
  };
}

/**
 * Forma que `create_derived_fact_run_v1` espera en `p_facts`.
 *
 * MEDIDO contra el backend, no inferido: el RPC inserta los hechos con
 * `f->>'fact_type'`, `f->>'classification'`, `f->'value'`, `f->>'source_ref'` y
 * `f->>'confidence'`, y `DerivedFact` usa `factType` y `sourceRef`. Ninguna de
 * las dos grafías coincide, así que la derivación por RPC fallaba con
 * `value in column "fact_type" of relation "facts" violates not-null constraint`.
 *
 * POR QUÉ EMITE LAS DOS GRAFÍAS Y NO SÓLO LA DEL SERVIDOR
 * El mismo array `p_facts` tiene DOS consumidores con contratos distintos:
 *
 *   1. El `INSERT INTO public.facts` del RPC, que lee las claves de COLUMNA
 *      (`fact_type`, `source_ref`, `confidence`).
 *   2. El snapshot, porque el RPC guarda `p_facts` VERBATIM en
 *      `fact_run_frozen_snapshots.facts`. Y ese snapshot lo lee después
 *      `mapSnapshotFactsToPolicyFacts`
 *      (apps/web/src/server/policy/frozen-fact-run.ts:107), que exige
 *      `id`, `type` y `value`, y lanza `FROZEN_SNAPSHOT_PAYLOAD_INVALID` si
 *      `type` falta.
 *
 * Es decir: un payload sólo snake_case arregla (1) y rompe (2), dejando un
 * Fact Run derivado sellado e ilegible. Un payload sólo canónico arregla (2) y
 * deja (1) fallando. Por eso se emiten ambas, y la clave canónica es la que
 * manda para el motor.
 *
 * LO QUE NO HACE
 *   - No cambia la representación interna del dominio. `DerivedFact` sigue siendo
 *     camelCase; esto sólo se aplica en el borde del RPC.
 *   - No toca `value`, `classification` ni `confidence`: se copian tal cual, así
 *     que ninguna propiedad normativa se altera en el transporte.
 *   - No toca ninguna huella. `canonicalFactsFingerprint` y
 *     `effectiveFactsFingerprint` se calculan en otro sitio, sobre los `Fact[]`
 *     canónicos, no sobre este payload. La forma del payload no puede mover una
 *     huella.
 *   - No inventa ids ni evidencia: `id` es el del hecho del padre, que es
 *     justamente lo que da trazabilidad a la corrección.
 */
export function toDerivedFactRpcPayload(facts: DerivedFact[]): Array<Record<string, unknown>> {
  return facts.map((fact) => ({
    // Canónico: es lo que lee el motor a través del snapshot.
    id: fact.id,
    type: fact.factType,
    value: fact.value,
    source: fact.sourceRef,
    extractionConfidence: fact.confidence,
    // Columna: es lo que lee el INSERT del RPC.
    fact_type: fact.factType,
    classification: fact.classification,
    source_ref: fact.sourceRef,
    confidence: fact.confidence,
  }));
}

interface DeriveRpcRow {
  out_derived_fact_run_id?: unknown;
  out_derived_snapshot_id?: unknown;
  out_parent_fact_run_id?: unknown;
  out_parent_fingerprint_before?: unknown;
  out_parent_fingerprint_after?: unknown;
}

function provenanceOf(effective: FrozenEffectiveFacts, origin: 'IMPORTED' | 'HUMAN_CORRECTION'): FactRunProvenance {
  if (effective.provenance) {
    return { ...effective.provenance, origin, entries: effective.provenance.entries.map((entry) => ({ ...entry })) };
  }
  return {
    schemaVersion: 'fact-run-frozen-snapshot-provenance-v1',
    origin,
    extractorVersion: '',
    policySourceId: '',
    capturedAt: new Date().toISOString(),
    entries: effective.facts.map((fact) => ({ factId: fact.id, factType: fact.type, extractionMethod: 'IMPORTED', origin, reviewId: null, corrected: false })),
  };
}

/**
 * ============================================================================
 * Deriva un Fact Run a partir de una corrección humana.
 * ============================================================================
 * Camino preferente: `create_derived_fact_run_v1`, que valida al actor, exige
 * que el padre esté FROZEN y CON SNAPSHOT, crea el hijo recorriendo DRAFT ->
 * PROCESSING -> FROZEN (sin saltarse el guard), inserta SU snapshot y devuelve
 * el fingerprint del padre antes y después. El padre no se toca: ni una columna.
 *
 * Degradación (R-3): sin el RPC, el mismo resultado se construye con inserts
 * directos recorriendo la máquina de estados legal, y se avisa con un código
 * estable. Un error de negocio del RPC se propaga.
 */
export async function deriveFactRunFromReviews(input: {
  database: DatabaseClient;
  auditId: string;
  factId: string;
  correctedValue: unknown;
  review: FrozenFactReviewRecord;
  actorId: string;
  policySourceId: string;
}): Promise<DeriveFactRunResult> {
  if (input.correctedValue === null || input.correctedValue === undefined) throw new Error('HUMAN_CORRECTION_CORRECTED_VALUE_REQUIRED');

  const factsRepo = createFactRepository(input.database);
  const fact = await factsRepo.findFactById(input.factId);
  if (!fact || fact.auditId !== input.auditId) throw new Error('HUMAN_CORRECTION_FACT_NOT_FOUND');

  const parent = await factsRepo.findRunById(fact.runId);
  if (!parent) throw new Error('HUMAN_CORRECTION_PARENT_NOT_FOUND');
  if (parent.state !== 'FROZEN') throw new Error('HUMAN_CORRECTION_PARENT_NOT_FROZEN');

  // Los hechos de partida son los SELLADOS del padre. Es lo que garantiza que la
  // corrección se acumule sobre una base estable y no sobre lo que la última
  // review dejó a medias.
  const effective = await getFrozenEffectiveFacts({ database: input.database, auditId: input.auditId, factRunId: parent.id, run: parent, policySourceId: input.policySourceId });
  const base = effective.facts.find((candidate) => candidate.id === input.factId);
  if (!base) throw new Error('HUMAN_CORRECTION_FACT_NOT_IN_SNAPSHOT');

  const corrected: Fact = { ...base, value: input.correctedValue };
  const derivedPolicyFacts = effective.facts.map((candidate) => (candidate.id === input.factId ? corrected : candidate));
  const extractorVersion = derivedExtractorVersion(parent.extractorVersion);
  const derivationReason = `HUMAN_CORRECTION: ${base.type}`;

  const derivedFacts: DerivedFact[] = derivedPolicyFacts.map((candidate) => ({
    ...factToStoredShape(candidate),
    ...(candidate.id === input.factId ? { classification: 'HUMAN_CORRECTED' as const } : {}),
  }));
  const provenanceEntries: FactProvenanceEntry[] = provenanceOf(effective, 'HUMAN_CORRECTION').entries.map((entry) => (
    entry.factId === input.factId
      ? { ...entry, extractionMethod: 'HUMAN' as const, origin: 'HUMAN_CORRECTION' as const, corrected: true, reviewId: input.review.reviewId ?? null }
      : { ...entry, origin: 'HUMAN_CORRECTION' as const }
  ));
  if (!provenanceEntries.some((entry) => entry.factId === input.factId)) {
    provenanceEntries.push({ factId: input.factId, factType: base.type, extractionMethod: 'HUMAN', origin: 'HUMAN_CORRECTION', reviewId: input.review.reviewId ?? null, corrected: true });
  }
  const provenance: FactRunProvenance = {
    ...provenanceOf(effective, 'HUMAN_CORRECTION'),
    origin: 'HUMAN_CORRECTION',
    extractorVersion,
    policySourceId: input.policySourceId,
    entries: provenanceEntries,
  };

  // `canonical` es lo que habría visto la máquina; `effective` es lo que verá
  // con la corrección. Dos huellas distintas y no vacías: el RPC exige ambas.
  const canonicalFactsFingerprint = sha256(stableFingerprint(effective.facts));
  const effectiveFactsFingerprint = sha256(stableFingerprint(derivedPolicyFacts));
  const parentFingerprintBefore = await readEffectiveFingerprint(input.database, parent.id);
  const createdAt = new Date().toISOString();

  if (typeof input.database.rpc === 'function') {
    const result = await input.database.rpc(DERIVE_FACT_RUN_RPC, {
      p_parent_fact_run_id: parent.id,
      p_derivation_reason: derivationReason,
      p_facts: toDerivedFactRpcPayload(derivedFacts),
      p_provenance: provenance,
      p_policy_source_id: input.policySourceId,
      p_extractor_version: extractorVersion,
      p_canonical_facts_fingerprint: canonicalFactsFingerprint,
      p_effective_facts_fingerprint: effectiveFactsFingerprint,
      p_fact_reviews_snapshot: effective.factReviews,
    });
    if (result?.error) {
      if (!isFoundationObjectMissing(DERIVE_FACT_RUN_RPC, result.error)) {
        throw new Error(result.error.message ?? 'DERIVED_FACT_RUN_FAILED');
      }
    } else {
      const row = ((result?.data ?? []) as DeriveRpcRow[])[0];
      if (row?.out_derived_fact_run_id) {
        const after = row.out_parent_fingerprint_after ? String(row.out_parent_fingerprint_after) : parentFingerprintBefore;
        const before = row.out_parent_fingerprint_before ? String(row.out_parent_fingerprint_before) : parentFingerprintBefore;
        if (before !== after) throw new Error('PARENT_FACT_RUN_MUTATED');
        return {
          derivedRun: {
            id: String(row.out_derived_fact_run_id),
            auditId: input.auditId,
            policyCode: parent.policyCode,
            policyVersion: parent.policyVersion,
            extractorVersion,
            parentFactRunId: parent.id,
            derivationReason,
            state: 'FROZEN',
            createdBy: input.actorId,
            createdAt,
          },
          derivedFacts,
          provenance: provenance.entries,
          parentFactRunId: parent.id,
          parentFingerprintBefore: before,
          parentFingerprintAfter: after,
          parentFingerprintUnchanged: before === after,
          transport: 'RPC',
          degradation: null,
          snapshotId: row.out_derived_snapshot_id ? String(row.out_derived_snapshot_id) : null,
        };
      }
    }
    warnFoundationDegradation(
      DEGRADATION_DERIVE_RPC_ABSENT,
      `${DERIVE_FACT_RUN_RPC} no está disponible: auditoría ${input.auditId}, Fact Run padre ${parent.id}. La corrección se materializa como run derivado por inserts directos. Aplique la migración 20260925120000_policy-foundation-immutability.sql.`,
    );
  } else {
    warnFoundationDegradation(
      DEGRADATION_DERIVE_RPC_ABSENT,
      `${DERIVE_FACT_RUN_RPC} no está disponible (el cliente no expone rpc): auditoría ${input.auditId}, Fact Run padre ${parent.id}. La corrección se materializa como run derivado por inserts directos.`,
    );
  }

  const insertedRun = await input.database.from('fact_extraction_runs').insert([{
    audit_id: parent.auditId,
    policy_code: parent.policyCode,
    policy_version: parent.policyVersion,
    extractor_version: extractorVersion,
    artifact_set_fingerprint: parent.artifactSetFingerprint,
    state: 'DRAFT',
    created_by: input.actorId,
    parent_fact_run_id: parent.id,
    derivation_reason: derivationReason,
  }]).select(DERIVED_RUN_COLUMNS).single();
  if (insertedRun.error || !insertedRun.data) throw new Error(insertedRun.error?.message ?? 'DERIVED_FACT_RUN_FAILED');
  const derivedId = String(insertedRun.data.id);

  const insertedFacts = await input.database.from('facts').insert(derivedFacts.map((candidate) => ({
    audit_id: parent.auditId,
    run_id: derivedId,
    fact_type: candidate.factType,
    classification: candidate.classification,
    value: candidate.value,
    source_ref: candidate.sourceRef,
    confidence: candidate.confidence,
  }))).select('id');
  if (insertedFacts.error) throw new Error(insertedFacts.error.message ?? 'DERIVED_FACTS_INSERT_FAILED');

  const toProcessing = await input.database.from('fact_extraction_runs').update({ state: 'PROCESSING' }).eq('id', derivedId);
  if (toProcessing.error) throw new Error(toProcessing.error.message ?? 'DERIVED_FACT_RUN_FAILED');
  // `effective_facts_fingerprint` lo añade la migración 20260925120000, así que
  // en una base sin migrar escribirla aborta con PGRST204. La corrección ya
  // está registrada en el run derivado; perder la huella NO puede impedir que
  // el run quede FROZEN, así que se reintenta sin la columna y se avisa.
  const freezeValues: Record<string, unknown> = { state: 'FROZEN', frozen_at: createdAt, effective_facts_fingerprint: effectiveFactsFingerprint };
  let toFrozen = await input.database.from('fact_extraction_runs').update(freezeValues).eq('id', derivedId);
  if (toFrozen.error && isFoundationObjectMissing('effective_facts_fingerprint', toFrozen.error)) {
    warnFoundationDegradation(
      DEGRADATION_FINGERPRINT_COLUMN_ABSENT,
      `fact_extraction_runs.effective_facts_fingerprint no existe todavía: el Fact Run derivado ${derivedId} de la auditoría ${input.auditId} se congela sin huella efectiva. Aplique la migración 20260925120000_policy-foundation-immutability.sql.`,
    );
    toFrozen = await input.database.from('fact_extraction_runs').update({ state: 'FROZEN', frozen_at: createdAt }).eq('id', derivedId);
  }
  if (toFrozen.error) throw new Error(toFrozen.error.message ?? 'DERIVED_FACT_RUN_FAILED');

  const parentFingerprintAfter = await readEffectiveFingerprint(input.database, parent.id);
  if (parentFingerprintBefore !== null && parentFingerprintAfter !== parentFingerprintBefore) throw new Error('PARENT_FACT_RUN_MUTATED');

  return {
    derivedRun: {
      id: derivedId,
      auditId: parent.auditId,
      policyCode: parent.policyCode,
      policyVersion: parent.policyVersion,
      extractorVersion,
      parentFactRunId: parent.id,
      derivationReason,
      state: 'FROZEN',
      createdBy: input.actorId,
      createdAt,
    },
    derivedFacts,
    provenance: provenance.entries,
    parentFactRunId: parent.id,
    parentFingerprintBefore,
    parentFingerprintAfter,
    parentFingerprintUnchanged: parentFingerprintBefore === parentFingerprintAfter,
    transport: 'LOCAL_FALLBACK',
    degradation: DEGRADATION_DERIVE_RPC_ABSENT,
    snapshotId: null,
  };
}

/**
 * `effective_facts_fingerprint` sólo existe después de la migración, así que
 * su lectura también es opcional: `null` significa "la columna todavía no está",
 * no "el padre cambió". Se reintenta con una proyección mínima en vez de
 * propagar el PGRST204, porque comparar padre e hijo sin esa columna es
 * vacuo pero seguro, y propagar el error sí rompería el pipeline.
 */
async function readEffectiveFingerprint(database: DatabaseClient, factRunId: string): Promise<string | null> {
  const read = await database.from('fact_extraction_runs').select('id,effective_facts_fingerprint').eq('id', factRunId).limit(1);
  const result = read.error && isFoundationObjectMissing('effective_facts_fingerprint', read.error)
    ? await database.from('fact_extraction_runs').select('id').eq('id', factRunId).limit(1)
    : read;
  if (result.error) {
    if (isFoundationObjectMissing('fact_extraction_runs', result.error)) return null;
    throw new Error(result.error.message ?? 'FACT_RUN_READ_FAILED');
  }
  const row = (result.data ?? [])[0] as { effective_facts_fingerprint?: unknown } | undefined;
  if (!row || row.effective_facts_fingerprint === null || row.effective_facts_fingerprint === undefined) return null;
  return String(row.effective_facts_fingerprint);
}
