# Policy Foundation Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implementar los fundamentos inmutables, trazables y no autoritativos necesarios para futuras Extraction Tools y un motor declarativo shadow, sin cambiar el comportamiento de `evaluatePolicy` ni `v5Rules`.

**Architecture:** Se añadirán contratos puros en `domain`/`policy-engine`, adapters de aplicación, módulos de extracción shadow y persistencia append-only en InsForge. Cada Fact Run FROZEN quedará vinculado a un solo snapshot efectivo; las correcciones humanas crearán runs derivados y `AI_DECISION_V1` se conservará como snapshot durable inmutable.

**Tech Stack:** TypeScript 5.8, pnpm 9.15.4, Vitest 2.1, Zod 3.25, Next.js 15, InsForge SDK 1.5, PostgreSQL/RLS/triggers vía `@insforge/cli`.

## Global Constraints

- `evaluatePolicy` y `v5Rules` no se modificarán, ni siquiera para corregir 5.2, 5.7.e o 5.8.a.
- `GDM_GAM_PRD_MLG_003` sigue siendo autoridad normativa; las divergencias se bloquearán como `REQUIRES_OWNER_DECISION`.
- La fuente local no confirmada se registrará como `PENDING_VERIFICATION`, nunca como `CANONICAL`.
- Los Golden Masters congelan comportamiento actual, no verdad normativa, y no tendrán modo de auto-update.
- FROZEN es irreversible; toda corrección humana crea un Fact Run derivado.
- `AI_DECISION_V1` completado es append-only y su hash cubre todo el snapshot relevante.
- El sanitizer blind es fail-closed; `validateEvidenceReferences()` es la segunda barrera.
- Extraction Tools y Shadow Engine no se conectarán al pipeline ni a la API/UI oficial.
- No se eliminará código legacy.
- Las migraciones serán forward-only, sin transacciones embebidas, y se aplicarán con un target explícito devuelto por el CLI.
- No se harán commits: el usuario no los solicitó.
- Cada cambio de código começa con test RED y termina con test GREEN.

---

### Task 1: Cerrar el baseline TypeScript preexistente

**Files:**
- Modify: `apps/web/src/server/jobs/audit-pipeline.dev-e2e.test.ts:101`
- Modify: `apps/web/src/server/jobs/audit-queue.e2e.test.ts:111-132`
- Test: ambos archivos

**Interfaces:**
- Consumes: tipos existentes `JobStatus`, `Row` y `DurableDb`.
- Produces: suite E2E que compila sin casts inseguros ni assertions imposibles.

- [ ] **Step 1: Reproducir el fallo RED de typecheck**

Run:

```bash
pnpm typecheck
```

Expected: FAIL en `audit-pipeline.dev-e2e.test.ts:101` y `audit-queue.e2e.test.ts:111-132`, sin errores nuevos.

- [ ] **Step 2: Corregir el narrowing sin cambiar expectativas**

En `audit-pipeline.dev-e2e.test.ts`, mantener exactamente la semántica existente `COMPLETED | SUCCEEDED` mediante widening a string:

```ts
const jobStatuses = jobsReloaded.map((job) => String(job.status))
expect(jobStatuses.every((status) => status === 'COMPLETED' || status === 'SUCCEEDED')).toBe(true)
```

Esta corrección resuelve únicamente TypeScript; no cambia ni amplía el comportamiento esperado.

En `audit-queue.e2e.test.ts`, aplicar narrowing a `job` y `attempt_count` con type guards locales:

```ts
function isRow(value: Row | undefined): value is Row {
  return typeof value === 'object' && value !== null
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value)
}
```

Sustituir accesos directos por:

```ts
if (!isRow(job) || !isFiniteNumber(job.attempt_count) || !isFiniteNumber(job.max_attempts)) {
  throw new Error('INVALID_DURABLE_JOB_ROW')
}
```

- [ ] **Step 3: Verificar GREEN focalizado**

Run:

```bash
pnpm --filter @cancelaciones/web typecheck
pnpm --filter @cancelaciones/web test:audit:e2e
```

Expected: ambos PASS.

---

### Task 2: Contratos de facts, provenance, canonicalización y shadow boundary

**Files:**
- Create: `packages/domain/src/policy-foundation.ts`
- Create: `packages/domain/src/policy-foundation.test.ts`
- Modify: `packages/domain/src/index.ts:1`

**Interfaces:**
- Produces: `FactState`, `FactProvenanceV1`, `ExtractedFactV1`, `ExtractionToolOutputV1`, `ShadowPolicyResult`, `canonicalizeV1`, `canonicalFingerprintV1`.

- [ ] **Step 1: Escribir tests RED**

```ts
import { describe, expect, it } from 'vitest';
import {
  canonicalFingerprintV1,
  type ExtractedFactV1,
  type ShadowPolicyResult,
} from './policy-foundation';

describe('policy foundation contracts', () => {
  it('no convierte UNKNOWN en false', () => {
    const fact: ExtractedFactV1<unknown> = {
      factType: 'classroom.hasGrades',
      value: null,
      state: 'UNKNOWN',
      provenance: [],
    };
    expect(fact.value).toBeNull();
    expect(fact.state).not.toBe('OBSERVED');
  });

  it('produce el mismo fingerprint para clavescanónicas equivalentes', () => {
    expect(canonicalFingerprintV1({ b: 2, a: { d: 4, c: 3 } }))
      .toBe(canonicalFingerprintV1({ a: { c: 3, d: 4 }, b: 2 }));
  });

  it('excluye campos operativos generados del input canónico', () => {
    expect(canonicalFingerprintV1({ artifact: { id: 'a', content: 'x' }, createdAt: '2026-01-01' }))
      .toBe(canonicalFingerprintV1({ artifact: { id: 'a', content: 'x' }, createdAt: '2026-01-02' }));
  });

  it('marca shadow como no autoritativo', () => {
    const result: ShadowPolicyResult = {
      authoritative: false,
      source: 'DECLARATIVE_SHADOW',
      evaluation: null,
    };
    expect(result.authoritative).toBe(false);
  });

});
```

- [ ] **Step 2: Ejecutar RED**

Run:

```bash
pnpm --filter @cancelaciones/domain test -- policy-foundation.test.ts
```

Expected: FAIL por módulo inexistente.

- [ ] **Step 3: Implementar contratos mínimos**

```ts
export type FactState = 'OBSERVED' | 'INFERRED' | 'UNKNOWN' | 'CONTRADICTORY';
export type ExtractionMethod = 'DETERMINISTIC' | 'LLM' | 'HUMAN' | 'IMPORTED';

export interface FactProvenanceV1 {
  evidenceId: string;
  artifactId?: string;
  artifactHash?: string;
  page?: number;
  startTimestamp?: number;
  endTimestamp?: number;
  sourceText?: string;
  extractionMethod: ExtractionMethod;
  extractorId: string;
  extractorVersion: string;
  confidence?: number;
}

export interface ExtractedFactV1<T = unknown> {
  factType: string;
  value: T | null;
  state: FactState;
  confidence?: number;
  provenance: FactProvenanceV1[];
}

export interface ExtractionToolOutputV1 {
  facts: ExtractedFactV1[];
}

export interface ShadowPolicyResult {
  authoritative: false;
  source: 'DECLARATIVE_SHADOW';
  evaluation: unknown;
}

export const OPERATIONAL_FINGERPRINT_FIELDS = new Set(['createdAt', 'updatedAt', 'completedAt', 'executionId', 'runId']);
export const CANONICALIZATION_VERSION = 'canonicalization-v1';
```

`canonicalizeV1` ordenará claves recursivamente, eliminará `undefined` y, para el fingerprint de entrada, omitirá únicamente los campos operativos listados. Los arrays conservarán orden porque puede ser semántico. El hash de integridad de una decisión se calculará aparte sobre el snapshot completo, incluyendo IDs y timestamps.

- [ ] **Step 4: Exportar y verificar GREEN**

Añadir `export * from './policy-foundation';` a `packages/domain/src/index.ts`.

Run:

```bash
pnpm --filter @cancelaciones/domain test
pnpm --filter @cancelaciones/domain typecheck
```

Expected: PASS.

---

### Task 3: Canonical Policy Source Registry

**Files:**
- Create: `packages/policy-engine/src/source-registry.ts`
- Create: `packages/policy-engine/src/source-registry.test.ts`
- Modify: `packages/policy-engine/src/index.ts:3-4`

**Interfaces:**
- Produces: `PolicySourceRecord`, `PolicyRuleReference`, `createPolicySourceRegistry(input)`.
- Registra sólo el PDF local con status `PENDING_VERIFICATION`; no seed CANONICAL.

- [ ] **Step 1: Escribir RED**

```ts
import { describe, expect, it } from 'vitest';
import { createPolicySourceRegistry } from './source-registry';

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
```

- [ ] **Step 2: Ejecutar RED**

```bash
pnpm --filter @cancelaciones/policy-engine test -- source-registry.test.ts
```

Expected: FAIL por módulo inexistente.

- [ ] **Step 3: Implementar registry puro**

`createPolicySourceRegistry` validará SHA-256 con `/^[a-f0-9]{64}$/`, indexará por `policyCode|policyVersion`, exigirá unicidad de `documentId`, y expondrá `get`, `list`, `canonicalSources` y `requireReference`. La referencia podrá omitir `page` o `citation` cuando no estén confirmados, pero no inventará valores.

- [ ] **Step 4: Exportar sin tocar reglas**

Añadir `export * from './source-registry';` al inicio de `packages/policy-engine/src/index.ts`. No modificar las líneas de `v5Rules`, `policySets` ni `evaluatePolicy`.

- [ ] **Step 5: Verificar GREEN y baseline del motor**

```bash
pnpm --filter @cancelaciones/policy-engine test
pnpm --filter @cancelaciones/policy-engine typecheck
```

Expected: PASS.

---

### Task 4: Golden Master del motor actual

**Files:**
- Create: `packages/policy-engine/src/golden-master-cases.ts`
- Create: `packages/policy-engine/src/golden-master.test.ts`
- Create: `packages/policy-engine/src/testdata/golden-master-v1.json`

**Interfaces:**
- Consumes: `evaluatePolicy(input)`.
- Produces: corpus sintético inmutable con `expected.evaluation` y hashes completos.

- [ ] **Step 1: Definir casos sintéticos RED**

Crear exactamente estas familias:

```ts
export const goldenCases = [
  'complete-licenciatura',
  'missing-all-facts',
  'partial-contact-collections',
  'unknown-academic-level',
  'non-licenciatura',
  'grades-observed',
  'grades-absent',
  'contact-threshold-satisfied',
  'contact-threshold-not-satisfied',
  'coverage-gaps-v5',
] as const;
```

Cada caso usará sólo facts sintéticos con IDs `synthetic-*`, valores conocidos por el contrato actual y provenance `synthetic-evidence`. No copiar texto de expedientes reales.

- [ ] **Step 2: Escribir comparación exhaustiva**

```ts
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { canonicalFingerprintV1 } from '@cancelaciones/domain';
import { evaluatePolicy } from './index';
import { goldenCases } from './golden-master-cases';

const expected = JSON.parse(readFileSync(new URL('./testdata/golden-master-v1.json', import.meta.url), 'utf8')) as Record<string, unknown>;

for (const testCase of goldenCases) {
  it(`bloquea comportamiento actual: ${testCase}`, () => {
    const actual = evaluatePolicy(testCase.input);
    expect(actual).toEqual(expected[testCase]);
    expect(createHash('sha256').update(canonicalFingerprintV1(actual)).digest('hex')).toBe(testCase.expectedFingerprint);
  });
}
```

- [ ] **Step 3: Ejecutar RED**

```bash
pnpm --filter @cancelaciones/policy-engine test -- golden-master.test.ts
```

Expected: FAIL porque `golden-master-v1.json` aún no existe.

- [ ] **Step 4: Capturar baseline una sola vez con el código actual**

Antes de añadir el JSON, ejecutar el test contra `evaluatePolicy` actual y materializar `expected` con la salida completa. Cada caso usará:

```ts
inputFingerprint: sha256(canonicalFingerprintV1(facts))
expectedFingerprint: sha256(canonicalFingerprintV1(expectedEvaluation))
metadata: { synthetic: true, notes: 'Behavior lock; not normative truth.' }
```

No añadir script, flag ni test que escriba el JSON.

- [ ] **Step 5: Ejecutar GREEN dos veces**

```bash
pnpm --filter @cancelaciones/policy-engine test -- golden-master.test.ts
pnpm --filter @cancelaciones/policy-engine test -- golden-master.test.ts
```

Expected: ambos PASS y fingerprints idénticos.

- [ ] **Step 6: Guardar hash de referencia del fixture**

```bash
sha256sum packages/policy-engine/src/testdata/golden-master-v1.json
```

Registrar el hash en el reporte, no en un archivo autoactualizable.

---

### Task 5: Evaluation Envelope y Shadow Engine no oficial

**Files:**
- Create: `packages/policy-engine/src/evaluation-envelope.ts`
- Create: `packages/policy-engine/src/evaluation-envelope.test.ts`
- Create: `packages/policy-engine/src/shadow-engine.ts`
- Create: `packages/policy-engine/src/shadow-engine.test.ts`
- Modify: `packages/policy-engine/src/index.ts:3-4`

**Interfaces:**
- Produces: `AuditEvaluationEnvelopeV1`, `toAuditEvaluationEnvelopeV1(evaluation, context)`, `ShadowPolicyEngine`, `NonAuthoritativeShadowRunner`.

- [ ] **Step 1: Escribir RED de envelope**

Cubrir las diez reason codes:

```ts
const reasonCodes = [
  'NO_POLICY_OUTCOME', 'MISSING_EVIDENCE', 'CONTRADICTORY_EVIDENCE',
  'POLICY_COVERAGE_GAP', 'MISSING_NORMATIVE_SOURCE', 'MODEL_ERROR',
  'PARSING_ERROR', 'SCHEMA_ERROR', 'PERSISTENCE_ERROR', 'HUMAN_REVIEW_REQUIRED',
] as const;
```

Probar que `MODEL_ERROR` queda en `system`, no en `decision.outcomeStatus`; `MISSING_EVIDENCE` en `evidence`; coverage gap en `policy`; y human review en `review`.

- [ ] **Step 2: Ejecutar RED**

```bash
pnpm --filter @cancelaciones/policy-engine test -- evaluation-envelope.test.ts
```

Expected: FAIL por módulo inexistente.

- [ ] **Step 3: Implementar adapter sin cambiar `PolicyEvaluation`**

`toAuditEvaluationEnvelopeV1` conservará `suggestedOutcome`, `outcomeStatus` y `decisionStatus` sin reinterpretarlos. Ordenará las causas según errores de sistema, fuentes normativas, coverage, conflictos, missing facts/evidence y review.

- [ ] **Step 4: Escribir RED de shadow boundary**

```ts
it('no expone una API de persistencia oficial', () => {
  const runner = createNonAuthoritativeShadowRunner({ evaluate: async () => ({ outcome: null }) });
  expect(runner.authoritative).toBe(false);
  expect('persist' in runner).toBe(false);
  expect('write' in runner).toBe(false);
});
```

- [ ] **Step 5: Implementar interfaz mínima y GREEN**

`ShadowPolicyEngine` tendrá sólo `id`, `version` y `evaluate(input): Promise<ShadowPolicyResult>`. El wrapper comparará resultados en memoria y no aceptará `DatabaseClient`, audit ID, engine run ID ni serializer oficial.

```bash
pnpm --filter @cancelaciones/policy-engine test
pnpm --filter @cancelaciones/policy-engine typecheck
```

Expected: PASS y Golden Master verde.

---

### Task 6: Evidence validation y Extraction Tools shadow

**Files:**
- Create: `apps/web/src/server/extraction/contracts.ts`
- Create: `apps/web/src/server/extraction/contracts.test.ts`
- Create: `apps/web/src/server/extraction/evidence-reference-validation.ts`
- Create: `apps/web/src/server/extraction/evidence-reference-validation.test.ts`
- Create: `apps/web/src/server/extraction/registry.ts`
- Create: `apps/web/src/server/extraction/registry.test.ts`
- Create: `apps/web/src/server/extraction/tools/extract-dates.ts`
- Create: `apps/web/src/server/extraction/tools/extract-dates.test.ts`
- Create: `apps/web/src/server/extraction/tools/extract-contact-attempts.ts`
- Create: `apps/web/src/server/extraction/tools/extract-contact-attempts.test.ts`

**Interfaces:**
- Consumes: `ExtractedFactV1`, `JobArtifact`, `extractFactsFromArtifacts`.
- Produces: `ExtractionTool`, `ExtractionToolRegistry`, `validateEvidenceReferences`, `createDefaultExtractionToolRegistry`.

- [ ] **Step 1: Escribir RED de firewall Zod**

```ts
const outputSchema = z.object({ facts: z.array(extractedFactSchema) }).strict();
expect(outputSchema.safeParse({ facts: [] }).success).toBe(true);
for (const forbidden of ['outcome', 'suggestedOutcome', 'decision', 'resolution', 'ruleId', 'matchedRule', 'policyDecision']) {
  expect(outputSchema.safeParse({ facts: [], [forbidden]: 'CANCELACION_VENTA' }).success).toBe(false);
}
```

- [ ] **Step 2: Implementar contratos mínimos y GREEN**

El tool metadata será:

```ts
interface ExtractionTool<TInput, TOutput> {
  id: string;
  version: string;
  inputSchemaVersion: string;
  outputSchemaVersion: string;
  deterministic: boolean;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  execute(input: TInput, context: ExtractionToolContext): Promise<TOutput>;
}
```

- [ ] **Step 3: Escribir RED de evidence references**

Probar: ID inexistente, artifact de otra auditoría, hash distinto, artifact humano en modo blind y referencia permitida. `validateEvidenceReferences` devolverá errores con codes `EVIDENCE_NOT_FOUND`, `EVIDENCE_AUDIT_MISMATCH`, `EVIDENCE_HASH_MISMATCH`, `EVIDENCE_NOT_ALLOWED_BLIND`.

- [ ] **Step 4: Implementar y verificar GREEN**

```bash
pnpm --filter @cancelaciones/web exec vitest run src/server/extraction/evidence-reference-validation.test.ts
```

- [ ] **Step 5: Escribir RED de registry**

`registry.get('extract_dates')`, `registry.list()` y `registry.execute('extract_dates', input, context)` deben devolver metadata estable. Registrar tools duplicados debe lanzar `EXTRACTION_TOOL_DUPLICATE`.

- [ ] **Step 6: Implementar registry mínimo y GREEN**

- [ ] **Step 7: Escribir RED de `extract_dates`**

Reconocerá exclusivamente fechas estructuradas en `artifact.result.extractedFacts` cuyo `factType` sea `evidence.date` o `date`, con string ISO parseable. Sin fechas devolverá `facts: []`, no `false`.

- [ ] **Step 8: Implementar `extract_dates` con provenance completa**

Cada fact tendrá `state: 'OBSERVED'`, `extractionMethod: 'DETERMINISTIC'`, `extractorId: 'extract_dates'`, `extractorVersion: '1.0.0'`, evidence/artifact/hash de origen.

- [ ] **Step 9: Escribir RED e implementar `extract_contact_attempts`**

Llamará `extractFactsFromArtifacts({ auditId, runId: 'shadow', artifacts: [artifact] })`, filtrará `contact.callAttempts` y `contact.writtenInteractions`, y mapeará cada source a `FactProvenanceV1`. No copiará regex ni normalización de contactos.

- [ ] **Step 10: Verificar suite completa**

```bash
pnpm --filter @cancelaciones/web exec vitest run src/server/extraction
pnpm --filter @cancelaciones/web typecheck
```

Expected: PASS; ningún caller productivo importa el registry.

---

### Task 7: Blind sanitizer fail-closed y fingerprint determinista

**Files:**
- Modify: `apps/web/src/server/policy/blind-evidence-sanitizer.ts:18-162`
- Create: `apps/web/src/server/policy/blind-evidence-sanitizer.test.ts`
- Modify: `apps/web/src/server/policy/blind-audit.ts:82-278`
- Modify: `apps/web/src/server/policy/blind-audit.test.ts`

**Interfaces:**
- Produces: `BlindInputManifestV1`, `assertBlindManifestComplete`, `filterBlindArtifactsAndFacts`.
- Mantiene: `runBlindMachineAudit` no productivo.

- [ ] **Step 1: Escribir RED de fail-closed**

```ts
it('falla si un artifact no tiene evidencia permitida', () => {
  expect(() => assertBlindManifestComplete([{ artifactId: 'a1', evidenceId: '' }], new Set(['e1'])))
    .toThrow(/BLIND_MANIFEST_INCOMPLETE/);
});
```

- [ ] **Step 2: Implementar manifest y filtering GREEN**

El filtro usará un mapa explícito `artifactId -> evidenceId`; ya no indexará texto sólo por artifact y lo consultará por evidence ID sin relación. Evitará exclusiones duplicadas.

- [ ] **Step 3: Escribir RED de exclusión antes de extraction**

El test inyectará un interpreter/candidate fetcher que grabe los artifact IDs recibidos. El resultado será `fail closed` si `evidencesForSanitization` falta en modo blind estricto. `HUMAN_DECISION_DOCUMENT` y `ADJUDICATION_EVIDENCE` nunca llegarán al interpreter.

- [ ] **Step 4: Conectar filtering en `runBlindMachineAudit`**

Orden obligatorio:

```ts
const manifest = buildBlindInputManifest(input);
const allowedArtifacts = filterBlindArtifactsAndFacts(input.artifacts ?? [], manifest);
const allowedStoredFacts = filterBlindArtifactsAndFacts(input.storedFacts, manifest);
```

Si la entrada exige blind y el manifest está incompleto, devolver `BlindAuditFailure` con kind nuevo `BLIND_INPUT_INVALID`, sin crear facts sintéticas.

- [ ] **Step 5: Escribir RED de fingerprint estable**

Dos ejecuciones con artifacts equivalentes pero distintos `factRunId`, synthetic candidate IDs y `createdAt` deben producir igual `inputFingerprint`.

- [ ] **Step 6: Eliminar timestamps/IDs del fingerprint**

No usar `stableFingerprint` directamente sobre `StoredFact[]`. Crear `blindCanonicalInputV1` con:

```ts
{
  policyCode,
  policyVersion,
  extractorVersion: 'deterministic-v1',
  artifacts: artifacts.map(({ evidenceId, contentSha256, result }) => ({ evidenceId, contentSha256, result })),
  facts: storedFacts.map(({ factType, value, confidence, sourceRef }) => ({ factType, value, confidence, sourceRef })),
}
```

Ordenar artifacts/facts por hash canónico de su contenido, no por UUID o `created_at`.

- [ ] **Step 7: Verificar GREEN**

```bash
pnpm --filter @cancelaciones/web exec vitest run src/server/policy/blind-evidence-sanitizer.test.ts src/server/policy/blind-audit.test.ts
pnpm --filter @cancelaciones/web typecheck
```

Expected: PASS; el test histórico que acepta `MODEL_ERROR` no se usará como evidencia de sanitizer exitoso.

---

### Task 8: AI_DECISION_V1 durable e inmutable

**Files:**
- Create: `apps/web/src/server/policy/ai-decision-snapshot.ts`
- Create: `apps/web/src/server/policy/ai-decision-snapshot.test.ts`
- Modify: `apps/web/src/server/policy/blind-audit.ts:13-278`
- Modify: `packages/db/src/index.ts`
- Modify: `apps/web/src/server/policy/blind-audit.test.ts`

**Interfaces:**
- Produces: `buildAiDecisionV1Snapshot`, `hashAiDecisionV1Snapshot`, `createPolicyFoundationRepository(database).appendAiDecisionV1(snapshot)`.
- `appendAiDecisionV1` es sólo para callers explícitos; no añade caller productivo.

- [ ] **Step 1: Escribir RED de hash completo**

Cambiar dos campos no truncados, `evidenceRefs` y `policyCode`, y esperar hash distinto. No usar slices de 120 caracteres.

- [ ] **Step 2: Implementar snapshot completo**

```ts
interface AiDecisionV1Snapshot {
  auditId: string;
  factRunId: string;
  decisionVersion: 'AI_DECISION_V1';
  policyCode: string;
  policyVersion: string;
  policySourceId: string;
  engineVersion: string;
  promptVersion: string | null;
  extractorVersion: string;
  provider: string | null;
  model: string | null;
  inputFingerprint: string;
  decisionSnapshot: Record<string, unknown>;
  ruleTraceSnapshot: Record<string, unknown>;
  evidenceSnapshot: Record<string, unknown>;
  createdAt: string;
  hash: string;
}
```

`hash` calculará SHA-256 sobre todos los campos anteriores excepto el propio hash.

- [ ] **Step 3: Escribir RED de persistencia append-only con fake DB**

`appendAiDecisionV1` inserta una fila una sola vez y falla con `AI_DECISION_V1_ALREADY_EXISTS` ante colisión de audit/version/input fingerprint.

- [ ] **Step 4: Añadir wrapper explícito no productivo**

`runAndPersistBlindMachineAudit(input & { database })` llamará al runner, construirá snapshot sólo en éxito y persistirá. Un fallo DB producirá `PERSISTENCE_ERROR`, nunca un outcome oficial. No registrar esta función en routes/jobs.

- [ ] **Step 5: Verificar GREEN**

```bash
pnpm --filter @cancelaciones/web exec vitest run src/server/policy/ai-decision-snapshot.test.ts src/server/policy/blind-audit.test.ts
pnpm --filter @cancelaciones/web typecheck
```

Expected: PASS.

---

### Task 9: Migración DB de inmutabilidad, snapshots y envelopes

**Files:**
- Create: `migrations/*_policy-foundation-immutability.sql` generado con el CLI
- Modify: `packages/db/src/index.ts`
- Create: `apps/web/src/server/policy/fact-run-snapshot.dev-e2e.test.ts`
- Modify: `apps/web/package.json:5-13`

**Interfaces:**
- Produces: tablas `policy_source_registry`, `fact_run_frozen_snapshots`, `audit_evaluation_envelopes`, `ai_decision_snapshots`; columnas parent/derivation en `fact_extraction_runs`; RPCs `freeze_fact_run_v1`, `create_derived_fact_run_v1` y `persist_policy_evaluation_v1`.
- No modifica datos históricos ni outcomes.

- [ ] **Step 1: Enlazar el proyecto correcto y comparar migraciones**

```bash
npx @insforge/cli link --project-id 9e29e329-252e-481c-a632-95b71ee3df51 --org-id c470f104-2ebe-4a34-bd09-8d623b5d8b0a
npx @insforge/cli current
npx @insforge/cli memory list
npx @insforge/cli db migrations list --json
npx @insforge/cli db migrations fetch
```

Expected: backend `Cancelaciones`, appkey `4pw4jdzv`; no crear otro proyecto. Si `fetch` encuentra una divergencia de historia, detener el apply y documentarla.

- [ ] **Step 2: Crear la migración con CLI**

```bash
npx @insforge/cli db migrations new policy-foundation-immutability
```

Expected: un único filename válido bajo `migrations/`; usar exactamente el nombre impreso.

- [ ] **Step 3: Escribir SQL forward-only**

La migración debe:

- crear `policy_source_registry` con status check y SHA-256 check;
- insertar sólo la fuente local como `PENDING_VERIFICATION`;
- añadir `parent_fact_run_id`, `derivation_reason`, `created_by` y `effective_facts_fingerprint` a `fact_extraction_runs`;
- crear `fact_run_frozen_snapshots` con UNIQUE `fact_run_id`, facts, provenance, extractor version, policy source, canonical fingerprint e integrity hash;
- crear `audit_evaluation_envelopes` append-only ligado a engine run;
- crear `ai_decision_snapshots` append-only con todos los campos del snapshot y UNIQUE de versión/input;
- añadir FK real de `engine_runs.fact_run_id` si aún no existe;
- crear trigger `guard_fact_run_transition` que sólo permita `DRAFT -> PROCESSING|FAILED`, `PROCESSING -> FROZEN|FAILED`, y ninguna salida desde `FROZEN|FAILED`;
- crear trigger que bloquee INSERT en `facts` cuyo run esté `FROZEN`;
- bloquear UPDATE/DELETE de facts, snapshots, envelopes y `AI_DECISION_V1` para todos los roles salvo DDL/admin no garantizado por ACL;
- bloquear cambios de snapshots `engine_runs`, `engine_rule_results` y `audit_runs` cuando estén `COMPLETED`;
- revocar UPDATE/DELETE/INSERT directo de `engine_runs` y `engine_rule_results` a `authenticated`; permitir sólo RPC de escritura;
- crear RLS de SELECT por audit owner/OWNER para todas las tablas nuevas;
- crear `freeze_fact_run_v1` como `SECURITY DEFINER`, `SET search_path = pg_catalog, public, pg_temp`, que valida audit, policy, state `PROCESSING`, facts no vacías, inserta snapshot y cambia a `FROZEN` en una transacción;
- crear `create_derived_fact_run_v1`, que valida el run padre `FROZEN`, crea hechos y snapshot derivados, y no modifica el padre;
- crear `persist_policy_evaluation_v1`, que inserta engine run, rule results y envelope atómicamente y baseline idempotente.

- [ ] **Step 4: Escribir RED E2E de schema/RLS**

El E2E rechazará SELECT anónimo, validará metadata de ACL con `has_table_privilege` y ejecutará un probe SQL transaccional con rollback explícito para comprobar:

```text
UPDATE frozen fact -> error
DELETE frozen snapshot -> error
UPDATE completed AI_DECISION_V1 -> error
INSERT fact into FROZEN run -> error
derived correction leaves parent fingerprint unchanged
```

- [ ] **Step 5: Aplicar la migración**

```bash
MIGRATION_FILE="$(node -e "const fs=require('fs');const path=require('path');const dir='migrations';const file=fs.readdirSync(dir).filter((name)=>name.endsWith('_policy-foundation-immutability.sql')).sort().at(-1);if(!file)process.exit(1);process.stdout.write(path.join(dir,file));")"
npx @insforge/cli db migrations up "$MIGRATION_FILE"
npx @insforge/cli db migrations list --json
```

Expected: migración aplicada una vez. No editar migraciones ya aplicadas.

- [ ] **Step 6: Ejecutar E2E DEV**

```bash
pnpm --filter @cancelaciones/web test:policy-foundation:dev-e2e
```

Expected: PASS en backend DEV appkey `4pw4jdzv-cif` configurado por `.env.local`; si falta env, `DB VALIDATION: BLOCKED`, sin simular PASS.

- [ ] **Step 7: Guardar evidencia DB**

```bash
npx @insforge/cli db migrations list --json
```

Expected: el historial remoto incluye exactamente la migración aplicada; registrar version y nombre del output estructurado.

---

### Task 10: Integrar snapshots y correcciones humanas sin cambiar outcomes

**Files:**
- Create: `apps/web/src/server/facts/fact-run-snapshot.ts`
- Create: `apps/web/src/server/facts/fact-run-snapshot.test.ts`
- Create: `apps/web/src/server/facts/human-correction.ts`
- Create: `apps/web/src/server/facts/human-correction.test.ts`
- Modify: `apps/web/src/server/policy/evaluation.ts:15-79`
- Modify: `apps/web/src/server/jobs/handlers.ts:36-199`
- Modify: `apps/web/src/app/api/audits/[auditId]/fact-reviews/route.ts:25-42`
- Modify: `apps/web/src/server/policy/frozen-fact-run.ts:4-66`

**Interfaces:**
- Produces: `freezeFactRunWithSnapshot`, `getFrozenEffectiveFacts`, `deriveFactRunFromReviews`, `persistPolicyEvaluationAtomically`.
- `runPolicyEngineForAudit` deja de consultar `fact_reviews` para facts efectivos.

- [ ] **Step 1: Escribir RED de compatibilidad del snapshot**

Para un FROZEN legacy sin snapshot, `getFrozenEffectiveFacts` capturará una vez los facts/revisiones actuales, marcará provenance `IMPORTED`/`HUMAN` y almacenará el resultado. Una segunda llamada devolverá el mismo snapshot aunque se añada otra review.

- [ ] **Step 2: Implementar adapter legacy y GREEN**

El primer cálculo conserva exactamente el comportamiento actual para no cambiar outcomes. La siguiente ejecución queda estable.

- [ ] **Step 3: Escribir RED de corrección → nuevo run**

```ts
expect(derived.parentFactRunId).toBe(original.id)
expect(derived.state).toBe('FROZEN')
expect(await getOriginalFingerprint(original.id)).toBe(originalFingerprint)
expect(derived.factType).toBe('classroom.hasGrades')
expect(derived.provenance.some((p) => p.extractionMethod === 'HUMAN')).toBe(true)
```

- [ ] **Step 4: Conectar `POST /fact-reviews`**

Después de insertar la review append-only, si existe `correctedValue`, llamar `deriveFactRunFromReviews`. La respuesta conservará campos actuales y añadirá `derivedFactRunId` de forma compatible.

- [ ] **Step 5: Escribir RED de evaluación estable**

`runPolicyEngineForAudit` con el mismo Fact Run/snapshot debe producir una evaluación idéntica, aunque `fact_reviews` cambie. Debe usar el RPC atómico y reutilizar el mismo engine run/snapshot sin actualizar resultados.

- [ ] **Step 6: Eliminar aplicación retrospectiva de reviews**

Eliminar de `evaluation.ts` la consulta a `fact_reviews` y el map de `corrected_value`. Leer `fact_run_frozen_snapshots.facts` y mapear con un adapter compatible a `Fact[]`.

- [ ] **Step 7: Reemplazar freeze directo en jobs**

Cambiar el `UPDATE fact_extraction_runs SET state='FROZEN'` por `freeze_fact_run_v1` con facts, canonical fingerprint e integrity hash. El adapter debe mantener compatibilidad con el DurableDb fake; añadir un branch explícito `typeof database.rpc === 'function'` sólo para tests locales, sin falsear DB validation.

- [ ] **Step 8: Verificar pipeline y Golden Master**

```bash
pnpm --filter @cancelaciones/web test
pnpm --filter @cancelaciones/policy-engine test
pnpm --filter @cancelaciones/web test:audit:e2e
```

Expected: PASS; no hay cambios en outcomes/rules del motor.

---

### Task 11: Documentación arquitectónica

**Files:**
- Create: `docs/architecture/fact-immutability.md`
- Create: `docs/architecture/ai-decision-snapshots.md`
- Create: `docs/architecture/extraction-tools.md`
- Create: `docs/architecture/policy-boundary.md`
- Create: `docs/testing/golden-master.md`

**Interfaces:**
- Documenta contratos y límites sin crear comportamiento productivo.

- [ ] **Step 1: Escribir `fact-immutability.md`**

Incluir diagrama FROZEN → derived run, columnas DB, triggers, RPCs, legacy capture y rollback lógico.

- [ ] **Step 2: Escribir `ai-decision-snapshots.md`**

Incluir todos los campos, canonical input vs integrity hash, append-only y separación human correction.

- [ ] **Step 3: Escribir `extraction-tools.md`**

Incluir contrato, registry, schemas, provenance, UNKNOWN, shadow/test-only y LLM future pipeline.

- [ ] **Step 4: Escribir `policy-boundary.md`**

Incluir explícitamente:

```text
Extraction Tool != Policy Rule
Fact Confidence != Decision Confidence
Evidence Completeness != Policy Outcome
System Failure != Indeterminate Policy Decision
```

- [ ] **Step 5: Escribir `golden-master.md`**

Incluir corpus, command, hash, política de no auto-update y protocolo para divergencias normativas.

- [ ] **Step 6: Validar enlaces y ausencia de afirmaciones normativas**

```bash
rg -n "CANONICAL|5\.7\.e|5\.8\.a|auto.?update|OpenRouter" docs/architecture docs/testing
```

Expected: cualquier `CANONICAL` aparece sólo como status/prohibición; las divergencias 5.7.e/5.8.a siguen marcadas `REQUIRES_OWNER_DECISION`.

---

### Task 12: Reporte y matriz final

**Files:**
- Create: `docs/reports/POLICY-FOUNDATION-REMEDIATION-REPORT.md`

**Interfaces:**
- Entregable final para revisión humana; no inicia la siguiente fase.

- [ ] **Step 1: Ejecutar matriz final completa**

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
pnpm --filter @cancelaciones/policy-engine test -- golden-master.test.ts
pnpm --filter @cancelaciones/web test:policy-foundation:dev-e2e
npx @insforge/cli db migrations list --json
```

Expected: registrar PASS/FAIL/BLOCKED con output real. No declarar PASS por inferencia.

- [ ] **Step 2: Comprobar diff normativo**

```bash
git diff -- packages/policy-engine/src/index.ts
```

Expected: sólo exports nuevos alrededor del archivo; `v5Rules`, `policySets` y `evaluatePolicy` sin cambios.

- [ ] **Step 3: Comprobar que tools/shadow no son productivos**

```bash
rg -n "createDefaultExtractionToolRegistry|ShadowPolicyEngine|runAndPersistBlindMachineAudit" apps/web/src/app apps/web/src/server/jobs
```

Expected: sin resultados productivos; sólo tests/módulos shadow.

- [ ] **Step 4: Generar las 30 secciones obligatorias**

El reporte debe incluir exactamente las secciones 1-30 solicitadas, evidencia de archivos/tests/migraciones, baseline original, regresión, divergencias normativas, riesgos, blockers y readiness matrix. No pegar reportes históricos como evidencia actual.

- [ ] **Step 5: Añadir readiness matrix**

```markdown
| Capability | Status | Evidence |
|---|---|---|
| Policy source canonical | BLOCKED | fuente local sigue PENDING_VERIFICATION |
| Golden Master | PASS | test + fixture hash |
| Frozen Fact Runs immutable | PASS/FAIL | trigger/RPC + E2E |
| AI_DECISION_V1 durable | PASS/FAIL | tabla + repo + E2E |
| AI_DECISION_V1 immutable | PASS/FAIL | trigger + E2E |
| Human corrections versioned | PASS/FAIL | derived run test |
| State separation | PASS | envelope tests |
| Full fact provenance | PASS/FAIL | contract/tool tests |
| Tool contract | PASS | Zod tests |
| Tool registry | PASS | registry tests |
| Policy firewall | PASS | forbidden-field tests |
| Evidence ref validation | PASS | invented-ref tests |
| Blind sanitization | PASS/FAIL | pre-extraction filter test |
| Stable fingerprints | PASS | repeated-run test |
| Golden tests | PASS | two-run suite |
| Shadow engine boundary | PASS | type/API test |
| Declarative migration ready | YES/NO | readiness conclusion |
| LLM extraction tools ready | YES/NO | readiness conclusion |
```

- [ ] **Step 6: Detenerse**

Entregar el reporte al usuario. No implementar `EXTRACTION TOOLS + DECLARATIVE SHADOW ENGINE` hasta nueva autorización.

---

## Plan Self-Review

- Spec coverage: todos los objetivos 1-10, pruebas obligatorias, docs, DB, legacy, validación y readiness matrix están asignados a una tarea.
- Scope: no incluye migración declarativa, outcomes, prompts, OpenRouter productivo ni tools reales adicionales.
- Type consistency: `ExtractedFactV1`, `canonicalFingerprintV1`, `AI_DECISION_V1` y `ShadowPolicyResult` se definen antes de sus consumidores.
- Normative safety: todo hit 5.2/5.7.e/5.8.a queda como baseline o `REQUIRES_OWNER_DECISION`.
- Placeholder scan: no hay marcadores pendientes ni interfaces sin definir; el nombre de migration se obtiene del comando oficial porque InsForge asigna el siguiente timestamp remoto.
