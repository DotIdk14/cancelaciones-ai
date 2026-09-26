### Tarea 2: Tipos del contrato Decision Trace

**Archivos:**
- Crear: `packages/domain/src/decision-trace.ts`
- Modificar: `packages/domain/src/index.ts`

**Interfaces:**
- Consume: `Outcome` y `OutcomeStatus`, que se **mueven** a este paquete (ver nota de ciclo abajo).
- Produce: `DecisionTrace`, `NormativeBlock`, `EstimateBlock`, `ConfidenceLevel`. El Bloque 3 los consume para construir el artefacto, y el Bloque 2 para servirlo.

**Ciclo de dependencias (descubierto durante la ejecución).** El plan original hacía que `domain` importara de `policy-engine`. Eso crearía un ciclo: `policy-engine/src/index.ts:5` ya importa `stableFingerprint` de `@cancelaciones/domain`, y `domain` es hoy un nodo hoja sin dependencias. La dirección correcta es la inversa: **`Outcome` y `OutcomeStatus` se mueven a `domain`**, que es donde pertenece el vocabulario normativo, y `policy-engine` los re-exporta. Así `policy-engine → domain` se mantiene, ambos paquetes siguen hablando los mismos tipos y no hay ciclo.

**Corrección obligatoria: `DETERMINATE` no existe.** El enum real es `DETERMINED`. Usar el literal correcto; `DETERMINATE` produce `TS2322` en typecheck.

**Contexto.** El trace tiene dos bloques deliberadamente separados. `normative` nunca se relaja; `estimate` nunca se disfraza de dictamen. Cuando el caso cierra, `estimate` es `null` y no hay contradicción posible. Esta separación es requisito de diseño, no estilo.

- [ ] **Paso 1: Escribir el test de forma del contrato**

Crea `packages/domain/src/decision-trace.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { DecisionTrace } from './decision-trace';

const baseAudit = { auditId: 'a-1', generatedAt: '2026-09-26T00:00:00.000Z' };

describe('DecisionTrace', () => {
  it('permite normativo INDETERMINATE con resolución estimada presente', () => {
    const trace: DecisionTrace = {
      ...baseAudit,
      policy: {
        code: 'GDM_GAM_PRD_MLG_003',
        version: '5',
        rulesFingerprint: 'rf',
        factsFingerprint: 'ff',
      },
      normative: {
        status: 'INDETERMINATE',
        resolution: null,
        decisiveRules: ['R-11'],
        blockingRules: [{ ruleId: 'R-11', missingFacts: ['classroom.hasGrades'] }],
        conflicts: [],
        softwareCoverageGaps: [],
      },
      estimate: {
        resolution: 'CANCELACION_VENTA',
        alternatives: { CANCELACION_VENTA: 0.72, RETENCION: 0.28 },
        confidence: 0.72,
        confidenceLevel: 'MEDIA',
        basis: {
          ruleSupport: 0.8,
          graphConsistency: 1,
          sourceCoverage: 0.5,
          factConfidence: 0.71,
          evidenceCoverage: 0.6,
        },
        rationale: ['ruleSupport=0.80 (peso 0.35): …'],
        missingEvidence: ['evidencia de calificaciones en aula virtual'],
        humanReview: 'RECOMMENDED',
      },
      explanation: 'Falta evidencia de calificaciones.',
    };
    expect(trace.normative.status).toBe('INDETERMINATE');
    expect(trace.estimate?.resolution).toBe('CANCELACION_VENTA');
  });

  it('admite normativo DETERMINED con estimate null', () => {
    const trace: DecisionTrace = {
      ...baseAudit,
      policy: { code: 'GDM_GAM_PRD_MLG_003', version: '5', rulesFingerprint: 'rf', factsFingerprint: 'ff' },
      normative: {
        status: 'DETERMINED',
        resolution: 'CANCELACION_VENTA',
        decisiveRules: ['R-04'],
        blockingRules: [],
        conflicts: [],
        softwareCoverageGaps: [],
      },
      estimate: null,
      explanation: 'Cerrado.',
    };
    expect(trace.normative.resolution).toBe('CANCELACION_VENTA');
    expect(trace.estimate).toBeNull();
  });
});
```

- [ ] **Paso 2: Ejecutar el test y verificar que falla**

```bash
cd /home/idk/Escritorio/cancelaciones-ai/packages/domain
pnpm vitest run src/decision-trace.test.ts 2>&1 | tail -20
```

Esperado: FAIL con error de módulo `Cannot find module './decision-trace'`.

- [ ] **Paso 3: Escribir los tipos**

Crea `packages/domain/src/decision-trace.ts`:

```ts
/**
 * Contrato del Decision Trace.
 *
 * Separación deliberada en dos bloques:
 *  - `normative` es la autoridad. Nunca se relaja para forzar un cierre.
 *  - `estimate` acompaña al resultado probable. Nunca se disfraza de dictamen.
 *
 * Cuando `normative.status === 'DETERMINED'`, `estimate` DEBE ser `null`.
 * Esa es la invariante que impide que una estimación se lea como dictamen.
 */
import type { Outcome, OutcomeStatus } from './policy-outcome';

export type ConfidenceLevel = 'ALTA' | 'MEDIA' | 'BAJA';
export type HumanReviewFlag = 'REQUIRED' | 'RECOMMENDED' | 'NOT_REQUIRED';

export interface PolicyBlock {
  code: string;
  version: string;
  rulesFingerprint: string;
  factsFingerprint: string;
}

export interface BlockingRuleTrace {
  ruleId: string;
  missingFacts: string[];
}

export interface NormativeBlock {
  status: OutcomeStatus;
  resolution: Outcome | null;
  decisiveRules: string[];
  blockingRules: BlockingRuleTrace[];
  conflicts: unknown[];
  softwareCoverageGaps: string[];
}

export interface ConfidenceBasis {
  ruleSupport: number;
  graphConsistency: number;
  sourceCoverage: number;
  factConfidence: number;
  evidenceCoverage: number;
}

export interface EstimateBlock {
  resolution: Outcome;
  /** Distribución sobre los outcomes reales del motor. Suma 1. */
  alternatives: Partial<Record<Outcome, number>>;
  confidence: number;
  confidenceLevel: ConfidenceLevel;
  basis: ConfidenceBasis;
  rationale: string[];
  missingEvidence: string[];
  humanReview: HumanReviewFlag;
}

export interface DecisionTrace {
  auditId: string;
  generatedAt: string;
  policy: PolicyBlock;
  normative: NormativeBlock;
  estimate: EstimateBlock | null;
  explanation: string;
}
```

- [ ] **Paso 4: Re-exportar desde el índice del dominio**

Abre `packages/domain/src/index.ts` y añade el re-export al final del bloque de exports existentes:

```ts
export * from './decision-trace';
```

- [ ] **Paso 5: Ejecutar el test y verificar que pasa**

```bash
cd /home/idk/Escritorio/cancelaciones-ai/packages/domain
pnpm vitest run src/decision-trace.test.ts 2>&1 | tail -20
```

Esperado: PASS, 2 tests.

- [ ] **Paso 6: Verificar typecheck del paquete**

```bash
cd /home/idk/Escritorio/cancelaciones-ai
pnpm --filter @cancelaciones/domain typecheck 2>&1 | tail -20
```

Esperado: sin errores. Si `packages/domain` no declara script `typecheck`, usa `pnpm -r typecheck` y revisa que el paquete no introduced errores.

- [ ] **Paso 7: Ejecutar toda la suite del dominio**

```bash
cd /home/idk/Escritorio/cancelaciones-ai
pnpm vitest run packages/domain 2>&1 | tail -25
```

Esperado: todos en verde.

- [ ] **Paso 8: Commit**

```bash
cd /home/idk/Escritorio/cancelaciones-ai
git add packages/domain/src/decision-trace.ts packages/domain/src/decision-trace.test.ts packages/domain/src/index.ts
git commit -m "feat(domain): contrato de tipos del Decision Trace con separación normativa/estimada"
```

---

## Criterio de cierre del Bloque 1

- [ ] `scripts/verify-rls-grants.sql` reporta 9 filas, todas `OK`.
- [ ] La migración está registrada en el historial y es idempotente.
- [ ] `pnpm -r test` en verde.
- [ ] `pnpm -r typecheck` sin errores.
- [ ] El job `FACT_EXTRACTION` que falló con `AUTH_ERROR` ya no reproduce `permission denied` al congelar el run.

**Nota de alcance:** este bloque NO incluye el endpoint de descarga ni el botón rojo. Eso es el Bloque 2. Este bloque solo establishes el fix de producción y el contrato de tipos, para que el artefacto tenga una forma verificada antes de construirlo.
