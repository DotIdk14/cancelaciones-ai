# Panel de Dictamen de Auditoría — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reducir el inspector derecho del workspace de auditoría a tres pestañas (`dictamen`, `reglas`, `comentarios`), migrar la carga de evidencia al botón `+ Agregar` del panel de archivos, y añadir un botón «Volver a iniciar el dictamen con otros hechos» que recalcula de verdad.

**Architecture:** El backend gana una única implementación de frescura de Fact Runs (`selectFactRunForEvaluation`) que decide entre reutilizar el run congelado vigente, reutilizar uno en curso, o crear uno derivado; y un fingerprint de entrada que se mete en la clave de idempotencia de `AUDIT_EVALUATION` para que el recálculo no colisione con la evaluación anterior. El frontend extrae la lógica a módulos puros testeables en `environment: 'node'` y deja los componentes como conchas finas: `JobAutoResume` (drena la cola, invisible), `EvidenceUploader` (botón `+ Agregar`) y `FactReviewPanel` (hechos, revisiones y botón de recálculo).

**Tech Stack:** Next.js 15.5 (App Router, Server Components), React 19, TypeScript 5.8 estricto, Tailwind 3.4, InsForge SDK 1.5 (Postgres), Vitest 2.1 (`environment: 'node'`), pnpm 9.15.4.

**Spec:** `docs/superpowers/specs/2026-09-25-auditoria-dictamen-panel-design.md` — el plan razona a partir del spec, así que ambos viajan juntos.

## Global Constraints

- Autoridad normativa: `GDM_GAM_PRD_MLG_003` versión `5`. No se modifica, no se busca en internet, no se infiere.
- Un Fact Run `FROZEN` es irreversible. Un recálculo crea un Fact Run **nuevo** con `parent_fact_run_id` y `derivation_reason`; nunca muta el anterior.
- `AI_BASELINE` es append-only. `recordBaselineRun` es idempotente por `engine_run_id` y nunca sobrescribe.
- `UNKNOWN` nunca se convierte en `FALSE`.
- Aislamiento de línea base: solo evidencias con `documentRole === 'EVIDENCE'` entran al conjunto de artefactos. El dictamen humano y las evidencias de adjudicación quedan fuera.
- `DO_NOT_REPROCESS_AI_UNNECESSARILY`: si el conjunto de artefactos no cambió, no se re-extrae. La IA (AssemblyAI / OpenRouter) corre **una vez por evidencia**, en `EVIDENCE_PROCESSING`; la extracción de hechos (`extractFactsFromArtifacts`) es determinista y sin IA.
- `NO_PII_IN_GIT`: los tests usan auditorías y evidencias sintéticas.
- Sin dependencias nuevas. No se agrega `jsdom`, `@testing-library/react` ni ninguna librería: el repo prueba lógica pura en `environment: 'node'` y los 22 archivos de test existentes lo hacen así.
- Convenciones de idioma: documentación y comentarios en español; identificadores en inglés. Sin tildes en identificadores ni en claves de objeto.
- Comandos: `pnpm --filter @cancelaciones/web test` (unit), `pnpm --filter @cancelaciones/web typecheck`, `pnpm --filter @cancelaciones/web lint`, `pnpm --filter @cancelaciones/web build`. `pnpm test` desde la raíz corre los cuatro paquetes.

## Review Focus

Cinco condiciones que el spec implica pero que ningún test del plan cubre explícitamente, ordenadas por probabilidad de morder. Cada una tiene su test asignado en la tarea indicada.

1. **Revisiones múltiples del mismo `fact_id`.** `fact_reviews` es append-only: revisar un hecho tres veces deja tres filas. El motor toma la más reciente por `fact_id` (`policy/evaluation.ts:34-35`). Si el fingerprint de entrada usara *todas* las filas, una revisión antigua reescrita con el mismo valor inflaría la clave sin cambiar el resultado. → Task 3.
2. **`corrected_value: null` explícito vs. ausente.** `evaluation.ts:41` trata `null` y `undefined` igual (deja el `value` original). El fingerprint debe hacer lo mismo: guardar `corrected_value: null` no puede cambiar la clave, porque el resultado es idéntico. → Task 3.
3. **Orden de artifacts no determinista.** `listArtifactsByAudit` ordena por `created_at DESC` y dos artifacts pueden compartir timestamp, así que el string del fingerprint puede diferir en orden sin que el conjunto haya cambiado. `decideFactRun` debe devolver la misma decisión ante el mismo conjunto en distinto orden. → Task 2.
4. **Evidencia re-subida con contenido idéntico.** El artifact tiene `id` nuevo (el `id` es UUID de artifact, no hash del contenido), así que el conjunto cambia y se re-extrae. Es el comportamiento correcto —la evidencia es un hecho nuevo— pero consume un ciclo completo del pipeline. `EvidenceUploader` debe decirlo en su mensaje final en vez de dejar surprises. → Task 8.
5. **Dictamen aprobado y el botón por teclado.** Con `snapshot.status === 'FINAL'` el botón está deshabilitado. Un `disabled` sin texto explicativo deja al usuario de teclado sin saber por qué no ocurre nada. El aviso debe ser texto renderizado, no `title` ni `aria-label`. → Task 9.

---

## File Structure

**Backend nuevo**

| Archivo | Responsabilidad única |
|---|---|
| `apps/web/src/server/facts/artifact-set.ts` | Construir y comparar conjuntos de artefactos; parsear el fingerprint almacenado. Puro. |
| `apps/web/src/server/facts/artifact-set.test.ts` | Matriz de parseo y comparación. |
| `apps/web/src/server/facts/run-selection.ts` | `decideFactRun` (puro) + `selectFactRunForEvaluation` (carga) + `createFactRunForSelection` (deriva con fallback 23505). |
| `apps/web/src/server/facts/run-selection.test.ts` | Matriz de decisión y derivación. |
| `apps/web/src/server/policy/evaluation-job.ts` | `evaluationInputFingerprint` + `auditEvaluationJobSpec`. Puro. |
| `apps/web/src/server/policy/evaluation-job.test.ts` | Matriz de clave y scope. |

**Frontend nuevo**

| Archivo | Responsabilidad única |
|---|---|
| `apps/web/src/lib/job-queue.ts` | `hasActiveJobs` (puro) + `drainQueue` con `fetch` inyectable. |
| `apps/web/src/lib/job-queue.test.ts` | Drenado, job fallido, tope de intentos. |
| `apps/web/src/lib/fact-review-state.ts` | `summarizeReviews` y `canRecalculate` (puros). |
| `apps/web/src/lib/fact-review-state.test.ts` | Resumen y elegibilidad. |
| `apps/web/src/app/(private)/auditorias/[auditId]/components/JobAutoResume.tsx` | Montar, drenar si hay cola activa, reportar error. Sin UI. |
| `.../components/EvidenceUploader.tsx` | Input oculto, subida, encolado, franja de estado. |
| `.../components/FactReviewPanel.tsx` | Lista de hechos, revisiones, botón de recálculo. |
| `.../components/ComparisonInspector.tsx` | Extraído de `AuditWorkspace.tsx:186-227`. |
| `.../comparacion/page.tsx` | Ruta de comparación IA vs humano. |

**Modificados**

| Archivo | Cambio |
|---|---|
| `apps/web/src/server/jobs/handlers.ts` | `enqueueFactExtractionIfReady` usa el helper; `enqueueAuditEvaluation` usa `auditEvaluationJobSpec`. |
| `apps/web/src/app/api/audits/[auditId]/jobs/route.ts` | `EXTRACT_FACTS` con semántica *ensure-current*. |
| `apps/web/src/server/dictamen/service.ts` | Guard `HUMAN_REVIEW_STALE`. |
| `apps/web/src/app/api/audits/[auditId]/dictamen/approve/route.ts` | Mapea `HUMAN_REVIEW_STALE` a 409. |
| `apps/web/src/app/api/audits/[auditId]/fact-reviews/route.ts` | Valida la forma de `correctedValue`. |
| `apps/web/src/server/extraction/contracts.ts` (nuevo helper) | `validateCorrectedValueShape`. Se ubica aquí porque `apps/web/src/server/extraction/contracts.ts` ya valida contratos de entrada. |
| `packages/db/src/index.ts` | `parentFactRunId` / `derivationReason` en `FactExtractionRun` y `createRun`. |
| `apps/web/src/app/(private)/auditorias/[auditId]/page.tsx` | Proyecta la selección de evidencias; deja de pasar cinco props. |
| `.../components/AuditWorkspace.tsx` | Tres pestañas; monta los tres componentes nuevos. |
| `.../components/DictamenWorkflow.tsx` | Refleja el guard; lista todos los documentos. |
| `.../components/types.ts` | `FactRow`, `FactReviewRow`. |

**Borrados**

`AuditWorkflow.tsx`, `HumanFactReview.tsx`, `PolicyEvaluationPanel.tsx`, `MachineDecisionCard.tsx`, `ReportPreviewCard.tsx`, `MissingItemsPanel.tsx`.

---

## Task 1: Migración de derivación de Fact Runs

**Files:**
- Create: `migrations/20260925120000_fact-run-derivation.sql`
- Modify: `packages/db/src/index.ts:108-130` (interfaces), `packages/db/src/index.ts:293-295` (`mapFactRun`), `packages/db/src/index.ts:673-685` (`createRun`)

**Interfaces:**
- Consumes: nada.
- Produces: `FactExtractionRun.parentFactRunId: string | null`, `FactExtractionRun.derivationReason: string | null`, y `createRun(input)` acepta `parentFactRunId?: string | null` y `derivationReason?: string | null`. Todas las llamadas existentes siguen compilando porque ambos son opcionales.

- [ ] **Step 1: Escribir la migración**

```sql
-- Cierra la brecha del spec 2026-09-24: toda corrección humana crea otro
-- Fact Run con parentFactRunId y motivo de derivación. Los runs previos al
-- despliegue quedan con ambos campos en NULL: no es posible reconstruir la
-- derivación real y no se inventa.
ALTER TABLE public.fact_extraction_runs
  ADD COLUMN IF NOT EXISTS parent_fact_run_id uuid
    REFERENCES public.fact_extraction_runs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS derivation_reason text;

CREATE INDEX IF NOT EXISTS fact_runs_parent_idx
  ON public.fact_extraction_runs (parent_fact_run_id)
  WHERE parent_fact_run_id IS NOT NULL;
```

- [ ] **Step 2: Ampliar las interfaces y el mapper**

En `packages/db/src/index.ts`, reemplazar el bloque de `FactExtractionRun` (líneas 108-130) por:

```ts
export interface FactExtractionRun {
  id: string;
  auditId: string;
  policyCode: string;
  policyVersion: string;
  extractorVersion: string;
  artifactSetFingerprint: string;
  state: 'DRAFT' | 'PROCESSING' | 'FAILED' | 'FROZEN';
  frozenAt: string | null;
  /** Fact Run del que se derivó este. NULL para el run original. */
  parentFactRunId: string | null;
  /** Motivo de la derivación. NULL para el run original. */
  derivationReason: string | null;
  createdAt: string;
}

interface FactExtractionRunRow {
  id: string;
  audit_id: string;
  policy_code: string;
  policy_version: string;
  extractor_version: string;
  artifact_set_fingerprint: string;
  state: FactExtractionRun['state'];
  frozen_at: string | null;
  parent_fact_run_id: string | null;
  derivation_reason: string | null;
  created_at: string;
}
```

Actualizar `runColumns` (línea 657) añadiendo `parent_fact_run_id, derivation_reason`, y `mapFactRun` (línea 293) por:

```ts
function mapFactRun(row: FactExtractionRunRow): FactExtractionRun {
  return {
    id: row.id,
    auditId: row.audit_id,
    policyCode: row.policy_code,
    policyVersion: row.policy_version,
    extractorVersion: row.extractor_version,
    artifactSetFingerprint: row.artifact_set_fingerprint,
    state: row.state,
    frozenAt: row.frozen_at,
    parentFactRunId: row.parent_fact_run_id,
    derivationReason: row.derivation_reason,
    createdAt: row.created_at,
  };
}
```

- [ ] **Step 3: Ampliar `createRun`**

Reemplazar `createRun` (líneas 673-685) por:

```ts
    async createRun(input: { auditId: string; policyCode: string; policyVersion: string; extractorVersion: string; artifactSetFingerprint: string; createdBy: string; parentFactRunId?: string | null; derivationReason?: string | null }): Promise<FactExtractionRun> {
      const { data, error } = await database.from('fact_extraction_runs').insert([{
        audit_id: input.auditId,
        policy_code: input.policyCode,
        policy_version: input.policyVersion,
        extractor_version: input.extractorVersion,
        artifact_set_fingerprint: input.artifactSetFingerprint,
        state: 'DRAFT',
        created_by: input.createdBy,
        parent_fact_run_id: input.parentFactRunId ?? null,
        derivation_reason: input.derivationReason ?? null,
      }]).select(runColumns).single();
      if (error || !data) throw new Error(error?.message ?? 'No fue posible crear fact run');
      return mapFactRun(data);
    },
```

- [ ] **Step 4: Verificar que nada se rompió**

Run: `pnpm --filter @cancelaciones/web typecheck && pnpm --filter @cancelaciones/web test`
Expected: PASS. `jobs/route.ts:57`, `handlers.ts:52` y `api/dev/synthetic-case/route.ts:228` llaman `createRun` sin los campos nuevos, y como son opcionales compilan igual.

- [ ] **Step 5: Commit**

```bash
git add migrations/20260925120000_fact-run-derivation.sql packages/db/src/index.ts
git commit -m "feat(db): derivacion de Fact Runs con parent y motivo

Cierra la brecha del spec del 2026-09-24: la invariante 'toda correccion
humana crea otro Fact Run con parentFactRunId y motivo de derivacion' estaba
declarada pero el esquema no la implementaba."
```

---

## Task 2: Conjunto de artefactos y decisión de Fact Run

**Files:**
- Create: `apps/web/src/server/facts/artifact-set.ts`, `apps/web/src/server/facts/artifact-set.test.ts`, `apps/web/src/server/facts/run-selection.ts`, `apps/web/src/server/facts/run-selection.test.ts`

**Interfaces:**
- Consumes: `FactExtractionRun` de Task 1; `createFactRepository`, `createJobRepository` de `@cancelaciones/db`.
- Produces:
  - `type ArtifactSet = Set<string>` (entradas con forma `${artifactId}:${contentSha256}`).
  - `buildArtifactSet(artifacts: Array<{ id: string; contentSha256: string | null }>): ArtifactSet`
  - `parseArtifactSet(fingerprint: string): ArtifactSet | null`
  - `artifactSetsEqual(a: ArtifactSet, b: ArtifactSet): boolean`
  - `type FactRunSelection` y `decideFactRun(input: { runs: FactExtractionRun[]; currentArtifacts: ArtifactSet }): FactRunSelection`
  - `selectFactRunForEvaluation(input: { database: DatabaseClient; auditId: string }): Promise<FactRunSelection>`
  - `createFactRunForSelection(input: { database: DatabaseClient; auditId: string; actorId: string; selection: Extract<FactRunSelection, { action: 'CREATE' }> }): Promise<FactExtractionRun>`

- [ ] **Step 1: Escribir el test de `artifact-set`**

```ts
// apps/web/src/server/facts/artifact-set.test.ts
import { describe, expect, it } from 'vitest';
import { artifactSetsEqual, buildArtifactSet, parseArtifactSet } from './artifact-set';

describe('buildArtifactSet', () => {
  it('indexa por id y hash de contenido', () => {
    const set = buildArtifactSet([
      { id: 'art-1', contentSha256: 'aaa' },
      { id: 'art-2', contentSha256: null },
    ]);
    expect(Array.from(set).sort()).toEqual(['art-1:aaa', 'art-2:']);
  });
});

describe('parseArtifactSet', () => {
  it('parsea el fingerprint canonico que escribe artifactSetFingerprint', () => {
    const fingerprint = JSON.stringify([
      { id: 'art-1', type: 'visual-transcription', sha256: 'aaa', evidenceId: 'ev-1' },
      { id: 'art-2', type: 'document-text', sha256: null, evidenceId: 'ev-2' },
    ]);
    expect(parseArtifactSet(fingerprint)).toEqual(new Set(['art-1:aaa', 'art-2:']));
  });

  it('devuelve null con un string que no es el formato esperado', () => {
    expect(parseArtifactSet('legacy-sha256-plano')).toBeNull();
    expect(parseArtifactSet('{"no":"es","arreglo":"json"}')).toBeNull();
    expect(parseArtifactSet('no es json')).toBeNull();
  });

  it('devuelve null si una entrada no trae id', () => {
    expect(parseArtifactSet('[{"type":"document-text","sha256":"aaa"}]')).toBeNull();
  });
});

describe('artifactSetsEqual', () => {
  it('no depende del orden de insercion', () => {
    const a = buildArtifactSet([{ id: 'art-1', contentSha256: 'aaa' }, { id: 'art-2', contentSha256: 'bbb' }]);
    const b = buildArtifactSet([{ id: 'art-2', contentSha256: 'bbb' }, { id: 'art-1', contentSha256: 'aaa' }]);
    expect(artifactSetsEqual(a, b)).toBe(true);
  });

  it('distingue mismo contenido con artifact id distinto', () => {
    const a = buildArtifactSet([{ id: 'art-1', contentSha256: 'aaa' }]);
    const b = buildArtifactSet([{ id: 'art-2', contentSha256: 'aaa' }]);
    expect(artifactSetsEqual(a, b)).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm --filter @cancelaciones/web test src/server/facts/artifact-set.test.ts`
Expected: FAIL con `Cannot find module './artifact-set'`.

- [ ] **Step 3: Implementar `artifact-set.ts`**

```ts
// apps/web/src/server/facts/artifact-set.ts
// El fingerprint de artefactos se compara como conjunto, nunca como string:
// listArtifactsByAudit ordena por created_at DESC y dos artifacts pueden
// compartir timestamp, asi que el orden no es un orden total.

/** Entradas con forma `${artifactId}:${contentSha256}`. */
export type ArtifactSet = Set<string>;

export function buildArtifactSet(artifacts: Array<{ id: string; contentSha256: string | null }>): ArtifactSet {
  return new Set(artifacts.map((artifact) => `${artifact.id}:${artifact.contentSha256 ?? ''}`));
}

/** Parsea el `artifact_set_fingerprint` almacenado. null si el formato no es el esperado. */
export function parseArtifactSet(fingerprint: string): ArtifactSet | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fingerprint);
  } catch {
    return null;
  }
  if (!Array.isArray(parsed)) return null;
  const set: ArtifactSet = new Set();
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object') return null;
    const record = entry as { id?: unknown; sha256?: unknown };
    if (typeof record.id !== 'string') return null;
    set.add(`${record.id}:${typeof record.sha256 === 'string' ? record.sha256 : ''}`);
  }
  return set;
}

export function artifactSetsEqual(a: ArtifactSet, b: ArtifactSet): boolean {
  if (a.size !== b.size) return false;
  for (const entry of a) if (!b.has(entry)) return false;
  return true;
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm --filter @cancelaciones/web test src/server/facts/artifact-set.test.ts`
Expected: PASS, 7 tests.

- [ ] **Step 5: Escribir el test de `decideFactRun`**

```ts
// apps/web/src/server/facts/run-selection.test.ts
import { describe, expect, it } from 'vitest';
import type { FactExtractionRun } from '@cancelaciones/db';
import { decideFactRun } from './run-selection';
import { buildArtifactSet } from './artifact-set';

const currentArtifacts = buildArtifactSet([{ id: 'art-1', contentSha256: 'aaa' }]);
const staleArtifacts = buildArtifactSet([{ id: 'art-9', contentSha256: 'zzz' }]);

function run(overrides: Partial<FactExtractionRun>): FactExtractionRun {
  return {
    id: 'fr-1',
    auditId: 'audit-1',
    policyCode: 'GDM_GAM_PRD_MLG_003',
    policyVersion: '5',
    extractorVersion: 'deterministic-facts-v1',
    artifactSetFingerprint: JSON.stringify([{ id: 'art-1', type: 'visual-transcription', sha256: 'aaa', evidenceId: 'ev-1' }]),
    state: 'FROZEN',
    frozenAt: '2026-09-25T10:00:00.000Z',
    parentFactRunId: null,
    derivationReason: null,
    createdAt: '2026-09-25T09:00:00.000Z',
    ...overrides,
  };
}

const currentFingerprint = JSON.stringify([{ id: 'art-1', type: 'visual-transcription', sha256: 'aaa', evidenceId: 'ev-1' }]);
const staleFingerprint = JSON.stringify([{ id: 'art-9', type: 'visual-transcription', sha256: 'zzz', evidenceId: 'ev-9' }]);

describe('decideFactRun', () => {
  it('reutiliza un run DRAFT cuyo conjunto de artefactos coincide', () => {
    const selection = decideFactRun({ runs: [run({ state: 'DRAFT' })], currentArtifacts });
    expect(selection).toMatchObject({ action: 'REUSE_ACTIVE' });
    expect(selection.action === 'REUSE_ACTIVE' && selection.run.id).toBe('fr-1');
  });

  it('reutiliza un run PROCESSING cuyo conjunto de artefactos coincide', () => {
    expect(decideFactRun({ runs: [run({ state: 'PROCESSING' })], currentArtifacts })).toMatchObject({ action: 'REUSE_ACTIVE' });
  });

  it('reutiliza un run FROZEN vigente sin reprocesar', () => {
    expect(decideFactRun({ runs: [run({})], currentArtifacts })).toMatchObject({ action: 'REUSE_FROZEN' });
  });

  it('crea un run nuevo cuando el FROZEN tiene otro conjunto de artefactos', () => {
    const selection = decideFactRun({
      runs: [run({ id: 'fr-old', artifactSetFingerprint: staleFingerprint })],
      currentArtifacts,
    });
    expect(selection.action).toBe('CREATE');
    expect(selection.action === 'CREATE' && selection.staleFrozen?.id).toBe('fr-old');
  });

  it('prefiere el run activo vigente sobre el FROZEN vigente', () => {
    const selection = decideFactRun({
      runs: [run({ id: 'fr-frozen' }), run({ id: 'fr-active', state: 'PROCESSING' })],
      currentArtifacts,
    });
    expect(selection.action === 'REUSE_ACTIVE' && selection.run.id).toBe('fr-active');
  });

  it('no depende del orden de los artifacts en el fingerprint almacenado', () => {
    const reversed = JSON.stringify([{ evidenceId: 'ev-0', sha256: 'bbb', type: 'document-text', id: 'art-0' }]);
    const two = buildArtifactSet([{ id: 'art-0', contentSha256: 'bbb' }, { id: 'art-1', contentSha256: 'aaa' }]);
    const selection = decideFactRun({
      runs: [run({ artifactSetFingerprint: JSON.stringify([
        { id: 'art-1', type: 'visual-transcription', sha256: 'aaa', evidenceId: 'ev-1' },
        { id: 'art-0', type: 'document-text', sha256: 'bbb', evidenceId: 'ev-0' },
      ]) })],
      currentArtifacts: two,
    });
    expect(selection).toMatchObject({ action: 'REUSE_FROZEN' });
    expect(selection).toMatchObject({ currentArtifacts: two });
    expect(reversed.length).toBeGreaterThan(0);
  });

  it('trata un fingerprint no parseable como obsoleto (fail-safe)', () => {
    const selection = decideFactRun({ runs: [run({ artifactSetFingerprint: 'legacy-plano' })], currentArtifacts });
    expect(selection.action).toBe('CREATE');
  });

  it('crea cuando no hay runs', () => {
    const selection = decideFactRun({ runs: [], currentArtifacts });
    expect(selection).toMatchObject({ action: 'CREATE' });
    expect(selection.action === 'CREATE' && selection.staleFrozen).toBeNull();
  });
});
```

- [ ] **Step 6: Correr el test y verificar que falla**

Run: `pnpm --filter @cancelaciones/web test src/server/facts/run-selection.test.ts`
Expected: FAIL con `Cannot find module './run-selection'`.

- [ ] **Step 7: Implementar `run-selection.ts`**

```ts
// apps/web/src/server/facts/run-selection.ts
// Unica implementacion de la regla de frescura de Fact Runs. Los dos
// cortocircuitos historicos (jobs/route.ts y handlers.ts) la consumen para no
// duplicar la decision.
import { createFactRepository, createJobRepository, type DatabaseClient, type FactExtractionRun } from '@cancelaciones/db';
import { artifactSetsEqual, buildArtifactSet, parseArtifactSet, type ArtifactSet } from './artifact-set';

export const POLICY_CODE = 'GDM_GAM_PRD_MLG_003';
export const POLICY_VERSION = '5';
export const EXTRACTOR_VERSION = 'deterministic-facts-v1';

export type DerivationReason = 'EVIDENCE_SET_CHANGED' | 'MANUAL_REEXTRACTION';

export type FactRunSelection =
  | { action: 'REUSE_ACTIVE'; run: FactExtractionRun; currentArtifacts: ArtifactSet }
  | { action: 'REUSE_FROZEN'; run: FactExtractionRun; currentArtifacts: ArtifactSet }
  | { action: 'CREATE'; staleFrozen: FactExtractionRun | null; currentArtifacts: ArtifactSet };

/** Decision pura: no toca la base de datos. */
export function decideFactRun(input: { runs: FactExtractionRun[]; currentArtifacts: ArtifactSet }): FactRunSelection {
  const matches = (candidate: FactExtractionRun) => {
    const stored = parseArtifactSet(candidate.artifactSetFingerprint);
    return stored !== null && artifactSetsEqual(stored, input.currentArtifacts);
  };
  const active = input.runs.find((candidate) => (candidate.state === 'DRAFT' || candidate.state === 'PROCESSING') && matches(candidate));
  if (active) return { action: 'REUSE_ACTIVE', run: active, currentArtifacts: input.currentArtifacts };
  const frozen = input.runs.find((candidate) => candidate.state === 'FROZEN' && matches(candidate));
  if (frozen) return { action: 'REUSE_FROZEN', run: frozen, currentArtifacts: input.currentArtifacts };
  return {
    action: 'CREATE',
    staleFrozen: input.runs.find((candidate) => candidate.state === 'FROZEN') ?? null,
    currentArtifacts: input.currentArtifacts,
  };
}

/** Carga los datos durables y delega la decision. */
export async function selectFactRunForEvaluation(input: { database: DatabaseClient; auditId: string }): Promise<FactRunSelection> {
  const jobs = createJobRepository(input.database);
  const facts = createFactRepository(input.database);
  const artifacts = await jobs.listBaselineArtifactsByAudit(input.auditId);
  const currentArtifacts = buildArtifactSet(artifacts);
  const runs = await facts.listRunsByAudit(input.auditId);
  return decideFactRun({ runs, currentArtifacts });
}

/**
 * Crea el Fact Run derivado. Si el indice unico
 * fact_extraction_runs_idempotency_hash_idx choca (23505) relee y reutiliza el
 * run existente en vez de fallar: dos peticiones concurrentes convergen.
 */
export async function createFactRunForSelection(input: {
  database: DatabaseClient;
  auditId: string;
  actorId: string;
  selection: Extract<FactRunSelection, { action: 'CREATE' }>;
  reason: DerivationReason;
}): Promise<FactExtractionRun> {
  const facts = createFactRepository(input.database);
  const canonical = JSON.stringify(Array.from(input.selection.currentArtifacts).sort().map((entry) => {
    const [id, sha256] = entry.split(':');
    return { id, sha256: sha256 || null, type: '', evidenceId: '' };
  }));
  const existing = (await facts.listRunsByAudit(input.auditId)).find(
    (candidate) => candidate.state !== 'FAILED' && artifactSetsEqual(parseArtifactSet(candidate.artifactSetFingerprint) ?? new Set(), input.selection.currentArtifacts),
  );
  if (existing) return existing;
  try {
    return await facts.createRun({
      auditId: input.auditId,
      policyCode: POLICY_CODE,
      policyVersion: POLICY_VERSION,
      extractorVersion: EXTRACTOR_VERSION,
      artifactSetFingerprint: canonical,
      createdBy: input.actorId,
      parentFactRunId: input.selection.staleFrozen?.id ?? null,
      derivationReason: input.reason,
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code !== '23505' && !/duplicate key|unique/i.test(error instanceof Error ? error.message : '')) throw error;
    const reread = (await facts.listRunsByAudit(input.auditId)).find(
      (candidate) => candidate.state !== 'FAILED' && artifactSetsEqual(parseArtifactSet(candidate.artifactSetFingerprint) ?? new Set(), input.selection.currentArtifacts),
    );
    if (!reread) throw error;
    return reread;
  }
}
```

- [ ] **Step 8: Correr los tests y verificar que pasan**

Run: `pnpm --filter @cancelaciones/web test src/server/facts/`
Expected: PASS, 15 tests.

- [ ] **Step 9: Commit**

```bash
git add apps/web/src/server/facts/artifact-set.ts apps/web/src/server/facts/artifact-set.test.ts apps/web/src/server/facts/run-selection.ts apps/web/src/server/facts/run-selection.test.ts
git commit -m "feat(facts): regla unica de frescura de Fact Runs

selectFactRunForEvaluation decide entre reutilizar el run congelado vigente,
reutilizar uno en curso o crear un derivado. La comparacion es entre conjuntos
de artefactos, no entre strings: listArtifactsByAudit ordena por created_at
DESC y dos artifacts pueden compartir timestamp."
```

---

## Task 3: Fingerprint de entrada de la evaluación

**Files:**
- Create: `apps/web/src/server/policy/evaluation-job.ts`, `apps/web/src/server/policy/evaluation-job.test.ts`

**Interfaces:**
- Consumes: `ArtifactSet` de Task 2; `stableFingerprint` de `@cancelaciones/domain`.
- Produces:
  - `type FactReviewInput = { factId: string; decision: string; correctedValue: unknown }`
  - `latestReviewPerFact(reviews: FactReviewInput[]): FactReviewInput[]` — una por `factId`, gana la última.
  - `evaluationInputFingerprint(input: { artifacts: ArtifactSet; reviews: FactReviewInput[] }): string`
  - `auditEvaluationJobSpec(input: { auditId: string; factRunId: string; artifacts: ArtifactSet; reviews: FactReviewInput[] }): { jobType: 'AUDIT_EVALUATION'; operationScope: string; idempotencyKey: string }`

- [ ] **Step 1: Escribir el test**

```ts
// apps/web/src/server/policy/evaluation-job.test.ts
import { describe, expect, it } from 'vitest';
import { buildArtifactSet } from '@/server/facts/artifact-set';
import { auditEvaluationJobSpec, evaluationInputFingerprint, latestReviewPerFact } from './evaluation-job';

const artifacts = buildArtifactSet([{ id: 'art-1', contentSha256: 'aaa' }]);

describe('latestReviewPerFact', () => {
  it('conserva solo la revision mas reciente de cada fact', () => {
    const result = latestReviewPerFact([
      { factId: 'f-1', decision: 'INVALID', correctedValue: null },
      { factId: 'f-2', decision: 'VALID', correctedValue: null },
      { factId: 'f-1', decision: 'VALID', correctedValue: 'corregido' },
    ]);
    expect(result).toEqual([
      { factId: 'f-1', decision: 'VALID', correctedValue: 'corregido' },
      { factId: 'f-2', decision: 'VALID', correctedValue: null },
    ]);
  });
});

describe('evaluationInputFingerprint', () => {
  it('no cambia si correctedValue es null explicito o ausente', () => {
    const withNull = evaluationInputFingerprint({ artifacts, reviews: [{ factId: 'f-1', decision: 'INVALID', correctedValue: null }] });
    const withUndefined = evaluationInputFingerprint({ artifacts, reviews: [{ factId: 'f-1', decision: 'INVALID', correctedValue: undefined }] });
    expect(withNull).toBe(withUndefined);
  });

  it('no cambia por revisar de nuevo el mismo hecho con el mismo valor', () => {
    const once = evaluationInputFingerprint({ artifacts, reviews: [{ factId: 'f-1', decision: 'VALID', correctedValue: 'a' }] });
    const thrice = evaluationInputFingerprint({
      artifacts,
      reviews: [
        { factId: 'f-1', decision: 'INVALID', correctedValue: 'a' },
        { factId: 'f-1', decision: 'VALID', correctedValue: 'a' },
        { factId: 'f-1', decision: 'VALID', correctedValue: 'a' },
      ],
    });
    expect(once).toBe(thrice);
  });

  it('cambia cuando cambia la decision de un hecho', () => {
    const valid = evaluationInputFingerprint({ artifacts, reviews: [{ factId: 'f-1', decision: 'VALID', correctedValue: null }] });
    const invalid = evaluationInputFingerprint({ artifacts, reviews: [{ factId: 'f-1', decision: 'INVALID', correctedValue: null }] });
    expect(valid).not.toBe(invalid);
  });

  it('cambia cuando cambia el valor corregido', () => {
    const a = evaluationInputFingerprint({ artifacts, reviews: [{ factId: 'f-1', decision: 'VALID', correctedValue: 'a' }] });
    const b = evaluationInputFingerprint({ artifacts, reviews: [{ factId: 'f-1', decision: 'VALID', correctedValue: 'b' }] });
    expect(a).not.toBe(b);
  });

  it('distingue objetos por clave, no por orden de insercion', () => {
    const a = evaluationInputFingerprint({ artifacts, reviews: [{ factId: 'f-1', decision: 'VALID', correctedValue: { x: 1, y: 2 } }] });
    const b = evaluationInputFingerprint({ artifacts, reviews: [{ factId: 'f-1', decision: 'VALID', correctedValue: { y: 2, x: 1 } }] });
    expect(a).toBe(b);
  });

  it('cambia cuando cambia el conjunto de artefactos', () => {
    const before = evaluationInputFingerprint({ artifacts, reviews: [] });
    const after = evaluationInputFingerprint({ artifacts: buildArtifactSet([{ id: 'art-1', contentSha256: 'aaa' }, { id: 'art-2', contentSha256: 'bbb' }]), reviews: [] });
    expect(before).not.toBe(after);
  });
});

describe('auditEvaluationJobSpec', () => {
  it('mantiene operationScope estable para que GET /jobs agrupe por fact run', () => {
    const spec = auditEvaluationJobSpec({ auditId: 'audit-1', factRunId: 'fr-1', artifacts, reviews: [] });
    expect(spec.operationScope).toBe('audit:audit-1:evaluation:fr-1');
    expect(spec.jobType).toBe('AUDIT_EVALUATION');
  });

  it('cambia la idempotencyKey cuando cambia una revision', () => {
    const before = auditEvaluationJobSpec({ auditId: 'audit-1', factRunId: 'fr-1', artifacts, reviews: [] });
    const after = auditEvaluationJobSpec({ auditId: 'audit-1', factRunId: 'fr-1', artifacts, reviews: [{ factId: 'f-1', decision: 'INVALID', correctedValue: null }] });
    expect(before.idempotencyKey).not.toBe(after.idempotencyKey);
    expect(after.operationScope).toBe(before.operationScope);
  });

  it('produce la misma clave si no cambio nada (boton pulsado dos veces)', () => {
    const input = { auditId: 'audit-1', factRunId: 'fr-1', artifacts, reviews: [{ factId: 'f-1', decision: 'VALID', correctedValue: 3 }] };
    expect(auditEvaluationJobSpec(input).idempotencyKey).toBe(auditEvaluationJobSpec(input).idempotencyKey);
  });

  it('usa un fingerprint hexadecimal en la clave', () => {
    const spec = auditEvaluationJobSpec({ auditId: 'audit-1', factRunId: 'fr-1', artifacts, reviews: [] });
    expect(spec.idempotencyKey).toMatch(/^evaluation:audit-1:fr-1:[a-f0-9]{64}$/);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm --filter @cancelaciones/web test src/server/policy/evaluation-job.test.ts`
Expected: FAIL con `Cannot find module './evaluation-job'`.

- [ ] **Step 3: Implementar `evaluation-job.ts`**

```ts
// apps/web/src/server/policy/evaluation-job.ts
// enqueue_job resuelve conflictos con ON CONFLICT ... DO UPDATE SET updated_at
// (migrations/20260921225156:126-127): no reactiva el job. Por eso la clave de
// AUDIT_EVALUATION debe distinguir entradas distintas, no solo identidades de
// corrida. Mismo principio que el dedupe por facts_fingerprint del motor.
import { createHash } from 'node:crypto';
import { stableFingerprint } from '@cancelaciones/domain';
import type { ArtifactSet } from '@/server/facts/artifact-set';

export type FactReviewInput = { factId: string; decision: string; correctedValue: unknown };

/** Una revision por fact: gana la ultima, igual que policy/evaluation.ts:34-35. */
export function latestReviewPerFact(reviews: FactReviewInput[]): FactReviewInput[] {
  const latest = new Map<string, FactReviewInput>();
  for (const review of reviews) latest.set(review.factId, review);
  return Array.from(latest.values()).sort((a, b) => a.factId.localeCompare(b.factId));
}

function valueHash(value: unknown): string {
  // null y undefined dejan el value original intacto (policy/evaluation.ts:41),
  // asi que deben producir la misma huella.
  if (value === null || value === undefined) return '';
  return createHash('sha256').update(stableFingerprint(value)).digest('hex');
}

export function evaluationInputFingerprint(input: { artifacts: ArtifactSet; reviews: FactReviewInput[] }): string {
  return createHash('sha256').update(stableFingerprint({
    artifacts: Array.from(input.artifacts).sort(),
    reviews: latestReviewPerFact(input.reviews).map((review) => [review.factId, review.decision, valueHash(review.correctedValue)]),
  })).digest('hex');
}

export function auditEvaluationJobSpec(input: { auditId: string; factRunId: string; artifacts: ArtifactSet; reviews: FactReviewInput[] }): {
  jobType: 'AUDIT_EVALUATION';
  operationScope: string;
  idempotencyKey: string;
} {
  const fingerprint = evaluationInputFingerprint({ artifacts: input.artifacts, reviews: input.reviews });
  return {
    jobType: 'AUDIT_EVALUATION',
    // El scope queda estable: GET /jobs agrupa por scope y asi la vista muestra
    // siempre la evaluacion mas reciente de esa fact run.
    operationScope: `audit:${input.auditId}:evaluation:${input.factRunId}`,
    idempotencyKey: `evaluation:${input.auditId}:${input.factRunId}:${fingerprint}`,
  };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm --filter @cancelaciones/web test src/server/policy/evaluation-job.test.ts`
Expected: PASS, 12 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/policy/evaluation-job.ts apps/web/src/server/policy/evaluation-job.test.ts
git commit -m "feat(policy): fingerprint de entrada en la clave de AUDIT_EVALUATION

Sin esto, pulsar 'volver a iniciar el dictamen' tras corregir un hecho sin
evidencia nueva reutiliza la misma fact run y por tanto la misma clave:
enqueue_job no reactiva el job en conflicto y la accion seria un no-op
silencioso."
```

---

## Task 4: `EXTRACT_FACTS` con semántica *ensure-current*

**Files:**
- Modify: `apps/web/src/server/jobs/handlers.ts:36-60` (`enqueueFactExtractionIfReady`, `enqueueAuditEvaluation`)
- Modify: `apps/web/src/app/api/audits/[auditId]/jobs/route.ts:50-60`
- Test: `apps/web/src/server/jobs/enqueue-evidence.test.ts` (el mock de `buildDatabase` se reutiliza como referencia; esta tarea no añade archivo de test propio, la cobertura vive en Task 2 y Task 3)

**Interfaces:**
- Consumes: `selectFactRunForEvaluation`, `createFactRunForSelection`, `DerivationReason` de Task 2; `auditEvaluationJobSpec` de Task 3; `FactReviewInput` de Task 3.
- Produces:
  - `readLatestFactReviews(input: { database: DatabaseClient; auditId: string }): Promise<FactReviewInput[]>` exportado de `handlers.ts`, para que `jobs/route.ts` lo reutilice.
  - `enqueueAuditEvaluationForRun(input: { database: DatabaseClient; auditId: string; factRunId: string; artifacts: ArtifactSet; actorId: string }): Promise<Job>` exportado de `handlers.ts`.

- [ ] **Step 1: Exportar el lector de revisiones desde `handlers.ts`**

Añadir imports en `apps/web/src/server/jobs/handlers.ts` (después de la línea 11). **No** importar `POLICY_CODE` ni `POLICY_VERSION`: `handlers.ts` ya las declara como constantes locales en las líneas 21-22 y una importación homónima sería un conflicto de declaración.

```ts
import { selectFactRunForEvaluation, createFactRunForSelection, EXTRACTOR_VERSION, type DerivationReason } from '@/server/facts/run-selection';
import { auditEvaluationJobSpec, type FactReviewInput } from '@/server/policy/evaluation-job';
import type { ArtifactSet } from '@/server/facts/artifact-set';
```

- [ ] **Step 2: Añadir `readLatestFactReviews` y `enqueueAuditEvaluationForRun`**

Insertar justo antes de `enqueueFactExtractionIfReady` (línea 36). Luego **borrar** la función `enqueueAuditEvaluation` existente (líneas 58-61): su clave de idempotencia es reemplazada por `auditEvaluationJobSpec` y dejarla crearía una segunda implementación, lo que viola `DO_NOT_DUPLICATE_IMPLEMENTATIONS`.

```ts
/** Ultima revision por fact, en el mismo orden que policy/evaluation.ts:34-35. */
export async function readLatestFactReviews(input: { database: DatabaseClient; auditId: string }): Promise<FactReviewInput[]> {
  const result = await input.database
    .from('fact_reviews')
    .select('fact_id,decision,corrected_value,created_at')
    .eq('audit_id', input.auditId)
    .order('created_at', { ascending: false });
  if (result.error) return [];
  const latest = new Map<string, FactReviewInput>();
  for (const row of (result.data ?? []) as Array<{ fact_id: string; decision: string; corrected_value: unknown }>) {
    if (!latest.has(row.fact_id)) latest.set(row.fact_id, { factId: row.fact_id, decision: row.decision, correctedValue: row.corrected_value });
  }
  return Array.from(latest.values()).sort((a, b) => a.factId.localeCompare(b.factId));
}

/** Encola la evaluacion con clave derivada del contenido, no de la identidad. */
export async function enqueueAuditEvaluationForRun(input: { database: DatabaseClient; auditId: string; factRunId: string; artifacts: ArtifactSet; actorId: string }) {
  const reviews = await readLatestFactReviews({ database: input.database, auditId: input.auditId });
  const spec = auditEvaluationJobSpec({ auditId: input.auditId, factRunId: input.factRunId, artifacts: input.artifacts, reviews });
  const payload = { auditId: input.auditId, factRunId: input.factRunId, policyCode: POLICY_CODE, policyVersion: POLICY_VERSION, actorId: input.actorId };
  return createJobRepository(input.database).enqueue({
    auditId: input.auditId,
    jobType: spec.jobType,
    operationScope: spec.operationScope,
    idempotencyKey: spec.idempotencyKey,
    inputFingerprint: stableFingerprint(payload),
    payload,
    actorId: input.actorId,
  });
}
```

- [ ] **Step 3: Reescribir `enqueueFactExtractionIfReady`**

Reemplazar el cuerpo de `enqueueFactExtractionIfReady` (líneas 36-56) por:

```ts
async function enqueueFactExtractionIfReady(context: HandlerContext, auditId: string, actorId: string, reason: DerivationReason = 'EVIDENCE_SET_CHANGED') {
  const evidences = await createEvidenceRepository(context.database).listByAudit(auditId);
  const baseline = evidences.filter((evidence) => evidence.status === 'STORED' && evidence.documentRole === 'EVIDENCE');
  if (baseline.length === 0) return;
  const artifacts = await createJobRepository(context.database).listBaselineArtifactsByAudit(auditId);
  const processed = new Set(artifacts.map((artifact) => artifact.evidenceId).filter(Boolean));
  if (!baseline.every((evidence) => processed.has(evidence.id))) return;

  const selection = await selectFactRunForEvaluation({ database: context.database, auditId });
  if (selection.action === 'REUSE_FROZEN') {
    // Los hechos siguen vigentes: no se re-extrae, solo se re-evalua (puede haber
    // reviews nuevas). El job encadena REPORT_GENERATION.
    await enqueueAuditEvaluationForRun({ database: context.database, auditId, factRunId: selection.run.id, artifacts: selection.currentArtifacts, actorId });
    return;
  }
  if (selection.action === 'REUSE_ACTIVE') {
    // Extraccion en vuelo. Re-encolar con la misma idempotencyKey es no-op.
    await enqueueFactExtraction(context, auditId, selection.run.id, actorId);
    return;
  }
  const run = await createFactRunForSelection({ database: context.database, auditId, actorId, selection, reason });
  await enqueueFactExtraction(context, auditId, run.id, actorId);
}

async function enqueueFactExtraction(context: HandlerContext, auditId: string, factRunId: string, actorId: string) {
  const payload = { auditId, factRunId, version: EXTRACTOR_VERSION, actorId };
  await createJobRepository(context.database).enqueue({
    auditId,
    jobType: 'FACT_EXTRACTION',
    operationScope: `audit:${auditId}:facts`,
    idempotencyKey: `facts:${factRunId}:v1`,
    inputFingerprint: stableFingerprint(payload),
    payload,
    actorId,
  });
}
```

- [ ] **Step 4: Reescribir la rama `EXTRACT_FACTS` de la ruta**

En `apps/web/src/app/api/audits/[auditId]/jobs/route.ts`, reemplazar el bloque `if (action === 'EXTRACT_FACTS') { ... }` (líneas 50-60) por:

```ts
    if (action === 'EXTRACT_FACTS') {
      const selection = await selectFactRunForEvaluation({ database: client.database, auditId });
      if (selection.action === 'REUSE_FROZEN') {
        const evaluationJob = await enqueueAuditEvaluationForRun({ database: client.database, auditId, factRunId: selection.run.id, artifacts: selection.currentArtifacts, actorId: user.id });
        return NextResponse.json({ job: evaluationJob, factRun: selection.run, reused: true, changed: true }, { status: 202 });
      }
      const run = selection.action === 'REUSE_ACTIVE'
        ? selection.run
        : await createFactRunForSelection({ database: client.database, auditId, actorId: user.id, selection, reason: 'MANUAL_REEXTRACTION' });
      if (run.state === 'DRAFT') await client.database.from('fact_extraction_runs').update({ state: 'PROCESSING' }).eq('id', run.id);
      const payload = { auditId, factRunId: run.id, version: EXTRACTOR_VERSION };
      job = await repo.enqueue({ auditId, jobType: 'FACT_EXTRACTION', operationScope: `audit:${auditId}:facts`, idempotencyKey: `facts:${run.id}:v1`, inputFingerprint: stableFingerprint(payload), payload, actorId: user.id });
    } else {
```

Y añadir el import junto a los existentes (línea 2-6):

```ts
import { selectFactRunForEvaluation, createFactRunForSelection, EXTRACTOR_VERSION } from '@/server/facts/run-selection';
import { enqueueAuditEvaluationForRun } from '@/server/jobs/handlers';
```

- [ ] **Step 5: Verificar tipos y tests**

Run: `pnpm --filter @cancelaciones/web typecheck && pnpm --filter @cancelaciones/web test`
Expected: PASS. La constante local `POLICY_CODE`/`POLICY_VERSION` de `handlers.ts` (línea 21-22) se mantiene; solo cambia la versión del extractor, que ahora viene de `run-selection.ts`.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/jobs/handlers.ts "apps/web/src/app/api/audits/[auditId]/jobs/route.ts"
git commit -m "feat(jobs): EXTRACT_FACTS asegura que el motor haya evaluado los hechos vigentes

Antes: un Fact Run FROZEN cortocircuitaba la extraccion y la ruta devolvia
{job: null, reused: true} sin encolar nada, asi que la evidencia nueva nunca
llegaba a los hechos. Ahora un run congelado vigente reencola AUDIT_EVALUATION
con clave derivada del contenido, y uno obsoleto deriva un Fact Run nuevo."
```

---

## Task 5: Guard `HUMAN_REVIEW_STALE`

**Files:**
- Modify: `apps/web/src/server/dictamen/service.ts:260-288` (`approveSnapshot`)
- Modify: `apps/web/src/app/api/audits/[auditId]/dictamen/approve/route.ts:17`
- Test: `apps/web/src/server/dictamen/service.test.ts:376-391` (fixture `humanReviewRow`)

**Interfaces:**
- Consumes: nada.
- Produces: `approveSnapshot` lanza un error con `code === 'HUMAN_REVIEW_STALE'` cuando `human.machineDecision.engineRunId !== snapshot.engineRunId` o cuando `machineDecision` no trae `engineRunId`.

- [ ] **Step 1: Escribir el test que falla**

Añadir dentro de `describe('approveSnapshot')` (después de la línea 238):

```ts
  it('rechaza aprobar cuando la revision humana es de otra corrida del motor', async () => {
    const client = mockClient({
      report_snapshots: { data: [snapshotRow('DRAFT')] },
      human_reviews: { data: [humanReviewRow()] },
    });
    await expect(approveSnapshot(auth(client))).rejects.toMatchObject({ code: 'HUMAN_REVIEW_STALE' });
  });

  it('rechaza aprobar cuando la revision no identifica su corrida', async () => {
    const client = mockClient({
      report_snapshots: { data: [snapshotRow('DRAFT')] },
      human_reviews: { data: [{ ...humanReviewRow(), machine_decision: { machineOutcome: 'CANCELACION_VENTA' } }] },
    });
    await expect(approveSnapshot(auth(client))).rejects.toMatchObject({ code: 'HUMAN_REVIEW_STALE' });
  });
```

Y cambiar la línea 380 del fixture para que identifique la corrida (`snapshotRow('DRAFT')` usa `engine_run_id: 'run-1'`):

```ts
    machine_decision: { engineRunId: 'run-1', machineOutcome: 'CANCELACION_VENTA' },
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm --filter @cancelaciones/web test src/server/dictamen/service.test.ts`
Expected: FAIL. Los dos tests nuevos por `HUMAN_REVIEW_STALE` pasan porque el código actual no lanza; el test existente «aprueba el snapshot solo con revision humana» también falla si el fixture no se actualizó.

- [ ] **Step 3: Implementar el guard**

En `apps/web/src/server/dictamen/service.ts`, reemplazar el bloque de la revisión humana dentro de `approveSnapshot` (líneas 273-278) por:

```ts
  const human = await humanRepo.findByAudit(auth.auditId);
  if (!human) {
    const error = new Error('Sin revisión humana registrada no se puede aprobar el dictamen.');
    (error as Error & { code?: string }).code = 'HUMAN_REVIEW_REQUIRED';
    throw error;
  }

  // Sin este guard, un recálculo combinationa la maquina nueva con la revision
  // humana vieja y la aprobacion lo acepta. La decision de maquina se preserva;
  // lo que se invalida es la revision que ya no la describe.
  const reviewedEngineRunId = (human.machineDecision as { engineRunId?: unknown } | null | undefined)?.engineRunId;
  if (reviewedEngineRunId !== snapshot.engineRunId) {
    const error = new Error('La revisión humana corresponde a otra corrida del motor. Registra de nuevo la revisión antes de aprobar.');
    (error as Error & { code?: string }).code = 'HUMAN_REVIEW_STALE';
    throw error;
  }
```

- [ ] **Step 4: Mapear el código a 409 en la ruta**

En `apps/web/src/app/api/audits/[auditId]/dictamen/approve/route.ts:17`, reemplazar la línea del `status` por:

```ts
    const status = isCode(error, 'SNAPSHOT_NOT_FOUND') || isCode(error, 'HUMAN_REVIEW_REQUIRED') || isCode(error, 'HUMAN_REVIEW_STALE') ? 409 : 400;
```

- [ ] **Step 5: Correr el test y verificar que pasa**

Run: `pnpm --filter @cancelaciones/web test src/server/dictamen/service.test.ts`
Expected: PASS, 20 tests.

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/server/dictamen/service.ts "apps/web/src/app/api/audits/[auditId]/dictamen/approve/route.ts" apps/web/src/server/dictamen/service.test.ts
git commit -m "feat(dictamen): impedir aprobar con revision humana de otra corrida

Tras un recalculo, human_reviews seguia apuntando al engine_run anterior y
buildSnapshot combinaba maquina nueva con revision vieja. La decision de
maquina se preserva; lo que se invalida es la revision que ya no la describe."
```

---

## Task 6: Validación de forma de `correctedValue`

**Files:**
- Create: `apps/web/src/server/extraction/corrected-value.ts`, `apps/web/src/server/extraction/corrected-value.test.ts`
- Modify: `apps/web/src/app/api/audits/[auditId]/fact-reviews/route.ts:29-41`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type CorrectedValueVerdict = { ok: true } | { ok: false; message: string }`
  - `validateCorrectedValueShape(input: { original: unknown; corrected: unknown; factType: string }): CorrectedValueVerdict`

- [ ] **Step 1: Escribir el test**

```ts
// apps/web/src/server/extraction/corrected-value.test.ts
import { describe, expect, it } from 'vitest';
import { validateCorrectedValueShape } from './corrected-value';

const check = (original: unknown, corrected: unknown) => validateCorrectedValueShape({ original, corrected, factType: 'student.level' });

describe('validateCorrectedValueShape', () => {
  it('admite el mismo tipo primitivo', () => {
    expect(check('LICENCIATURA', 'POSGRADO').ok).toBe(true);
    expect(check(3, 4).ok).toBe(true);
    expect(check(false, true).ok).toBe(true);
  });

  it('rechaza cambiar de tipo primitivo', () => {
    expect(check('LICENCIATURA', 3).ok).toBe(false);
    expect(check(3, '3').ok).toBe(false);
  });

  it('rechaza un objeto con claves distintas', () => {
    const original = { events: [], observedCount: 2, sourceCompleteness: 'COMPLETE' };
    expect(check(original, { events: [], observedCount: 3, sourceCompleteness: 'COMPLETE' }).ok).toBe(true);
    expect(check(original, { events: [], observedCount: 3 }).ok).toBe(false);
    expect(check(original, { events: [], observedCount: 3, sourceCompleteness: 'COMPLETE', extra: 1 }).ok).toBe(false);
  });

  it('admite un array de cualquier longitud', () => {
    expect(check([1, 2], [1, 2, 3]).ok).toBe(true);
    expect(check([1, 2], []).ok).toBe(true);
  });

  it('rechaza cambiar entre array y objeto', () => {
    expect(check([1], { '0': 1 }).ok).toBe(false);
    expect(check({ a: 1 }, [1]).ok).toBe(false);
  });

  it('rechaza null contra un valor que no es null', () => {
    expect(check('LICENCIATURA', null).ok).toBe(false);
  });

  it('admite null cuando el original es null', () => {
    expect(check(null, 'LICENCIATURA').ok).toBe(true);
  });

  it('admite undefined contra null (ambos dejan el valor original)', () => {
    expect(check(null, undefined).ok).toBe(true);
  });

  it('nombra el factType y nunca el valor en el mensaje', () => {
    const verdict = check('LICENCIATURA', { secreto: 'valor' });
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) {
      expect(verdict.message).toContain('student.level');
      expect(verdict.message).not.toContain('secreto');
    }
  });

  it('valida recursivamente los valores de un objeto', () => {
    expect(check({ a: 'x' }, { a: { b: 1 } }).ok).toBe(false);
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm --filter @cancelaciones/web test src/server/extraction/corrected-value.test.ts`
Expected: FAIL con `Cannot find module './corrected-value'`.

- [ ] **Step 3: Implementar `corrected-value.ts`**

```ts
// apps/web/src/server/extraction/corrected-value.ts
// Un correctedValue con forma arbitraria se inyecta en fact.value y llega al
// motor normativo (policy/evaluation.ts:41-42). Se valida la forma contra el
// valor original; el mensaje nunca incluye el valor.

export type CorrectedValueVerdict = { ok: true } | { ok: false; message: string };

function kindOf(value: unknown): 'null' | 'array' | 'object' | typeof value {
  if (value === null || value === undefined) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}

function sameShape(original: unknown, corrected: unknown, path: string): string | null {
  const originalKind = kindOf(original);
  const correctedKind = kindOf(corrected);
  if (originalKind !== correctedKind) return `${path}: se esperaba ${originalKind} y se recibio ${correctedKind}`;
  if (originalKind === 'array') return null; // el humano aporta el reemplazo completo
  if (originalKind === 'object') {
    const originalRecord = original as Record<string, unknown>;
    const correctedRecord = corrected as Record<string, unknown>;
    const originalKeys = Object.keys(originalRecord).sort();
    const correctedKeys = Object.keys(correctedRecord).sort();
    if (originalKeys.length !== correctedKeys.length || originalKeys.some((key, index) => key !== correctedKeys[index])) {
      return `${path}: el conjunto de claves debe coincidir exactamente`;
    }
    for (const key of originalKeys) {
      const problem = sameShape(originalRecord[key], correctedRecord[key], `${path}.${key}`);
      if (problem) return problem;
    }
  }
  return null;
}

export function validateCorrectedValueShape(input: { original: unknown; corrected: unknown; factType: string }): CorrectedValueVerdict {
  const problem = sameShape(input.original, input.corrected, 'valor');
  if (!problem) return { ok: true };
  return { ok: false, message: `La correccion del dato ${input.factType} no conserva la forma del valor original (${problem}).` };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm --filter @cancelaciones/web test src/server/extraction/corrected-value.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Aplicar la validación en la ruta**

En `apps/web/src/app/api/audits/[auditId]/fact-reviews/route.ts`, añadir el import y reemplazar el bloque del `POST` (líneas 29-41):

```ts
import { validateCorrectedValueShape } from '@/server/extraction/corrected-value';
```

```ts
  let body: { factId?: string; decision?: 'VALID' | 'INVALID'; correctedValue?: unknown; note?: string };
  try { body = await request.json(); } catch { return NextResponse.json({ error: 'INVALID_JSON', message: 'JSON invalido.' }, { status: 400 }); }
  if (!body.factId || !body.decision) return NextResponse.json({ error: 'INVALID_INPUT', message: 'factId y decision son obligatorios.' }, { status: 400 });
  if (body.decision !== 'VALID' && body.decision !== 'INVALID') return NextResponse.json({ error: 'INVALID_INPUT', message: 'decision debe ser VALID o INVALID.' }, { status: 400 });
  const fact = await createFactRepository(auth.client.database).findFactById(body.factId);
  if (!fact || fact.auditId !== auditId) return NextResponse.json({ error: 'FACT_NOT_FOUND', message: 'Dato no encontrado.' }, { status: 404 });
  if (body.correctedValue !== undefined) {
    const verdict = validateCorrectedValueShape({ original: fact.value, corrected: body.correctedValue, factType: fact.factType });
    if (!verdict.ok) return NextResponse.json({ error: 'INVALID_CORRECTED_VALUE', message: verdict.message }, { status: 400 });
  }
```

- [ ] **Step 6: Verificar y commitear**

Run: `pnpm --filter @cancelaciones/web typecheck && pnpm --filter @cancelaciones/web test`
Expected: PASS.

```bash
git add apps/web/src/server/extraction/corrected-value.ts apps/web/src/server/extraction/corrected-value.test.ts "apps/web/src/app/api/audits/[auditId]/fact-reviews/route.ts"
git commit -m "feat(extraction): validar la forma de correctedValue

Un correctedValue arbitrario se inyectaba en jsonb y llegaba a fact.value, que
el motor consume como entrada normativa. Ahora se valida la forma contra el
valor original y el mensaje nunca incluye el valor."
```

---

## Task 7: `drainQueue` compartido

**Files:**
- Create: `apps/web/src/lib/job-queue.ts`, `apps/web/src/lib/job-queue.test.ts`

**Interfaces:**
- Consumes: nada.
- Produces:
  - `type QueueJobStatus = { id: string; jobType: string; status: string; lastErrorMessage?: string | null }`
  - `const ACTIVE_JOB_STATUSES: ReadonlySet<string>` — `QUEUED`, `RUNNING`, `RETRY_SCHEDULED`
  - `hasActiveJobs(jobs: Array<{ status: string }>): boolean`
  - `drainQueue(auditId: string, options?: { fetchImpl?: typeof fetch; maxAttempts?: number; onTick?: () => void }): Promise<{ ok: true } | { ok: false; message: string }>`
  - `uploadEvidenceFiles(...)` **no** va aquí: vive en `EvidenceUploader` (Task 8).

- [ ] **Step 1: Escribir el test**

```ts
// apps/web/src/lib/job-queue.test.ts
import { describe, expect, it, vi } from 'vitest';
import { drainQueue, hasActiveJobs } from './job-queue';

type Step = { jobs: Array<{ status: string; lastErrorMessage?: string | null }>; processOk?: boolean; processMessage?: string };

function fetchStub(steps: Step[]) {
  let index = -1;
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes('/jobs') && !url.includes('/process')) {
      index += 1;
      const step = steps[Math.min(index, steps.length - 1)];
      return new Response(JSON.stringify({ jobs: step.jobs }), { status: 200, headers: { 'content-type': 'application/json' } });
    }
    const step = steps[Math.max(0, Math.min(index, steps.length - 1))];
    const ok = step.processOk ?? true;
    return new Response(JSON.stringify(ok ? { processed: 1 } : { message: step.processMessage ?? 'fallo' }), { status: ok ? 200 : 500, headers: { 'content-type': 'application/json' } });
  }) as unknown as typeof fetch;
}

describe('hasActiveJobs', () => {
  it('reconoce los tres estados activos', () => {
    expect(hasActiveJobs([{ status: 'QUEUED' }])).toBe(true);
    expect(hasActiveJobs([{ status: 'RUNNING' }])).toBe(true);
    expect(hasActiveJobs([{ status: 'RETRY_SCHEDULED' }])).toBe(true);
  });

  it('ignora estados terminales', () => {
    expect(hasActiveJobs([{ status: 'COMPLETED' }, { status: 'FAILED' }])).toBe(false);
    expect(hasActiveJobs([])).toBe(false);
  });
});

describe('drainQueue', () => {
  it('no hace nada si la cola ya esta vacia', async () => {
    const impl = fetchStub([{ jobs: [{ status: 'COMPLETED' }] }]);
    await expect(drainQueue('audit-1', { fetchImpl: impl })).resolves.toEqual({ ok: true });
    expect(impl).toHaveBeenCalledTimes(1);
  });

  it('drena invocando /api/jobs/process hasta que no quedan jobs activos', async () => {
    const impl = fetchStub([
      { jobs: [{ status: 'QUEUED' }] },
      { jobs: [{ status: 'RUNNING' }] },
      { jobs: [{ status: 'COMPLETED' }] },
    ]);
    await expect(drainQueue('audit-1', { fetchImpl: impl })).resolves.toEqual({ ok: true });
    const processCalls = impl.mock.calls.filter((call) => String(call[0]).includes('/process'));
    expect(processCalls).toHaveLength(2);
  });

  it('propaga el mensaje de un job FAILED', async () => {
    const impl = fetchStub([{ jobs: [{ status: 'FAILED', lastErrorMessage: 'No se pudo procesar EVIDENCE_PROCESSING.' }] }]);
    await expect(drainQueue('audit-1', { fetchImpl: impl })).resolves.toEqual({ ok: false, message: 'No se pudo procesar EVIDENCE_PROCESSING.' });
  });

  it('usa un mensaje generico cuando el job FAILED no trae mensaje', async () => {
    const impl = fetchStub([{ jobs: [{ status: 'FAILED', lastErrorMessage: null }] }]);
    const result = await drainQueue('audit-1', { fetchImpl: impl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toContain('FAILED');
  });

  it('reporta el fallo de /api/jobs/process', async () => {
    const impl = fetchStub([{ jobs: [{ status: 'QUEUED' }], processOk: false, processMessage: 'STORAGE_UNAVAILABLE' }]);
    await expect(drainQueue('audit-1', { fetchImpl: impl })).resolves.toEqual({ ok: false, message: 'STORAGE_UNAVAILABLE' });
  });

  it('corta en maxAttempts y lo dice', async () => {
    const impl = fetchStub([{ jobs: [{ status: 'QUEUED' }] }]);
    const result = await drainQueue('audit-1', { fetchImpl: impl, maxAttempts: 3 });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.message).toMatch(/cola no terminou/i);
  });

  it('invoca onTick en cada iteracion activa', async () => {
    const impl = fetchStub([{ jobs: [{ status: 'QUEUED' }] }, { jobs: [{ status: 'COMPLETED' }] }]);
    const onTick = vi.fn();
    await drainQueue('audit-1', { fetchImpl: impl, onTick });
    expect(onTick).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm --filter @cancelaciones/web test src/lib/job-queue.test.ts`
Expected: FAIL con `Cannot find module './job-queue'`.

- [ ] **Step 3: Implementar `job-queue.ts`**

```ts
// apps/web/src/lib/job-queue.ts
// POST /api/jobs/process es el unico worker del sistema y solo lo invoca el
// navegador. Extraido de AuditWorkflow.tsx:34-57 para que JobAutoResume,
// EvidenceUploader y FactReviewPanel compartan una sola implementacion.
export type QueueJobStatus = { id: string; jobType: string; status: string; lastErrorMessage?: string | null };

export const ACTIVE_JOB_STATUSES: ReadonlySet<string> = new Set(['QUEUED', 'RUNNING', 'RETRY_SCHEDULED']);

export function hasActiveJobs(jobs: Array<{ status: string }>): boolean {
  return jobs.some((job) => ACTIVE_JOB_STATUSES.has(job.status));
}

async function readJson(response: Response): Promise<Record<string, unknown>> {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { message: text.slice(0, 500) };
  }
}

export async function drainQueue(
  auditId: string,
  options: { fetchImpl?: typeof fetch; maxAttempts?: number; onTick?: () => void } = {},
): Promise<{ ok: true } | { ok: false; message: string }> {
  const doFetch = options.fetchImpl ?? ((...args: Parameters<typeof fetch>) => fetch(...args));
  const maxAttempts = options.maxAttempts ?? 60;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const jobsResponse = await doFetch(`/api/audits/${auditId}/jobs`, { cache: 'no-store' });
    const jobsData = await readJson(jobsResponse);
    if (!jobsResponse.ok) {
      return { ok: false, message: String(jobsData.message ?? 'No fue posible consultar la cola.') };
    }
    const jobs = (jobsData.jobs as QueueJobStatus[] | undefined) ?? [];
    const failed = jobs.find((job) => job.status === 'FAILED');
    if (failed) {
      return { ok: false, message: failed.lastErrorMessage ?? `El job ${failed.jobType ?? ''} termino en FAILED.`.trim() };
    }
    if (!hasActiveJobs(jobs)) return { ok: true };

    options.onTick?.();
    const processResponse = await doFetch('/api/jobs/process', { method: 'POST' });
    if (!processResponse.ok) {
      const processData = await readJson(processResponse);
      return { ok: false, message: String(processData.message ?? 'No fue posible ejecutar el siguiente job.') };
    }
    await processResponse.text();
  }
  return { ok: false, message: 'La cola no termino dentro del tiempo esperado. Revisa el detalle de jobs.' };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm --filter @cancelaciones/web test src/lib/job-queue.test.ts`
Expected: PASS, 9 tests.

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/job-queue.ts apps/web/src/lib/job-queue.test.ts
git commit -m "feat(lib): drainQueue compartido para drenar la cola de jobs

Extraido de AuditWorkflow.tsx:34-57 con fetch inyectable para poder probarlo en
environment node. Devuelve {ok, message} en vez de lanzar, para que cada
consumidor lo presente segun su contexto."
```

---

## Task 8: `JobAutoResume` y `EvidenceUploader`

**Files:**
- Create: `apps/web/src/app/(private)/auditorias/[auditId]/components/JobAutoResume.tsx`, `.../components/EvidenceUploader.tsx`
- Delete: `apps/web/src/app/(private)/auditorias/[auditId]/AuditWorkflow.tsx`

**Interfaces:**
- Consumes: `drainQueue`, `hasActiveJobs` de Task 7.
- Produces:
  - `JobAutoResume({ auditId, enabled = true, onError, onSettled }: { auditId: string; enabled?: boolean; onError?: (message: string) => void; onSettled?: () => void }): null`
  - `EvidenceUploader({ auditId, onUploaded }: { auditId: string; onUploaded?: () => void }): JSX.Element`

- [ ] **Step 1: Crear `JobAutoResume.tsx`**

```tsx
'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { drainQueue } from '@/lib/job-queue';

/**
 * Se monta siempre en el workspace. POST /api/jobs/process es el unico worker
 * del sistema, asi que si este componente no esta, la cola no se drena.
 * No renderiza nada: los errores se reportan hacia arriba para que
 * AuditWorkspace los muestre en la pestana dictamen.
 */
export function JobAutoResume({ auditId, enabled = true, onError, onSettled }: { auditId: string; enabled?: boolean; onError?: (message: string) => void; onSettled?: () => void }) {
  const router = useRouter();
  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled || startedRef.current) return;
    startedRef.current = true;
    void (async () => {
      try {
        const result = await drainQueue(auditId);
        if (!result.ok) onError?.(result.message);
      } catch (cause) {
        // Sin UI propia: se registra sin volcar facts, valores ni PII.
        console.warn('[JobAutoResume]', cause instanceof Error ? cause.message : 'Fallo al drenar la cola.');
        onError?.('No fue posible retomar el procesamiento del expediente.');
      } finally {
        onSettled?.();
        router.refresh();
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditId, enabled]);

  return null;
}
```

- [ ] **Step 2: Crear `EvidenceUploader.tsx`**

```tsx
'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { drainQueue } from '@/lib/job-queue';

type UploadState = 'idle' | 'uploading' | 'processing' | 'error';

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { message: text.slice(0, 500) }; }
}

/**
 * Boton "+ Agregar" del panel de archivos. Sube, encola el procesamiento y
 * drena la cola. NO toca el dictamen: los hechos siguen congelados hasta que se
 * use "Volver a iniciar el dictamen con otros hechos".
 */
export function EvidenceUploader({ auditId, onUploaded }: { auditId: string; onUploaded?: () => void }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [state, setState] = useState<UploadState>('idle');
  const [message, setMessage] = useState('');

  async function upload(files: File[]) {
    if (!files.length) return;
    setState('uploading');
    setMessage(`Subiendo ${files.length} archivo${files.length === 1 ? '' : 's'}...`);
    try {
      const form = new FormData();
      files.forEach((file) => form.append('files', file));
      const uploadResponse = await fetch(`/api/audits/${auditId}/evidences`, { method: 'POST', body: form });
      const uploadData = await readJson(uploadResponse);
      if (!uploadResponse.ok && uploadResponse.status !== 207) throw new Error(String(uploadData.message ?? 'No fue posible subir la evidencia.'));
      const results = (uploadData.results as Array<{ status: string; message?: string }> | undefined) ?? [];
      const failed = results.filter((item) => item.status === 'FAILED');
      if (results.length > 0 && failed.length === results.length) throw new Error(failed[0]?.message ?? 'No se pudo guardar ningun archivo.');

      setState('processing');
      setMessage('Procesando evidencias...');
      const processResponse = await fetch(`/api/audits/${auditId}/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'action=PROCESS_EVIDENCES',
      });
      const processData = await readJson(processResponse);
      if (!processResponse.ok) throw new Error(String(processData.message ?? 'No fue posible iniciar el procesamiento.'));

      const drained = await drainQueue(auditId);
      if (!drained.ok) throw new Error(drained.message);

      setState('idle');
      setMessage('Evidencias procesadas. Los hechos siguen congelados: el dictamen no cambia hasta que uses "Volver a iniciar el dictamen con otros hechos".');
      onUploaded?.();
      router.refresh();
    } catch (cause) {
      setState('error');
      setMessage(cause instanceof Error ? cause.message : 'Ocurrio un error al procesar las evidencias.');
    }
  }

  const busy = state === 'uploading' || state === 'processing';

  return (
    <div>
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={busy}
        className="text-brand disabled:cursor-wait disabled:opacity-60"
      >
        + Agregar
      </button>
      <input
        ref={inputRef}
        className="hidden"
        type="file"
        multiple
        onChange={(event) => {
          void upload(Array.from(event.target.files ?? []));
          event.target.value = '';
        }}
      />
      <p aria-live="polite" className={`mt-1 text-[10px] ${state === 'error' ? 'text-danger' : 'text-muted'}`}>
        {message}
      </p>
    </div>
  );
}
```

- [ ] **Step 3: Borrar `AuditWorkflow.tsx`**

```bash
git rm "apps/web/src/app/(private)/auditorias/[auditId]/AuditWorkflow.tsx"
```

Todavía está importado por `AuditWorkspace.tsx:12`; el typecheck fallará hasta la Task 10. Continúa.

- [ ] **Step 4: Commit**

```bash
git add "apps/web/src/app/(private)/auditorias/[auditId]/components/JobAutoResume.tsx" "apps/web/src/app/(private)/auditorias/[auditId]/components/EvidenceUploader.tsx"
git commit -m "feat(audit): JobAutoResume y EvidenceUploader desde AuditWorkflow

JobAutoResume queda siempre montado porque POST /api/jobs/process es el unico
worker y solo lo invoca el navegador. EvidenceUploader mueve la carga al boton
+ Agregar del panel de archivos."
```

---

## Task 9: `fact-review-state` y `FactReviewPanel`

**Files:**
- Create: `apps/web/src/lib/fact-review-state.ts`, `apps/web/src/lib/fact-review-state.test.ts`
- Create: `apps/web/src/app/(private)/auditorias/[auditId]/components/FactReviewPanel.tsx`

**Interfaces:**
- Consumes: `drainQueue` de Task 7.
- Produces:
  - `type FactRowView = { id: string; factType: string; value: unknown; confidence: number | null; sourceRef: Record<string, unknown> }`
  - `type FactReviewView = { factId: string; decision: 'VALID' | 'INVALID'; correctedValue: unknown }`
  - `type FactSummary = { fact: FactRowView; review: FactReviewView | null; state: 'UNREVIEWED' | 'VALID' | 'INVALID' | 'CORRECTED' }`
  - `summarizeReviews(facts: FactRowView[], reviews: FactReviewView[]): FactSummary[]`
  - `canRecalculate(input: { snapshotStatus: 'DRAFT' | 'FINAL' | null; hasFrozenRun: boolean }): { allowed: boolean; reason: string | null }`
  - `FactReviewPanel({ auditId, facts, reviews, snapshotStatus, hasFrozenRun, onRecalculated }: { ... }): JSX.Element`

- [ ] **Step 1: Escribir el test de la lógica pura**

```ts
// apps/web/src/lib/fact-review-state.test.ts
import { describe, expect, it } from 'vitest';
import { canRecalculate, summarizeReviews, type FactRowView, type FactReviewView } from './fact-review-state';

const fact = (id: string, factType = 'student.level'): FactRowView => ({ id, factType, value: 'LICENCIATURA', confidence: 0.8, sourceRef: { evidenceId: 'ev-1' } });

describe('summarizeReviews', () => {
  it('marca UNREVIEWED cuando no hay revision', () => {
    expect(summarizeReviews([fact('f-1')], [])[0].state).toBe('UNREVIEWED');
  });

  it('marca VALID e INVALID segun la decision', () => {
    expect(summarizeReviews([fact('f-1')], [{ factId: 'f-1', decision: 'VALID', correctedValue: null }])[0].state).toBe('VALID');
    expect(summarizeReviews([fact('f-1')], [{ factId: 'f-1', decision: 'INVALID', correctedValue: null }])[0].state).toBe('INVALID');
  });

  it('marca CORRECTED cuando la revision trae valor corregido', () => {
    expect(summarizeReviews([fact('f-1')], [{ factId: 'f-1', decision: 'VALID', correctedValue: 'POSGRADO' }])[0].state).toBe('CORRECTED');
  });

  it('toma la revision mas reciente de cada hecho', () => {
    const reviews: FactReviewView[] = [
      { factId: 'f-1', decision: 'INVALID', correctedValue: null },
      { factId: 'f-1', decision: 'VALID', correctedValue: 'POSGRADO' },
    ];
    expect(summarizeReviews([fact('f-1')], reviews)[0].state).toBe('CORRECTED');
  });

  it('conserva el orden de los hechos y tolera revisiones huerfanas', () => {
    const result = summarizeReviews([fact('f-1'), fact('f-2')], [{ factId: 'f-9', decision: 'VALID', correctedValue: null }]);
    expect(result.map((entry) => entry.fact.id)).toEqual(['f-1', 'f-2']);
  });

  it('devuelve lista vacia sin hechos (demo local)', () => {
    expect(summarizeReviews([], [])).toEqual([]);
  });
});

describe('canRecalculate', () => {
  it('permite recalcular con snapshot DRAFT y run congelado', () => {
    expect(canRecalculate({ snapshotStatus: 'DRAFT', hasFrozenRun: true })).toEqual({ allowed: true, reason: null });
  });

  it('bloquea con el motivo cuando el dictamen ya fue aprobado', () => {
    const result = canRecalculate({ snapshotStatus: 'FINAL', hasFrozenRun: true });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('ya fue aprobado');
  });

  it('bloquea cuando no hay fact run congelado', () => {
    const result = canRecalculate({ snapshotStatus: 'DRAFT', hasFrozenRun: false });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('hechos');
  });

  it('el bloqueo por dictamen aprobado tiene prioridad sobre el de run ausente', () => {
    expect(canRecalculate({ snapshotStatus: 'FINAL', hasFrozenRun: false }).reason).toContain('ya fue aprobado');
  });
});
```

- [ ] **Step 2: Correr el test y verificar que falla**

Run: `pnpm --filter @cancelaciones/web test src/lib/fact-review-state.test.ts`
Expected: FAIL con `Cannot find module './fact-review-state'`.

- [ ] **Step 3: Implementar `fact-review-state.ts`**

```ts
// apps/web/src/lib/fact-review-state.ts
export type FactRowView = { id: string; factType: string; value: unknown; confidence: number | null; sourceRef: Record<string, unknown> };
export type FactReviewView = { factId: string; decision: 'VALID' | 'INVALID'; correctedValue: unknown };
export type FactSummary = { fact: FactRowView; review: FactReviewView | null; state: 'UNREVIEWED' | 'VALID' | 'INVALID' | 'CORRECTED' };

export function summarizeReviews(facts: FactRowView[], reviews: FactReviewView[]): FactSummary[] {
  const latest = new Map<string, FactReviewView>();
  for (const review of reviews) latest.set(review.factId, review);
  return facts.map((fact) => {
    const review = latest.get(fact.id) ?? null;
    const state: FactSummary['state'] = !review
      ? 'UNREVIEWED'
      : review.correctedValue !== null && review.correctedValue !== undefined
        ? 'CORRECTED'
        : review.decision === 'VALID' ? 'VALID' : 'INVALID';
    return { fact, review, state };
  });
}

export function canRecalculate(input: { snapshotStatus: 'DRAFT' | 'FINAL' | null; hasFrozenRun: boolean }): { allowed: boolean; reason: string | null } {
  if (input.snapshotStatus === 'FINAL') {
    return { allowed: false, reason: 'El dictamen ya fue aprobado. El re-dictamen no esta disponible.' };
  }
  if (!input.hasFrozenRun) {
    return { allowed: false, reason: 'Aun no hay hechos extraidos para recalcular.' };
  }
  return { allowed: true, reason: null };
}
```

- [ ] **Step 4: Correr el test y verificar que pasa**

Run: `pnpm --filter @cancelaciones/web test src/lib/fact-review-state.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 5: Crear `FactReviewPanel.tsx`**

```tsx
'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { drainQueue } from '@/lib/job-queue';
import { canRecalculate, summarizeReviews, type FactReviewView, type FactRowView } from '@/lib/fact-review-state';

const stateLabel: Record<string, string> = {
  UNREVIEWED: 'Sin revisar',
  VALID: 'Respaldado',
  INVALID: 'No respaldado',
  CORRECTED: 'Corregido',
};

async function readJson(response: Response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text) as Record<string, unknown>; } catch { return { message: text.slice(0, 500) }; }
}

export function FactReviewPanel({ auditId, facts, reviews, snapshotStatus, hasFrozenRun, onRecalculated }: {
  auditId: string;
  facts: FactRowView[];
  reviews: FactReviewView[];
  snapshotStatus: 'DRAFT' | 'FINAL' | null;
  hasFrozenRun: boolean;
  onRecalculated?: () => void;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const summaries = useMemo(() => summarizeReviews(facts, reviews), [facts, reviews]);
  const gate = canRecalculate({ snapshotStatus, hasFrozenRun });

  async function review(factId: string, decision: 'VALID' | 'INVALID', correctedValue?: unknown) {
    setBusy(true);
    setMessage('');
    try {
      const response = await fetch(`/api/audits/${auditId}/fact-reviews`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ factId, decision, correctedValue }),
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(String(data.message ?? 'No fue posible guardar la revision.'));
      setMessage('Revision guardada. Pulsa "Volver a iniciar el dictamen" para recalcular.');
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'No fue posible guardar la revision.');
    } finally {
      setBusy(false);
    }
  }

  async function recalculate() {
    const excluded = summaries.filter((entry) => entry.state === 'INVALID').length;
    const corrected = summaries.filter((entry) => entry.state === 'CORRECTED').length;
    const ok = window.confirm(
      `Se recalculara el dictamen con ${excluded} hecho(s) excluidos y ${corrected} corregido(s). `
      + 'La linea base anterior no se sobrescribe y el dictamen emitido no se modifica. Continuar?',
    );
    if (!ok) return;
    setBusy(true);
    setMessage('Recalculando el dictamen...');
    try {
      const response = await fetch(`/api/audits/${auditId}/jobs`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: 'action=EXTRACT_FACTS',
      });
      const data = await readJson(response);
      if (!response.ok) throw new Error(String(data.message ?? 'No fue posible recalcular el dictamen.'));
      const drained = await drainQueue(auditId);
      if (!drained.ok) throw new Error(drained.message);
      setMessage('Dictamen recalculado. Revisa el resultado y registra de nuevo tu revision humana.');
      onRecalculated?.();
      router.refresh();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'No fue posible recalcular el dictamen.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-lg border border-line bg-surface-1 p-4">
      <h2 className="font-semibold text-ink">Hechos revisados</h2>
      <p className="mt-1 text-[11px] text-muted">Marca los datos que la evidencia no respalda. El recalculo los excluye y crea una nueva corrida del motor.</p>

      {summaries.length === 0 ? (
        <p className="mt-3 text-xs text-muted">Aun no hay hechos extraidos.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {summaries.map(({ fact, state }) => (
            <li key={fact.id} className="rounded border border-line bg-surface-2 p-2 text-xs">
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0">
                  <span className="block font-semibold text-ink">{fact.factType}</span>
                  <span className="mt-0.5 block break-words text-[10px] text-muted">{JSON.stringify(fact.value)}</span>
                </span>
                <span className={`shrink-0 rounded px-2 py-0.5 text-[10px] font-semibold ${state === 'INVALID' ? 'bg-warning/20 text-warning' : state === 'UNREVIEWED' ? 'bg-surface-3 text-muted' : 'bg-success/20 text-success'}`}>
                  {stateLabel[state]}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <button type="button" disabled={busy} aria-label={`Marcar ${fact.factType} como respaldado`} onClick={() => void review(fact.id, 'VALID')} className="rounded border border-success/25 px-2 py-0.5 text-[10px] font-semibold text-success disabled:opacity-50">Respaldado</button>
                <button type="button" disabled={busy} aria-label={`Marcar ${fact.factType} como no respaldado`} onClick={() => void review(fact.id, 'INVALID')} className="rounded border border-warning/25 px-2 py-0.5 text-[10px] font-semibold text-warning disabled:opacity-50">No respaldado</button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <button type="button" disabled={busy || !gate.allowed} onClick={() => void recalculate()} className="w-full rounded-md bg-brand px-3 py-2 text-xs font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
          {busy ? 'Procesando...' : 'Volver a iniciar el dictamen con otros hechos'}
        </button>
        {gate.reason && <p role="note" className="mt-2 rounded border border-line bg-surface-2 px-2 py-1 text-[11px] text-warning">{gate.reason}</p>}
        {message && <p aria-live="polite" className="mt-2 text-[11px] text-muted">{message}</p>}
      </div>
    </section>
  );
}
```

- [ ] **Step 6: Commit**

```bash
git add apps/web/src/lib/fact-review-state.ts apps/web/src/lib/fact-review-state.test.ts "apps/web/src/app/(private)/auditorias/[auditId]/components/FactReviewPanel.tsx"
git commit -m "feat(audit): panel de revision de hechos y boton de re-dictamen

El boton entra por la cola (EXTRACT_FACTS) y deja que el pipeline produzca los
hechos, el engine run, la linea base y el snapshot. Queda deshabilitado con
aviso en texto cuando el dictamen ya fue aprobado."
```

---

## Task 10: `AuditWorkspace` con tres pestañas

**Files:**
- Modify: `apps/web/src/app/(private)/auditorias/[auditId]/components/AuditWorkspace.tsx:6-147`
- Modify: `apps/web/src/app/(private)/auditorias/[auditId]/page.tsx:43-108`
- Modify: `apps/web/src/app/(private)/auditorias/[auditId]/components/types.ts`

**Interfaces:**
- Consumes: `JobAutoResume`, `EvidenceUploader` (Task 8), `FactReviewPanel` (Task 9), `EvidenceSelector` (Task 11), `RuleGroupList`, `ManualCommentsPanel`, `DictamenWorkflow`, `HumanReviewCard`.
- Produces: `InspectorTab = 'dictamen' | 'reglas' | 'comentarios'`; props nuevas `facts`, `factReviews`, `evidenceSelection`; props eliminadas `auditRuns`, `humanDecisionExtract`, `comparison`, `adjudication`, `timelineEvents`, `transcripts` se mantiene, `factRunId` se mantiene.

- [ ] **Step 1: Añadir los tipos a `types.ts`**

Añadir al final de `apps/web/src/app/(private)/auditorias/[auditId]/components/types.ts`:

```ts
export interface FactRow {
  id: string;
  auditId: string;
  runId: string;
  factType: string;
  classification: string;
  value: unknown;
  sourceRef: Record<string, unknown>;
  confidence: number | null;
  createdAt: string;
}

export interface FactReviewRow {
  factId: string;
  decision: 'VALID' | 'INVALID';
  correctedValue: unknown;
  createdAt: string;
}
```

- [ ] **Step 2: Cargar facts y revisiones en `page.tsx`**

En `apps/web/src/app/(private)/auditorias/[auditId]/page.tsx`, sustituir el bloque `const [manualComments, evidences, artifacts, ...] = await Promise.all([...]);` (líneas 43-55) por:

```ts
  const [manualComments, evidences, artifacts, humanReview, snapshot, dictamenDocuments, evidenceSelection, factRuns, factReviews] = await Promise.all([
    createAuditManualCommentsRepository(client.database).findByAudit(auditId),
    createEvidenceRepository(client.database).listByAudit(auditId),
    createJobRepository(client.database).listArtifactsByAudit(auditId),
    createHumanReviewRepository(client.database).findByAudit(auditId),
    createReportSnapshotRepository(client.database).findLatestByAudit(auditId),
    createDictamenDocumentRepository(client.database).listByAudit(auditId),
    createEvidenceSelectionRepository(client.database).listByAudit(auditId),
    createFactRepository(client.database).listRunsByAudit(auditId),
    client.database.from('fact_reviews').select('fact_id,decision,corrected_value,created_at').eq('audit_id', auditId).order('created_at', { ascending: false }),
  ]);

  const selectedRun = factRuns.find((run) => run.state === 'FROZEN') ?? factRuns[0] ?? null;
  const facts = selectedRun ? await createFactRepository(client.database).listFactsByRun(selectedRun.id) : [];
  const latestEngineRun = await client.database.from('engine_runs').select('*').eq('audit_id', auditId).order('created_at', { ascending: false }).limit(1);
  const evaluation = latestEngineRun.data?.[0]?.evaluation as PolicyEvaluation | undefined;

  const reviewRows = (factReviews.data ?? []) as Array<{ fact_id: string; decision: 'VALID' | 'INVALID'; corrected_value: unknown; created_at: string }>;
  const reviewByFact = new Map<string, FactReviewRow>();
  for (const row of reviewRows) {
    if (!reviewByFact.has(row.fact_id)) reviewByFact.set(row.fact_id, { factId: row.fact_id, decision: row.decision, correctedValue: row.corrected_value, createdAt: row.created_at });
  }

  return renderAuditDetail({
    commentsSaved,
    audit,
    manualComments,
    evidences,
    artifacts,
    humanReview,
    snapshot,
    dictamenDocuments,
    evidenceSelection: evidenceSelection.map((row) => row.evidenceId),
    facts: facts.map((fact) => ({ id: fact.id, auditId: fact.auditId, runId: fact.runId, factType: fact.factType, classification: fact.classification, value: fact.value, sourceRef: fact.sourceRef, confidence: fact.confidence, createdAt: fact.createdAt })),
    factReviews: Array.from(reviewByFact.values()),
    selectedRun,
    evaluation,
    demoMode: false,
  });
```

Actualizar el import de la línea 2 para incluir `createEvidenceSelectionRepository`, y añadir `import type { FactReviewRow } from './components/types';`.

- [ ] **Step 3: Ajustar la rama de demo en `page.tsx`**

En el bloque `if (isLocalDemoMode())` (líneas 21-37), añadir `facts: []`, `factReviews: []` y `evidenceSelection: []` a la llamada a `renderAuditDetail`.

- [ ] **Step 4: Actualizar la firma de `renderAuditDetail`**

En `renderAuditDetail` (líneas 65-82), añadir los tres parámetros y sus tipos:

```ts
  evidenceSelection: string[];
  facts: import('./components/types').FactRow[];
  factReviews: import('./components/types').FactReviewRow[];
```

y pasarlos al `<AuditWorkspace>` (después de `ruleLabels={ruleLabels}`):

```tsx
      facts={facts}
      factReviews={factReviews}
      evidenceSelection={evidenceSelection}
```

Quitar de la llamada las props `auditRuns`, `humanDecisionExtract`, `comparison`, `adjudication` y `timelineEvents`, y sus tipos de la firma. Quitar los imports de `createAuditRunRepository`, `createHumanDecisionExtractRepository`, `createComparisonRepository`, `createAdjudicationRepository` y `createAuditLogRepository` de la línea 2.

- [ ] **Step 5: Reescribir `AuditWorkspace.tsx`**

Reemplazar el archivo completo por:

```tsx
'use client';

import { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import { formatDateTime } from '@/lib/format';
import type { DictamenDocumentRecord, EvaluatedRule, EvidenceRow, FactReviewRow, FactRow, HumanReviewRecord, MissingItem, PolicyEvaluationShape, SnapshotRecord } from './types';
import { AuditStatusBadge } from './AuditStatusBadge';
import { DictamenWorkflow } from './DictamenWorkflow';
import { EvidenceSelector } from './EvidenceSelector';
import { EvidenceUploader } from './EvidenceUploader';
import { FactReviewPanel } from './FactReviewPanel';
import { HumanReviewCard } from './HumanReviewCard';
import { JobAutoResume } from './JobAutoResume';
import { ManualCommentsPanel } from './ManualCommentsPanel';
import { RuleGroupList } from './RuleGroupList';
import { DeleteAuditButton } from '@/components/DeleteAuditButton';

type InspectorTab = 'dictamen' | 'reglas' | 'comentarios';

type TranscriptArtifact = {
  id: string;
  evidenceId: string | null;
  result: Record<string, unknown>;
};

type AuditHeader = {
  id: string;
  displayName: string | null;
  externalCaseId: string | null;
  createdAt: string;
};

const TABS: InspectorTab[] = ['dictamen', 'reglas', 'comentarios'];

export function AuditWorkspace({
  audit,
  status,
  evidences,
  transcripts,
  evaluation,
  policyVersion,
  manualComments,
  commentsSaved,
  humanReview,
  snapshot,
  documents,
  hasHumanReview,
  rules,
  missingItems,
  ruleLabels,
  facts,
  factReviews,
  evidenceSelection,
  factRunId,
  demoMode,
}: {
  audit: AuditHeader;
  status: string;
  evidences: EvidenceRow[];
  transcripts: TranscriptArtifact[];
  evaluation?: PolicyEvaluationShape | null;
  policyVersion?: string | null;
  manualComments: Parameters<typeof ManualCommentsPanel>[0]['comments'];
  commentsSaved?: boolean;
  humanReview?: HumanReviewRecord | null;
  snapshot?: SnapshotRecord | null;
  documents?: DictamenDocumentRecord[];
  hasHumanReview: boolean;
  rules: EvaluatedRule[];
  missingItems: MissingItem[];
  ruleLabels: Record<string, string>;
  facts: FactRow[];
  factReviews: FactReviewRow[];
  evidenceSelection: string[];
  factRunId?: string | null;
  demoMode: boolean;
}) {
  const [selectedEvidenceId, setSelectedEvidenceId] = useState(evidences[0]?.id ?? '');
  const [tab, setTab] = useState<InspectorTab>('dictamen');
  const [pipelineError, setPipelineError] = useState('');
  const selectedEvidence = evidences.find((evidence) => evidence.id === selectedEvidenceId) ?? evidences[0] ?? null;
  const selectedTranscript = useMemo(() => {
    return transcripts.find((artifact) => artifact.evidenceId === selectedEvidence?.id) ?? transcripts[0] ?? null;
  }, [selectedEvidence?.id, transcripts]);
  const utterances = selectedTranscript?.result.utterances as Array<{ speaker?: string; text?: string; start?: number }> | undefined;
  const resolution = normalizeResolution(evaluation?.suggestedOutcome, evaluation?.decisionStatus ?? evaluation?.outcomeStatus);
  // El mas reciente, no el primero: con re-dictamen hay varios snapshots.
  const downloadDoc = useMemo(() => {
    const ordered = [...(documents ?? [])].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
    return ordered.find((doc) => doc.kind === 'FINAL') ?? ordered.find((doc) => doc.kind === 'DRAFT') ?? null;
  }, [documents]);
  const onPipelineError = useCallback((message: string) => setPipelineError(message), []);

  return (
    <section className="h-screen overflow-hidden bg-background p-2 text-ink">
      <JobAutoResume auditId={audit.id} enabled={!demoMode} onError={onPipelineError} />
      <div className="grid h-full grid-rows-[auto_auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-line bg-[#0f1319]">
        <header className="grid grid-cols-[72px_minmax(260px,1fr)_minmax(300px,1.15fr)_minmax(240px,300px)] gap-2 border-b border-line bg-surface-1 p-2">
          <Link href="/auditorias" className="inline-flex items-center justify-center rounded-md border border-line bg-surface-2 text-xs font-semibold text-ink hover:bg-white/5">⌂ HOME</Link>
          <div className="rounded-md border border-line bg-surface-2 px-3 py-2">
            <p className="font-mono text-[10px] uppercase tracking-wider text-muted">Nombre: <span className="font-sans font-semibold normal-case text-ink">{audit.displayName ?? 'Expediente de auditoría'}</span></p>
            <p className="mt-1 font-mono text-[10px] text-muted">Matrícula: — <span className="mx-2">•</span> Fecha de inicio: {formatDateTime(audit.createdAt)}</p>
          </div>
          <div className="rounded-md border border-line bg-surface-2 px-3 py-2">
            <div className="flex items-center justify-between gap-2"><p className="font-mono text-[10px] uppercase tracking-wider text-muted">Número de caso: <span className="font-sans font-semibold text-brand">{audit.externalCaseId ?? audit.id.slice(0, 13)}</span></p><AuditStatusBadge status={status} /></div>
            <p className="mt-1 font-mono text-[10px] text-muted">Ticket: {formatDateTime(audit.createdAt)} <span className="mx-2">•</span> Política: {policyVersion ?? '—'}</p>
          </div>
          <div className="flex items-center gap-2">
            <a href={downloadDoc ? `/api/audits/${audit.id}/dictamen/${downloadDoc.id}/download` : '#dictamen'} className="inline-flex min-w-0 flex-1 items-center justify-center rounded-md bg-[#5b8cff] px-3 py-2 text-center text-xs font-semibold text-white hover:bg-[#6d99ff]">⇩ Resolución / Descarga del dictamen</a>
            <Link href={`/auditorias/${audit.id}/comparacion`} className="inline-flex items-center justify-center rounded-md border border-line bg-surface-2 px-3 py-2 text-xs font-semibold text-ink hover:bg-white/5">Comparación</Link>
            {!demoMode && <DeleteAuditButton auditId={audit.id} auditLabel={audit.displayName ?? undefined} redirectTo="/auditorias" compact />}
          </div>
        </header>

        <div className="grid grid-cols-[220px_minmax(420px,1fr)_360px] border-b border-line bg-surface-1 text-[11px] text-muted">
          <div className="flex items-center justify-between border-r border-line px-3 py-2"><span className="font-semibold text-ink">Evidencias</span><span>{evidences.length}</span></div>
          <div className="flex items-center gap-5 px-4 py-2"><span>−</span><span>100%</span><span>＋</span><span>‹</span><span>Pág 3 de 7</span><span>›</span><span className="rounded border border-brand/25 bg-brand/10 px-2 py-1 text-brand">Marcador de regla (1)</span></div>
          <div role="tablist" aria-label="Secciones del dictamen" className="flex items-center gap-1 border-l border-line px-3 py-2">
            {TABS.map((item) => (
              <button
                key={item}
                role="tab"
                type="button"
                aria-selected={tab === item}
                onClick={() => setTab(item)}
                className={`rounded-md px-3 py-1.5 text-xs capitalize ${tab === item ? 'border border-line bg-surface-2 text-ink' : 'text-muted hover:text-ink'}`}
              >{item}</button>
            ))}
          </div>
        </div>

        <div className="grid min-h-0 grid-cols-[220px_minmax(420px,1fr)_360px]">
          <aside className="flex min-h-0 flex-col border-r border-line bg-surface-1">
            <div className="flex items-center justify-between border-b border-line px-3 py-3 text-xs">
              <span className="font-semibold text-ink">Archivos</span>
              <EvidenceUploader auditId={audit.id} />
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto px-2 pb-2">
              {evidences.map((evidence) => <button key={evidence.id} onClick={() => setSelectedEvidenceId(evidence.id)} className={`flex w-full gap-2 rounded-md p-2 text-left transition ${selectedEvidence?.id === evidence.id ? 'bg-surface-3' : 'hover:bg-surface-2'}`}>
                <span className={`mt-1 grid h-6 w-7 shrink-0 place-items-center rounded text-[10px] font-semibold ${kindColor(evidence.detectedMimeType)}`}>{fileKind(evidence.detectedMimeType)}</span>
                <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold text-ink">{evidence.originalFilename}</span><span className="mt-1 block text-[10px] text-muted">{formatSize(evidence.sizeBytes)}</span></span>
                <span className="mt-2 h-1.5 w-1.5 rounded-full bg-success" />
              </button>)}
            </div>
            {selectedEvidence && fileKind(selectedEvidence.detectedMimeType) === 'AUD' && <div className="border-t border-line p-3 text-[11px]">
              <p className="font-semibold text-ink">🔊 Reproductor de Audio</p><p className="mt-2 truncate text-muted">{selectedEvidence.originalFilename}</p><div className="mt-3 h-1 rounded bg-surface-3"><div className="h-full w-2/3 rounded bg-brand" /></div><div className="mt-3 flex gap-2"><button>◌</button><button>▶</button><span className="rounded bg-surface-3 px-2 py-1">1.0x</span><span className="ml-auto rounded border border-brand/20 bg-brand/10 px-2 py-1 text-brand">Regla 5.2</span></div>
            </div>}
            <div className="border-t border-line px-3 py-2 text-[10px] text-muted"><span className="text-success">●</span> Almacenamiento seguro <span className="float-right">SHA-256</span></div>
          </aside>

          <main className="min-h-0 overflow-hidden bg-[#0d1117] p-5">
            <EvidenceViewer evidence={selectedEvidence} utterances={utterances} transcriptId={selectedTranscript?.id} />
          </main>

          <aside className="min-h-0 overflow-y-auto border-l border-line bg-surface-1 p-4">
            {pipelineError && <p role="alert" className="mb-3 rounded-lg border border-danger/25 bg-danger/10 px-3 py-2 text-xs text-danger">{pipelineError}</p>}
            {tab === 'dictamen' && <div className="space-y-4">
              <DictamenInspector auditId={audit.id} resolution={resolution} evaluation={evaluation} humanReview={humanReview} snapshot={snapshot} documents={documents} hasHumanReview={hasHumanReview} />
              <FactReviewPanel auditId={audit.id} facts={facts} reviews={factReviews} snapshotStatus={snapshot?.status ?? null} hasFrozenRun={Boolean(factRunId)} />
              <details className="rounded-lg border border-line bg-surface-1 p-4">
                <summary className="cursor-pointer font-semibold text-ink">Evidencias que respaldan el dictamen ({evidenceSelection.length})</summary>
                <div className="mt-3"><EvidenceSelector auditId={audit.id} evidences={evidences} selection={evidenceSelection} /></div>
              </details>
            </div>}
            {tab === 'reglas' && <RulesInspector rules={rules} missingItems={missingItems} ruleLabels={ruleLabels} />}
            {tab === 'comentarios' && <ManualCommentsPanel auditId={audit.id} comments={manualComments} saved={commentsSaved} />}
          </aside>
        </div>
      </div>
    </section>
  );
}

function DictamenInspector({ auditId, resolution, evaluation, humanReview, snapshot, documents, hasHumanReview }: { auditId: string; resolution: string; evaluation?: PolicyEvaluationShape | null; humanReview?: HumanReviewRecord | null; snapshot?: SnapshotRecord | null; documents?: DictamenDocumentRecord[]; hasHumanReview: boolean }) {
  return <div id="dictamen" className="space-y-4"><div className="rounded-lg border border-line bg-surface-2 p-4"><p className="font-mono text-[10px] uppercase text-muted">Resultado motor políticas</p><div className="mt-2 rounded-md border border-warning/20 bg-warning/10 p-3 text-center text-sm font-black uppercase tracking-wide text-warning">{resolution}</div><p className="mt-3 text-xs leading-5 text-ink">{evaluation?.suggestedReason ?? 'Aún no hay resolución generada.'}</p><p className="mt-2 text-[11px] text-muted">Política aplicada: {evaluation?.policyCode ?? 'GDM_GAM_PRD_MLG_003'} V{evaluation?.policyVersion ?? '—'}</p></div><HumanReviewCard auditId={auditId} review={humanReview} machineOutcome={evaluation?.suggestedOutcome ?? null} /><DictamenWorkflow auditId={auditId} snapshot={snapshot} documents={documents} hasHumanReview={hasHumanReview} /></div>;
}

function RulesInspector({ rules, missingItems, ruleLabels }: { rules: EvaluatedRule[]; missingItems: MissingItem[]; ruleLabels: Record<string, string> }) {
  return <div className="space-y-4"><div className="rounded-lg border border-line bg-surface-2 p-4"><h2 className="font-semibold text-ink">Reglas evaluadas</h2><RuleGroupList rules={rules} ruleLabels={ruleLabels} /></div>{missingItems.length > 0 && <div className="rounded-lg border border-warning/20 bg-warning/10 p-3 text-xs text-warning">{missingItems.length} datos pendientes para cerrar reglas.</div>}</div>;
}

function EvidenceViewer({ evidence, utterances, transcriptId }: { evidence: EvidenceRow | null; utterances?: Array<{ speaker?: string; text?: string; start?: number }>; transcriptId?: string }) {
  if (!evidence) return <div className="grid h-full place-items-center text-sm text-muted">No hay evidencia seleccionada.</div>;
  const kind = fileKind(evidence.detectedMimeType);
  if (kind === 'AUD' || utterances) return <div className="mx-auto flex h-full max-w-3xl flex-col rounded-lg border border-line bg-surface-1 p-4">
    <div className="flex items-center justify-between border-b border-line pb-3"><h2 className="font-semibold text-ink">▣ Transcripción</h2><div className="flex gap-2 text-[11px]"><span className="rounded bg-surface-3 px-2 py-1">{utterances?.length ?? 0} intervenciones</span><span className="rounded bg-surface-3 px-2 py-1">Whisper Large v3</span><span className="rounded border border-line px-2 py-1">Buscar</span></div></div>
    <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pt-4">{(utterances ?? []).map((u, i) => <div key={`${transcriptId}-${i}`} className={`max-w-[86%] rounded-lg border p-3 text-xs leading-5 ${i % 2 ? 'ml-auto border-white/70 bg-background' : 'border-line bg-surface-2'}`}><div className="mb-2 flex justify-between text-[10px] font-semibold text-muted"><span>{u.speaker ?? 'Participante'}</span><span>{typeof u.start === 'number' ? `${Math.round(u.start / 1000).toString().padStart(2, '0')}:00` : ''}</span></div><p className="text-ink">{u.text}</p></div>)}</div>
  </div>;
  const src = `/api/evidences/${evidence.id}/download`;
  if (kind === 'IMG') return <div className="flex h-full min-h-0 flex-col rounded-lg border border-line bg-surface-1"><EvidenceToolbar evidence={evidence} src={src} />
    <div className="grid min-h-0 flex-1 place-items-center overflow-hidden bg-[#0d1117] p-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`${src}?inline=1`} alt={evidence.originalFilename} className="max-h-full max-w-full object-contain shadow-sm" />
    </div>
  </div>;
  if (kind === 'PDF' || kind === 'TXT') return <div className="flex h-full min-h-0 flex-col rounded-lg border border-line bg-surface-1"><EvidenceToolbar evidence={evidence} src={src} /><iframe src={`${src}?inline=1`} title={evidence.originalFilename} className="min-h-0 w-full flex-1" /></div>;
  return <div className="grid h-full place-items-center rounded-lg border border-line bg-surface-1"><div className="text-center"><div className="mx-auto mb-4 grid h-44 w-36 place-items-center rounded-lg border border-line bg-surface-2 text-danger">{kind}</div><p className="text-sm font-semibold text-ink">{evidence.originalFilename}</p><div className="mt-3 flex justify-center gap-2"><a className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-white/5" href={`${src}?inline=1`} target="_blank" rel="noreferrer">Ver en el navegador</a><a className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white" href={`${src}?download=1`}>Descargar</a></div></div></div>;
}

function EvidenceToolbar({ evidence, src }: { evidence: EvidenceRow; src: string }) {
  return <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-3">
    <div className="min-w-0"><p className="truncate text-sm font-semibold text-ink">{evidence.originalFilename}</p><p className="mt-0.5 text-[11px] text-muted">{evidence.detectedMimeType} · {formatSize(evidence.sizeBytes)}</p></div>
    <div className="flex shrink-0 gap-2"><a className="rounded-md border border-line px-3 py-1.5 text-xs font-semibold text-ink hover:bg-white/5" href={`${src}?inline=1`} target="_blank" rel="noreferrer">Abrir en pestaña</a><a className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white" href={`${src}?download=1`}>Descargar</a></div>
  </div>;
}

function normalizeResolution(outcome?: string | null, status?: string | null) {
  const value = `${outcome ?? status ?? 'Requiere revisión'}`.toUpperCase();
  if (value.includes('PROCEDE')) return value;
  if (value.includes('OBS')) return 'OBSERVACIÓN REQUERIDA';
  if (value.includes('REVIEW') || value.includes('REVIS')) return 'REQUIERE REVISIÓN';
  return value;
}

function fileKind(mimeType?: string | null) { const mime = mimeType?.toLowerCase() ?? ''; if (mime.includes('pdf')) return 'PDF'; if (mime.includes('image')) return 'IMG'; if (mime.includes('audio')) return 'AUD'; if (mime.includes('sheet') || mime.includes('excel')) return 'XLS'; if (mime.includes('word') || mime.includes('document')) return 'DOC'; if (mime.includes('text')) return 'TXT'; return 'FILE'; }
function kindColor(mimeType?: string | null) { const kind = fileKind(mimeType); if (kind === 'PDF') return 'bg-danger/20 text-danger'; if (kind === 'IMG') return 'bg-brand/20 text-brand'; if (kind === 'AUD') return 'bg-warning/20 text-warning'; return 'bg-surface-3 text-muted'; }
function formatSize(bytes: number) { return bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.round(bytes / 1024)} KB`; }
```

- [ ] **Step 6: Verificar**

Run: `pnpm --filter @cancelaciones/web typecheck`
Expected: PASS. `UploadInspector`, `ComparisonInspector`, `StatusPill` y `postJson` desaparecieron del archivo; `AuditWorkflow` y `PolicyEvaluationPanel` quedan huérfanos hasta las Tasks 11 y 14, y ninguna referencia rota porque `PolicyEvaluationPanel` nunca se importó.

- [ ] **Step 7: Commit**

```bash
git add "apps/web/src/app/(private)/auditorias/[auditId]/components/AuditWorkspace.tsx" "apps/web/src/app/(private)/auditorias/[auditId]/page.tsx" "apps/web/src/app/(private)/auditorias/[auditId]/components/types.ts"
git commit -m "feat(audit): workspace con tres pestanas y carga en + Agregar

El inspector derecho queda en dictamen, reglas y comentarios. JobAutoResume se
monta siempre para que la cola se drene, EvidenceUploader sustituye a la
pestana de carga y la descarga del encabezado toma el PDF mas reciente."
```

---

## Task 11: `EvidenceSelector` y `DictamenWorkflow`

**Files:**
- Modify: `apps/web/src/app/(private)/auditorias/[auditId]/components/EvidenceSelector.tsx`
- Modify: `apps/web/src/app/(private)/auditorias/[auditId]/components/DictamenWorkflow.tsx:47-94`

**Interfaces:**
- Consumes: `snapshot`, `documents`, `hasHumanReview` de `AuditWorkspace` (Task 10).
- Produces: `EvidenceSelector` con padding compacto y sin sección redundante; `DictamenWorkflow` con prop `reviewIsStale` y lista de documentos ordenada por `generatedAt`.

- [ ] **Step 1: Ajustar `EvidenceSelector` al panel angosto**

En `apps/web/src/app/(private)/auditorias/[auditId]/components/EvidenceSelector.tsx`, reemplazar el `return` del bloque `if (evidences.length === 0)` y el `return` principal por versiones con `p-4` y sin el `<section>` anidado redundante dentro del `<details>` del Task 10. El contenido a renders es:

```tsx
  if (evidences.length === 0) {
    return <p className="text-sm text-muted">Aún no hay evidencias subidas.</p>;
  }

  return (
    <div>
      <p className="text-xs text-muted">Selecciona las evidencias que respaldan el análisis. Solo estas se referencian en el PDF.</p>
      <div className="mt-3 space-y-2">
        {evidences.map((evidence) => {
          const isSelected = selected.includes(evidence.id);
          return (
            <label key={evidence.id} className={`flex cursor-pointer items-center gap-3 rounded-lg border p-2 text-sm transition ${isSelected ? 'border-brand bg-brand/10' : 'border-line bg-surface-2 hover:border-white/15'}`}>
              <input type="checkbox" checked={isSelected} onChange={() => toggle(evidence.id)} className="h-4 w-4 accent-brand" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium text-ink">{evidence.originalFilename}</span>
                <span className="block text-xs text-muted">{evidence.detectedMimeType} · {Math.round(evidence.sizeBytes / 1024)} KB · {evidence.status}</span>
              </span>
            </label>
          );
        })}
      </div>
      <div className="mt-3 flex items-center justify-between gap-3">
        <p className="text-xs text-muted">{selected.length} seleccionada(s) de {evidences.length}</p>
        <button type="button" onClick={() => void save()} disabled={saving}
          className="inline-flex items-center rounded-lg bg-ink px-4 py-2 text-sm font-semibold text-background transition hover:bg-white disabled:cursor-not-allowed disabled:opacity-60">
          {saving ? 'Guardando…' : 'Guardar selección'}
        </button>
      </div>
      {message && <p aria-live="polite" className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-muted">{message}</p>}
    </div>
  );
```

- [ ] **Step 2: Reflejar el guard de revisión obsoleta en `DictamenWorkflow`**

En `apps/web/src/app/(private)/auditorias/[auditId]/components/DictamenWorkflow.tsx`, cambiar la firma (línea 9):

```tsx
export function DictamenWorkflow({ auditId, snapshot, documents, hasHumanReview, reviewIsStale }: { auditId: string; snapshot?: SnapshotRecord | null; documents?: DictamenDocumentRecord[]; hasHumanReview: boolean; reviewIsStale?: boolean }) {
```

- [ ] **Step 3: Ordenar y listar todos los documentos**

Sustituir las líneas 48-49 por:

```tsx
  const orderedDocs = [...(documents ?? [])].sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
```

y reemplazar el bloque `{(draftDoc || finalDoc) && ( ... )}` (líneas 79-94) por:

```tsx
      {orderedDocs.length > 0 && (
        <div className="mt-5 space-y-2 border-t border-line pt-4">
          {orderedDocs.map((doc) => (
            <div key={doc.id} className={`flex items-center justify-between gap-3 rounded-lg p-3 text-sm ${doc.kind === 'FINAL' ? 'bg-success/10' : 'bg-surface-2'}`}>
              <div className="min-w-0">
                <p className="font-semibold text-ink">{doc.kind === 'FINAL' ? 'Documento FINAL' : 'Borrador'}</p>
                <p className={`truncate text-xs ${doc.kind === 'FINAL' ? 'text-success' : 'text-muted'}`}>Snapshot {doc.snapshotId.slice(0, 8)}… · SHA-256 {doc.pdfSha256.slice(0, 16)}…{doc.kind === 'FINAL' ? ' · inmutable' : ''}</p>
              </div>
              <a className="shrink-0 font-medium hover:underline" href={`/api/audits/${auditId}/dictamen/${doc.id}/download`} style={{ color: doc.kind === 'FINAL' ? 'var(--color-success)' : 'var(--color-brand)' }}>
                {doc.kind === 'FINAL' ? 'Ver PDF final' : 'Ver PDF'}
              </a>
            </div>
          ))}
        </div>
      )}
```

- [ ] **Step 4: Deshabilitar la aprobación con revisión obsoleta**

En el botón «3 · Aprobar snapshot» (línea 65), cambiar la condición `disabled` a:

```tsx
        <button type="button" disabled={busy !== '' || !snapshot || isApproved || !hasHumanReview || reviewIsStale} onClick={() => void act('approve')}
```

y añadir justo debajo del aviso de `!hasHumanReview` (línea 75):

```tsx
      {reviewIsStale && <p className="mt-3 rounded-lg bg-warning/10 px-3 py-2 text-xs text-warning">Tu revisión humana corresponde a otra corrida del motor. Vuelve a registrar tu revisión antes de aprobar.</p>}
```

- [ ] **Step 5: Calcular `reviewIsStale` en `AuditWorkspace` y pasarlo**

En `apps/web/src/app/(private)/auditorias/[auditId]/components/AuditWorkspace.tsx`, añadir tras `const onPipelineError`:

```tsx
  const reviewedEngineRunId = (humanReview?.machineDecision as { engineRunId?: unknown } | null | undefined)?.engineRunId;
  const reviewIsStale = Boolean(humanReview) && Boolean(snapshot) && reviewedEngineRunId !== snapshot?.engineRunId;
```

y añadir `reviewIsStale={reviewIsStale}` a la llamada de `DictamenInspector`, que a su vez lo pasa a `DictamenWorkflow`:

```tsx
function DictamenInspector({ auditId, resolution, evaluation, humanReview, snapshot, documents, hasHumanReview, reviewIsStale }: { auditId: string; resolution: string; evaluation?: PolicyEvaluationShape | null; humanReview?: HumanReviewRecord | null; snapshot?: SnapshotRecord | null; documents?: DictamenDocumentRecord[]; hasHumanReview: boolean; reviewIsStale: boolean }) {
  return <div id="dictamen" className="space-y-4">{/* ... */}<DictamenWorkflow auditId={auditId} snapshot={snapshot} documents={documents} hasHumanReview={hasHumanReview} reviewIsStale={reviewIsStale} /></div>;
}
```

- [ ] **Step 6: Verificar y commitear**

Run: `pnpm --filter @cancelaciones/web typecheck && pnpm --filter @cancelaciones/web lint && pnpm --filter @cancelaciones/web test`
Expected: PASS.

```bash
git add "apps/web/src/app/(private)/auditorias/[auditId]/components/EvidenceSelector.tsx" "apps/web/src/app/(private)/auditorias/[auditId]/components/DictamenWorkflow.tsx" "apps/web/src/app/(private)/auditorias/[auditId]/components/AuditWorkspace.tsx"
git commit -m "feat(dictamen): selector de evidencias y lista de documentos

EvidenceSelector nunca se habia montado, asi que audit_evidence_selection
quedaba vacia y el PDF se emitia sin referenciar evidencias. DictamenWorkflow
lista ahora todos los documentos por snapshot, del mas reciente al mas viejo."
```

---

## Task 12: Vista de comparación

**Files:**
- Create: `apps/web/src/app/(private)/auditorias/[auditId]/components/ComparisonInspector.tsx`
- Create: `apps/web/src/app/(private)/auditorias/[auditId]/comparacion/page.tsx`

**Interfaces:**
- Consumes: `JobAutoResume` (Task 8), `AuditTimeline` (muerto, reutilizado).
- Produces: `ComparisonInspector({ auditId, evidences, auditRuns, humanDecisionExtract, comparison, adjudication }: {...})`; tipos `AuditComparisonRecord`, `FinalAdjudicationRecord`, `HumanDecisionExtractRecord`, `AuditRunRecord` e `TimelineEvent` de `components/types.ts` quedan consumidos solo por la vista nueva.

- [ ] **Step 1: Crear `ComparisonInspector.tsx`**

```tsx
'use client';

import { useState } from 'react';
import { AuditTimeline } from './AuditTimeline';
import type { AuditComparisonRecord, AuditRunRecord, EvidenceRow, FinalAdjudicationRecord, HumanDecisionExtractRecord } from './types';

async function postJson(url: string, body: Record<string, unknown>) {
  const response = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    window.alert((payload as { message?: string }).message ?? 'No fue posible ejecutar la accion.');
    return;
  }
  window.location.reload();
}

export function ComparisonInspector({ auditId, evidences, auditRuns, humanDecisionExtract, comparison, adjudication }: {
  auditId: string;
  evidences: EvidenceRow[];
  auditRuns: AuditRunRecord[];
  humanDecisionExtract?: HumanDecisionExtractRecord | null;
  comparison?: AuditComparisonRecord | null;
  adjudication?: FinalAdjudicationRecord | null;
}) {
  const [busy, setBusy] = useState('');
  const humanDocument = evidences.find((evidence) => evidence.documentRole === 'HUMAN_DECISION_DOCUMENT') ?? null;
  const humanRun = auditRuns.find((run) => run.runType === 'HUMAN_DECISION');
  const baseline = auditRuns.find((run) => run.runType === 'AI_BASELINE');

  async function run(action: 'extract' | 'compare' | 'reconcile') {
    setBusy(action);
    try {
      if (action === 'extract') await postJson(`/api/audits/${auditId}/human-decision/extract`, { evidenceId: humanDocument?.id, runId: humanRun?.id });
      if (action === 'compare') await postJson(`/api/audits/${auditId}/comparison`, {});
      if (action === 'reconcile') await postJson(`/api/audits/${auditId}/reconciliation`, {});
    } finally {
      setBusy('');
    }
  }

  return <div className="space-y-4">
    <div className="rounded-lg border border-line bg-surface-2 p-4">
      <h2 className="font-semibold text-ink">Comparacion IA vs dictamen humano</h2>
      <p className="mt-2 text-xs leading-5 text-muted">La linea base IA permanece inmutable. El dictamen humano se trata como documento separado y sus afirmaciones sin respaldo quedan marcadas como mencionadas pero no verificadas.</p>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs">
        <StatusPill label="AI_BASELINE" value={baseline?.status ?? 'pendiente'} />
        <StatusPill label="HUMAN_DECISION" value={humanRun?.status ?? 'pendiente'} />
      </div>
    </div>
    <div className="rounded-lg border border-line bg-surface-2 p-4 text-xs">
      <p className="font-semibold text-ink">Dictamen humano</p>
      <p className="mt-1 text-muted">{humanDocument ? humanDocument.originalFilename : 'No se ha subido dictamen humano.'}</p>
      {humanDocument && <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy !== ''} onClick={() => void run('extract')} className="rounded-md bg-brand px-3 py-1.5 font-semibold text-white disabled:opacity-50">Extraer dictamen</button>
        <button type="button" disabled={busy !== ''} onClick={() => void run('compare')} className="rounded-md border border-line px-3 py-1.5 font-semibold text-ink disabled:opacity-50">Comparar</button>
        <button type="button" disabled={busy !== ''} onClick={() => void run('reconcile')} className="rounded-md border border-line px-3 py-1.5 font-semibold text-ink disabled:opacity-50">Reconciliar</button>
      </div>}
    </div>
    {humanDecisionExtract && <div className="rounded-lg border border-line bg-surface-2 p-4 text-xs"><p className="font-semibold text-ink">Extraccion humana</p><p className="mt-2 text-muted">Resolucion: <span className="font-semibold text-ink">{humanDecisionExtract.resolution ?? '-'}</span></p><p className="mt-2 text-muted">Claims: {humanDecisionExtract.facts.length}</p></div>}
    {comparison && <div className={`rounded-lg border p-4 text-xs ${comparison.status === 'MATCH' ? 'border-success/20 bg-success/10 text-success' : 'border-warning/20 bg-warning/10 text-warning'}`}><p className="font-semibold">{comparison.status}{comparison.discrepancyType ? ` · ${comparison.discrepancyType}` : ''}</p><p className="mt-2 leading-5 text-ink">{comparison.explanation}</p><p className="mt-2 text-muted">IA: {comparison.aiOutcome ?? '-'} · Humano: {comparison.humanOutcome ?? comparison.humanResolution ?? '-'}</p>{comparison.unverifiedHumanClaims.length > 0 && <p className="mt-2">{comparison.unverifiedHumanClaims.length} afirmacion(es) mencionadas pero no verificadas.</p>}</div>}
    {adjudication && <div className="rounded-lg border border-brand/20 bg-brand/10 p-4 text-xs text-brand"><p className="font-semibold">Adjudicacion final: {adjudication.adjudicationType}</p><p className="mt-2 text-ink">{adjudication.finalOutcome ?? adjudication.comment ?? 'Sin comentario.'}</p></div>}
  </div>;
}

function StatusPill({ label, value }: { label: string; value: string }) {
  return <div className="rounded border border-line bg-surface-1 p-2"><span className="block text-[10px] uppercase text-muted">{label}</span><span className="mt-1 block font-semibold text-ink">{value}</span></div>;
}
```

- [ ] **Step 2: Crear la ruta de comparación**

```tsx
// apps/web/src/app/(private)/auditorias/[auditId]/comparacion/page.tsx
import Link from 'next/link';
import { createAdjudicationRepository, createAuditLogRepository, createAuditRepository, createAuditRunRepository, createComparisonRepository, createDictamenDocumentRepository, createEvidenceRepository, createHumanDecisionExtractRepository, createHumanReviewRepository, createJobRepository, createReportSnapshotRepository } from '@cancelaciones/db';
import { createInsForgeServerClient } from '@/server/insforge/server';
import { getLocalDemoDetail, isLocalDemoMode } from '@/server/local-demo';
import { AuditStatusBadge } from '../components/AuditStatusBadge';
import { ComparisonInspector } from '../components/ComparisonInspector';
import { JobAutoResume } from '../components/JobAutoResume';
import { formatDateTime } from '@/lib/format';

export const dynamic = 'force-dynamic';

export default async function ComparacionPage({ params }: { params: Promise<{ auditId: string }> }) {
  const { auditId } = await params;
  const demoMode = isLocalDemoMode();
  const client = demoMode ? null : await createInsForgeServerClient();

  if (demoMode) {
    const demo = getLocalDemoDetail(auditId);
    return (
      <section className="mx-auto max-w-4xl px-6 py-8">
        <Header auditId={auditId} displayName={demo?.audit.displayName ?? null} status={demo?.selectedRun?.state ?? 'DRAFT'} createdAt={demo?.audit.createdAt ?? new Date().toISOString()} />
        <ComparisonInspector auditId={auditId} evidences={[]} auditRuns={[]} />
      </section>
    );
  }

  const audit = await createAuditRepository(client!.database).findById(auditId);
  if (!audit) return null;
  const [evidences, auditRuns, humanDecisionExtract, comparison, adjudication, timelineEvents] = await Promise.all([
    createEvidenceRepository(client!.database).listByAudit(auditId),
    createAuditRunRepository(client!.database).listByAudit(auditId),
    createHumanDecisionExtractRepository(client!.database).findLatestByAudit(auditId),
    createComparisonRepository(client!.database).findLatestByAudit(auditId),
    createAdjudicationRepository(client!.database).findLatestByAudit(auditId),
    createAuditLogRepository(client!.database).listByAudit(auditId),
  ]);

  return (
    <section className="mx-auto max-w-4xl px-6 py-8">
      <JobAutoResume auditId={auditId} enabled={!demoMode} />
      <Header auditId={auditId} displayName={audit.displayName} status={audit.status} createdAt={audit.createdAt} />
      <ComparisonInspector
        auditId={auditId}
        evidences={evidences.map((evidence) => ({ id: evidence.id, auditId: evidence.auditId, originalFilename: evidence.originalFilename, detectedMimeType: evidence.detectedMimeType, sizeBytes: evidence.sizeBytes, sha256: evidence.sha256, status: evidence.status, documentRole: evidence.documentRole }))}
        auditRuns={auditRuns}
        humanDecisionExtract={humanDecisionExtract}
        comparison={comparison}
        adjudication={adjudication}
      />
      <div className="mt-6"><AuditTimeline events={timelineEvents.map((event) => ({ id: event.id, eventType: event.eventType, actorId: event.actorId, createdAt: event.occurredAt, metadata: event.metadata }))} /></div>
    </section>
  );
}

function Header({ auditId, displayName, status, createdAt }: { auditId: string; displayName: string | null; status: string; createdAt: string }) {
  return <header className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-1 px-4 py-3">
    <div>
      <Link href={`/auditorias/${auditId}`} className="text-xs font-semibold text-brand hover:underline">← Volver al workspace</Link>
      <h1 className="mt-1 text-lg font-semibold text-ink">{displayName ?? 'Expediente de auditoria'}</h1>
      <p className="mt-0.5 font-mono text-[10px] text-muted">{formatDateTime(createdAt)}</p>
    </div>
    <AuditStatusBadge status={status} />
  </header>;
}
```

- [ ] **Step 3: Verificar y commitear**

Run: `pnpm --filter @cancelaciones/web typecheck && pnpm --filter @cancelaciones/web lint`
Expected: PASS.

```bash
git add "apps/web/src/app/(private)/auditorias/[auditId]/components/ComparisonInspector.tsx" "apps/web/src/app/(private)/auditorias/[auditId]/comparacion/page.tsx"
git commit -m "feat(audit): mover comparacion IA vs humano a su propia vista

La pestana comparacion desaparecio del panel derecho. Sus tres endpoints
(/human-decision/extract, /comparison, /reconciliation) siguen accesibles y el
timeline vuelve con AuditTimeline, que existia sin usarse."
```

---

## Task 13: Borrar el código muerto restante

**Files:**
- Delete: `apps/web/src/app/(private)/auditorias/[auditId]/HumanFactReview.tsx`
- Delete: `apps/web/src/app/(private)/auditorias/[auditId]/PolicyEvaluationPanel.tsx`
- Delete: `apps/web/src/app/(private)/auditorias/[auditId]/components/MachineDecisionCard.tsx`
- Delete: `apps/web/src/app/(private)/auditorias/[auditId]/components/ReportPreviewCard.tsx`
- Delete: `apps/web/src/app/(private)/auditorias/[auditId]/components/MissingItemsPanel.tsx`

**Interfaces:**
- Consumes: nada.
- Produces: nada. Los cinco archivos estaban definidos y nunca importados; su lógica vive ahora en `FactReviewPanel`, `DictamenInspector` y `RulesInspector`.

- [ ] **Step 1: Confirmar que no hay referencias**

Run:

```bash
pnpm --filter @cancelaciones/web exec grep -rn "HumanFactReview\|PolicyEvaluationPanel\|MachineDecisionCard\|ReportPreviewCard\|MissingItemsPanel" src --include=*.ts --include=*.tsx
```

Expected: cero coincidencias fuera de los propios archivos a borrar. Si aparece alguna, **para**: significa que un archivo muerto fue importado en algún punto y el borrado rompería el build.

- [ ] **Step 2: Borrar**

```bash
git rm "apps/web/src/app/(private)/auditorias/[auditId]/HumanFactReview.tsx" "apps/web/src/app/(private)/auditorias/[auditId]/PolicyEvaluationPanel.tsx" "apps/web/src/app/(private)/auditorias/[auditId]/components/MachineDecisionCard.tsx" "apps/web/src/app/(private)/auditorias/[auditId]/components/ReportPreviewCard.tsx" "apps/web/src/app/(private)/auditorias/[auditId]/components/MissingItemsPanel.tsx"
```

- [ ] **Step 3: Verificar build completo**

Run: `pnpm --filter @cancelaciones/web typecheck && pnpm --filter @cancelaciones/web lint && pnpm --filter @cancelaciones/web test && pnpm --filter @cancelaciones/web build`
Expected: PASS en los cuatro.

- [ ] **Step 4: Commit**

```bash
git commit -m "chore: eliminar cinco componentes muertos

PolicyEvaluationPanel, MachineDecisionCard, ReportPreviewCard y
MissingItemsPanel duplicaban DictamenInspector, RulesInspector y
DictamenWorkflow. HumanFactReview quedo absorbido por FactReviewPanel, que ademas
envia correctedValue. Los cinco estaban definidos y nunca importados."
```

---

## Task 14: Verificación de extremo a extremo

**Files:**
- Test: `apps/web/src/server/jobs/audit-queue.e2e.test.ts` (extender, no crear archivo nuevo)
- Modify: `docs/architecture/jobs.md` (documentar la regla de frescura)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: cobertura e2e de la regla de frescura y una nota en la documentación de arquitectura.

- [ ] **Step 1: Leer el test e2e existente**

Run: `pnpm --filter @cancelaciones/web test:audit:e2e`
Expected: PASS antes de tocarlo. Si falla por falta de credenciales, anotar y seguir: el test e2e requiere InsForge real.

- [ ] **Step 2: Añadir el caso de re-evaluación**

Añadir a `apps/web/src/server/jobs/audit-queue.e2e.test.ts` un caso que: cree una auditoría sintética con una evidencia, procese, espere el dictamen, registre una revisión `INVALID` sobre un fact, vuelva a llamar `EXTRACT_FACTS` y compruebe que existe un `engine_run` nuevo con `facts_fingerprint` distinto **y** que el `AI_BASELINE` anterior sigue en la tabla. Usar el mismo helper de creación de auditoría sintética que ya use el archivo.

- [ ] **Step 3: Correr y verificar**

Run: `pnpm --filter @cancelaciones/web test:audit:e2e`
Expected: PASS, con dos `engine_runs` y dos `AI_BASELINE` para la misma auditoría.

- [ ] **Step 4: Documentar la regla de frescura**

Añadir a `docs/architecture/jobs.md` una sección titled `## Frescura de Fact Runs` que describa: la comparación por conjunto de artefactos, las tres decisiones de `selectFactRunForEvaluation`, y por qué `AUDIT_EVALUATION` usa una clave derivada del contenido (con la referencia a `migrations/20260921225156:126-127`).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/server/jobs/audit-queue.e2e.test.ts docs/architecture/jobs.md
git commit -m "test(jobs): cobertura e2e de re-evaluacion por revision humana

Verifica que un recalculo crea un engine_run nuevo sin sobrescribir la linea
base anterior, y documenta la regla de frescura en la arquitectura."
```

---

## Self-Review

**1. Cobertura del spec.** Cada sección del spec tiene tarea: migración de derivación → Task 1; `selectFactRunForEvaluation` y comparación por conjuntos → Task 2; fingerprint de entrada → Task 3; `EXTRACT_FACTS` *ensure-current* → Task 4; `HUMAN_REVIEW_STALE` → Task 5; validación de `correctedValue` → Task 6; `drainQueue` → Task 7; `JobAutoResume` y `EvidenceUploader` → Task 8; `FactReviewPanel` → Task 9; tres pestañas y `+ Agregar` → Task 10; `EvidenceSelector` y documentos por `generatedAt` → Task 11; vista de comparación → Task 12; código muerto → Task 13; e2e → Task 14. Accesibilidad (tablist, `aria-live`, `role="note"`, `aria-label`) queda en Tasks 9, 10 y 11.

**2. Placeholders.** Ninguno. Cada paso tiene el código o el comando exacto.

**3. Consistencia de tipos.** `ArtifactSet` se define en Task 2 y se consume en Tasks 3, 4 y 8 con la misma forma. `FactRunSelection` la produce Task 2 y `createFactRunForSelection` la consume en Task 4 con `Extract<FactRunSelection, { action: 'CREATE' }>`. `FactReviewInput` se define en Task 3 y lo consumen `readLatestFactReviews` (Task 4) y `evaluationInputFingerprint`. `FactRow`/`FactReviewRow` se declaran en `types.ts` (Task 10) y `page.tsx` los mapea; `FactReviewPanel` recibe `FactRowView`/`FactReviewView`, cuya forma es compatible campo a campo. `canRecalculate` devuelve `{allowed, reason}` y `FactReviewPanel` consume `gate.allowed` y `gate.reason`.

**4. Review Focus.** Los cinco puntos tienen test: revisiones múltiples → `latestReviewPerFact` (Task 3, Step 3); `correctedValue` null vs undefined → `evaluationInputFingerprint` (Task 3, Step 3); orden de artifacts → `parseArtifactSet` + `decideFactRun` (Task 2, Steps 1 y 5); evidencia re-subida → `artifactSetsEqual` distingue mismo `sha256` con distinto `id` (Task 2) y `EvidenceUploader` lo dice en su mensaje final (Task 8, Step 2); botón por teclado con dictamen aprobado → `canRecalculate` + `role="note"` con texto renderizado (Task 9, Steps 1 y 5).

**Desviación declarada respecto al spec.** El spec pedía tests de componentes. El repositorio no tiene `jsdom` ni `@testing-library/react` y `vitest.config.ts` fija `environment: 'node'`; los 22 archivos de test existentes prueban lógica pura. En vez de agregar dependencias, este plan extrae la decisión a módulos puros (`job-queue`, `fact-review-state`, `artifact-set`, `run-selection`, `evaluation-job`, `corrected-value`) y los prueba, dejando los componentes como conchas finas. La cobertura se移到 la lógica, que es donde puede estar mal.
