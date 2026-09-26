# Bloque 1 — Corrección de GRANT RLS y fundamento del Decision Trace

> **Para trabajadores agénticos:** SUB-SKILL OBLIGATORIA: usa `superpowers:subagent-driven-development` (recomendado) o `superpowers:executing-plans` para implementar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`) para seguimiento.

**Objetivo:** Corregir el bug de privilegios RLS que está fallando en producción, y establecer la tabla `decision_traces` más el contrato de tipos del trace como fundamento verificable.

**Arquitectura:** Migración SQL aditiva y no destructiva que otorga los `GRANT` que las políticas RLS ya permiten pero que Postgres no estaba aplicando. Ninguna política se modifica: solo se alinean los privilegios SQL con la política que ya existía. Los tipos del trace se definen en el paquete de dominio para que sirvan como contrato compartido entre motor, persistencia, API y UI.

**Stack:** PostgreSQL (InsForge), TypeScript estricto, pnpm, vitest.

## Restricciones globales

- La fuente normativa `GDM_GAM_PRD_MLG_003` es inmutable. Ninguna tarea altera reglas, criterios ni el motor.
- Ninguna migración elimina o reescribe migraciones ya aplicadas. Solo se añaden.
- Prohibido `TRUNCATE` masivo. Ninguna tarea destructive sobre datos.
- `NO_PII_IN_GIT`: no se commitean evidencias reales ni datos con PII.
- Los fixtures sintéticos se commitean; los reales no.
- Prohibido loguear secretos, tokens o API keys.
- Cada tarea termina con commit. Nada se commitea junto a un test rojo.
- Los scripts de limpieza son `dry-run` por defecto y exigen `--apply` explícito.
- Rutas de API: validación de entrada en servidor, sin stack traces en producción.

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `migrations/20260926090000_fix-rls-grants-engine-fact.sql` | Otorga los `GRANT` faltantes en las 4 tablas. Aditiva. |
| `scripts/verify-rls-grants.sql` | Verificación read-only de paridad política/privilegio. |
| `packages/domain/src/decision-trace.ts` | Tipos del contrato del trace. Sin lógica. |
| `packages/domain/src/index.ts` | Re-exporta el contrato. |

---

### Tarea 1: Migración correctiva de GRANT RLS

**Archivos:**
- Crear: `migrations/20260926090000_fix-rls-grants-engine-fact.sql`
- Crear: `scripts/verify-rls-grants.sql`

**Interfaces:**
- Consume: políticas RLS existentes en `fact_extraction_runs`, `engine_runs`, `engine_rule_results`, `policy_source_registry`.
- Produce: las 4 tablas con privilegios que coinciden con sus políticas.

**Contexto verificado en producción.** Hay 9 políticas para el rol `authenticated` en 4 tablas, pero los privilegios SQL no las respaldan:

| Tabla | Políticas `cmd` | `GRANT` actual | Falta |
|---|---|---|---|
| `engine_runs` | `INSERT`, `SELECT` | `SELECT` | `INSERT` |
| `engine_rule_results` | `INSERT`, `SELECT` | `SELECT` | `INSERT` |
| `fact_extraction_runs` | `INSERT`, `SELECT`, `UPDATE` | `INSERT, SELECT` | `UPDATE` |
| `policy_source_registry` | `INSERT`, `SELECT` | `SELECT` | `INSERT` |

Sin el privilegio, Postgres responde `permission denied for table ...` antes de evaluar RLS, así que la política nunca llega a aplicarse. Evidencia en producción: `permission denied for table fact_extraction_runs`.

- [ ] **Paso 1: Escribir el script de verificación que falla hoy**

Este script debe reportar divergencias entre política y privilegio. Lo escribes primero para confirmar que detecta el bug antes de arreglarlo.

Crea `scripts/verify-rls-grants.sql`:

```sql
-- Verificación read-only de paridad entre políticas RLS y privilegios SQL.
-- No modifica nada. Sale con código 1 si hay divergencias.
WITH policy_cmds AS (
  SELECT tablename, cmd
  FROM pg_policies
  WHERE schemaname = 'public'
    AND roles @> ARRAY['authenticated']::name[]
    AND tablename IN (
      'engine_runs',
      'engine_rule_results',
      'fact_extraction_runs',
      'policy_source_registry'
    )
),
granted AS (
  SELECT table_name, privilege_type
  FROM information_schema.role_table_grants
  WHERE table_schema = 'public'
    AND grantee = 'authenticated'
    AND table_name IN (
      'engine_runs',
      'engine_rule_results',
      'fact_extraction_runs',
      'policy_source_registry'
    )
)
SELECT
  p.tablename                AS table_name,
  p.cmd                      AS policy_command,
  CASE WHEN g.privilege_type IS NULL THEN 'MISSING' ELSE 'OK' END AS privilege_state
FROM policy_cmds p
LEFT JOIN granted g
  ON g.table_name = p.tablename
 AND upper(g.privilege_type) = upper(p.cmd)
ORDER BY p.tablename, p.cmd;
```

- [ ] **Paso 2: Ejecutar la verificación y confirmar que falla**

```bash
cd /tmp/opencode/insforge-probe
npx @insforge/cli db query "$(cat /home/idk/Escritorio/cancelaciones-ai/scripts/verify-rls-grants.sql)" 2>&1 | tail -20
```

Esperado: 4 filas con `privilege_state = MISSING` (`engine_runs/INSERT`, `engine_rule_results/INSERT`, `fact_extraction_runs/UPDATE`, `policy_source_registry/INSERT`).

Si no aparecen las 4, **para**. La premisa del plan es incorrecta y hay que reevaluar.

- [ ] **Paso 3: Escribir la migración correctiva**

Crea `migrations/20260926090000_fix-rls-grants-engine-fact.sql`. Solo otorga privilegios. No toca políticas, no toca datos, no elimina nada.

```sql
-- Corrige paridad entre políticas RLS y privilegios SQL.
-- Contexto: las políticas ya existían para el rol `authenticated`, pero el
-- privilegio SQL correspondiente no estaba otorgado. Postgres responde
-- `permission denied for table ...` ANTES de evaluar RLS, por lo que las
-- políticas nunca se aplicaban. Evidencia: postgres.logs ->
-- "permission denied for table fact_extraction_runs" (2026-09-26T00:09:51Z).
--
-- Aditive e idempotente: GRANT es idempotente por definición.
-- No se modifica ninguna política.

-- engine_runs: política INSERT existente, privilegio SELECT únicamente.
GRANT INSERT ON public.engine_runs TO authenticated;

-- engine_rule_results: política INSERT existente, privilegio SELECT únicamente.
GRANT INSERT ON public.engine_rule_results TO authenticated;

-- fact_extraction_runs: política UPDATE existente (congelamiento del run).
GRANT UPDATE ON public.fact_extraction_runs TO authenticated;

-- policy_source_registry: política INSERT existente (registro de fuentes).
GRANT INSERT ON public.policy_source_registry TO authenticated;
```

- [ ] **Paso 4: Aplicar la migración en el entorno de desarrollo**

```bash
cd /tmp/opencode/insforge-probe
npx @insforge/cli db apply /home/idk/Escritorio/cancelaciones-ai/migrations/20260926090000_fix-rls-grants-engine-fact.sql
```

Esperado: la operación reporta éxito. Si reporta error de sintaxis o de privilegio, **para** y lee el error completo antes de continuar.

- [ ] **Paso 5: Re-ejecutar la verificación y confirmar que ya no hay MISSING**

```bash
cd /tmp/opencode/insforge-probe
npx @insforge/cli db query "$(cat /home/idk/Escritorio/cancelaciones-ai/scripts/verify-rls-grants.sql)" 2>&1 | tail -20
```

Esperado: 9 filas, todas con `privilege_state = OK`.

- [ ] **Paso 6: Confirmar que la migración quedó registrada como aplicada**

```bash
cd /tmp/opencode/insforge-probe
npx @insforge/cli db query "SELECT version FROM supabase_migrations.schema_migrations ORDER BY version DESC LIMIT 5;" 2>&1 | tail -15
```

Si la tabla de migraciones tiene otro nombre, lista primero las tablas para encontrar el registro real. Esperado: aparece `20260926090000` en el historial.

- [ ] **Paso 7: Commit**

```bash
cd /home/idk/Escritorio/cancelaciones-ai
git add migrations/20260926090000_fix-rls-grants-engine-fact.sql scripts/verify-rls-grants.sql
git commit -m "fix(db): alinear GRANT con políticas RLS en tablas de engine y fact runs"
```

---

### Tarea 2: Tipos del contrato Decision Trace

**Archivos:**
- Crear: `packages/domain/src/decision-trace.ts`
- Modificar: `packages/domain/src/index.ts`

**Interfaces:**
- Consume: `Outcome` y `OutcomeStatus` de `packages/policy-engine` (fuente de verdad normativa).
- Produce: `DecisionTrace`, `NormativeBlock`, `EstimateBlock`, `ConfidenceLevel`. El Bloque 3 los consume para construir el artefacto, y el Bloque 2 para servirlo.

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

  it('admite normativo DETERMINATE con estimate null', () => {
    const trace: DecisionTrace = {
      ...baseAudit,
      policy: { code: 'GDM_GAM_PRD_MLG_003', version: '5', rulesFingerprint: 'rf', factsFingerprint: 'ff' },
      normative: {
        status: 'DETERMINATE',
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
 * Cuando `normative.status === 'DETERMINATE'`, `estimate` DEBE ser `null`.
 * Esa es la invariante que impide que una estimación se lea como dictamen.
 */
import type { Outcome, OutcomeStatus } from '@cancelaciones/policy-engine';

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
