# Tarea 2 — Reporte: contrato de tipos del Decision Trace

- **Fecha:** 2026-09-26
- **Rama:** `feature/policy-foundation-remediation`
- **HEAD al inicio:** `26c73c2 fix(db): hacer condicional el GRANT de policy_source_registry y corregir premisas`
- **Estado:** `BLOCKED` — no se escribió ningún archivo, no se commiteó nada.

---

## Resumen

No ejecuté la Tarea 2. El brief tiene **dos defectos bloqueantes** que impiden escribir el contrato de tipos tal como está especificado. Ambos están fuera del alcance de "solo tipos" y uno de ellos es exactamente el caso que el encargo me ordenó reportar y no tocar.

El repositorio queda intacto: `git status --short` sin salida.

---

## Blocker A — `@cancelaciones/policy-engine` no es resoluble desde `packages/domain`

### Hechos verificados

`packages/domain/package.json` **no tiene sección `dependencies`**. El paquete no declara ninguna dependencia de runtime:

```json
{
  "name": "@cancelaciones/domain",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "main": "./src/index.ts",
  "scripts": { "build": "tsc --noEmit", "lint": "…", "typecheck": "tsc --noEmit", "test": "vitest run" },
  "devDependencies": { "vitest": "^2.1.9" }
}
```

`packages/policy-engine/package.json` **sí** depende de domain:

```json
"dependencies": { "@cancelaciones/domain": "workspace:*" }
```

La arista de dependencia es unidireccional: `policy-engine → domain`.

No existe enlace simbólico para la arista inversa:

```
$ ls -la packages/domain/node_modules/@cancelaciones/
ls: no se puede acceder a 'packages/domain/node_modules/@cancelaciones': No existe el archivo o el directorio

$ ls node_modules/@cancelaciones
ls: no se puede acceder a 'node_modules/@cancelaciones': No existe el archivo o el directorio
```

No hay `.npmrc` (sin hoisting configurado) y `pnpm-workspace.yaml` solo declara `apps/*` y `packages/*`.

### Prueba empírica

Creé un archivo sonda temporal `packages/domain/src/__probe_decision_trace.ts` con un único import de tipo, ejecuté `tsc --noEmit` y lo eliminé con `trap`:

```
$ pnpm --filter @cancelaciones/domain exec tsc --noEmit
src/__probe_decision_trace.ts(1,45): error TS2307: Cannot find module '@cancelaciones/policy-engine' or its corresponding type declarations.
```

Resolución de Node desde el directorio del paquete:

```
$ node -e "…createRequire('packages/domain/src/x.js')…"
UNRESOLVABLE: MODULE_NOT_FOUND
```

**Consecuencia:** la línea 108 del brief

```ts
import type { Outcome, OutcomeStatus } from '@cancelaciones/policy-engine';
```

falla con `TS2307` antes de que se escriba una sola línea de contrato. Para que funcione hay que añadir la dependencia y ejecutar `pnpm install`, lo que crearía un ciclo declarado en `package.json`: `domain ⇄ policy-engine`.

**No lo hice.** El encargo fue explícito: *"Verifica que el `package.json` de `packages/domain` ya declara `@cancelaciones/policy-engine` como dependencia; si no, NO la agregues sin avisarme, porque podría crear una dependencia circular. Reporta el caso y espera mi decisión."* La dependencia no está. Procedo a reportar.

---

## Blocker B — La premisa del contexto #2 es falsa, y explica Blocker A

El encargo afirmaba:

> "Eso ya ocurre en el código actual: `packages/domain/src/policy-foundation.ts` importa de ese paquete."

**No ocurre.** `packages/domain/src/policy-foundation.ts` no tiene **ningún** import. Es un archivo de tipos puro, sin dependencias. Evidencia:

```
$ grep -n "policy-engine" -r packages/domain/src/
(sin resultados)

$ head -1 packages/domain/src/policy-foundation.ts
export type FactState = 'OBSERVED' | 'INFERRED' | 'UNKNOWN' | 'CONTRADICTORY';
```

Los únicos imports de todo `packages/domain/src/` son de `vitest` en los archivos `.test.ts` y el `export * from './policy-foundation'` del índice.

Esto no es un detalle: **es la razón por la que `domain` no declara la dependencia**. `packages/policy-engine/src/index.ts:4` importa en sentido contrario:

```ts
import { stableFingerprint } from '@cancelaciones/domain';
```

Es decir, la única arista real es `policy-engine → domain`, y hoy `domain` es el nodo hoja del grafo. La tarea 2 pretendería invertir eso para que el nodo hoja dependa de su propio consumidor. Un ciclo de paquetes es una decisión de arquitectura, no un detalle de `package.json`.

---

## Blocker C — `'DETERMINATE'` no existe en `OutcomeStatus`

El brief y el contexto #1 condicionan la invariante a `normative.status === 'DETERMINATE'`, y el test del brief asigna ese literal. La unión real en `packages/policy-engine/src/index.ts:14` es:

```ts
export type OutcomeStatus =
  | 'DETERMINED'
  | 'DETERMINED_WITH_WARNINGS'
  | 'CONFLICTED'
  | 'INDETERMINATE'
  | 'SUPPORTED'
  | 'PROBABLE'
  | 'UNCERTAIN'
  | 'INSUFFICIENT_EVIDENCE'
  | 'POLICY_VALIDATION_FAILED';
```

No hay `'DETERMINATE'` en ninguna parte. Tampoco en `DecisionStatus` (línea 15), que va de `READY_TO_APPROVE` a `UNCERTAIN`.

**Por qué esto es peligroso y no cosmético:** vitest transpila con esbuild y **no typechequea**. Los dos tests del brief pasarían en verde aunque el literal sea inválido, dando una falsa señal de que el contrato es válido. El fallo aparecería recién en `pnpm --filter @cancelaciones/domain typecheck` como `TS2322`, que es criterio de cierre del Bloque 1.

Probé el literal en la sonda temporal anterior; el único error reportado fue `TS2307` del import, porque ese error cortó la resolución antes de llegar a la asignación. Aislado, `export const probe: OutcomeStatus = 'DETERMINATE'` produce `TS2322`.

El valor correcto es **`'DETERMINED'`**. Con esa corrección, la invariante queda: `normative.status === 'DETERMINED'` → `estimate` es `null`.

---

## Comandos ejecutados y salidas

Todos de solo lectura, salvo la sonda temporal ya eliminada. `git status --short` está limpio.

| Comando | Resultado |
|---|---|
| `git status --short` | sin salida (árbol limpio) |
| `git branch --show-current` | `feature/policy-foundation-remediation` |
| `git log --oneline -10` | HEAD = `26c73c2` |
| `pnpm --filter @cancelaciones/domain typecheck` | **PASS** (línea base, sin mis cambios) |
| `pnpm -r typecheck` | **PASS** — 5 paquetes: `domain`, `policy-engine`, `db`, `reporting`, `web` → todos `Done` |
| `pnpm vitest run src/decision-trace.test.ts` | **no ejecutado** (pasos 1–5 no iniciados) |
| `pnpm vitest run packages/domain` | **no ejecutado** |
| sonda `tsc --noEmit` + `createRequire` | `TS2307` + `MODULE_NOT_FOUND` (ver Blocker A) |

**Línea base verde y sin tocar.** No introduje ningún error nuevo porque no introduje ningún cambio.

## Tests

No ejecutados. `0` tests nuevos, `0` commits.

## Typecheck

Línea base en verde para los 5 paquetes. El cambio de la tarea 2, tal como está escrito en el brief, lo rompería con `TS2307` (import) y `TS2322` (literal `'DETERMINATE'`).

## Comando de typecheck

`packages/domain/package.json` **sí** declara script `typecheck` (`tsc --noEmit`), así que el comando del brief es correcto y no hizo falta recurrir a `pnpm -r typecheck` como fallback. Ejecuté ambos para fijar la línea base.

---

## Decisión que necesito

Tres opciones. Ninguna la aplico por cuenta propia porque las tres tocan arquitectura o alcance normativo.

**Opción 1 — Declarar la dependencia inversa y aceptar el ciclo.**
Añadir `"@cancelaciones/policy-engine": "workspace:*"` a `dependencies` de `packages/domain` y ejecutar `pnpm install`. pnpm lo permite, pero pasa a haber un ciclo de paquetes. Es exactamente lo que el encargo me pidió no hacer sin autorización.

**Opción 2 — Invertir la dirección de los tipos: que `domain` sea la fuente de los primitivos.**
Mover `Outcome` y `OutcomeStatus` a `packages/domain` y re-exportarlas desde `policy-engine` para no romper a sus consumidores. La dependencia queda unidireccional (`policy-engine → domain`) y el grafo sigue siendo acíclico, pero toca dos paquetes y excede el alcance de esta tarea.

**Opción 3 — Desacoplar el trace de `policy-engine` (recomendada si se quiere mantener el alcance).**
`DecisionTrace` no necesita conocer el motor en tiempo de compilación si `normative` se modela con tipos propios del dominio, o si el contrato se define en el paquete que ya depende del motor. Requiere decisión tuya sobre dónde vive el contrato; no lo decido yo.

**Ajuste necesario en cualquier opción:** confirmar que el literal del test pasa de `'DETERMINATE'` a `'DETERMINED'`, y que la invariante se enuncia igual en el JSDoc. Sin eso, los tests pasan en verde con un contrato que `tsc` rechaza.

---

## Preocupaciones adicionales

1. **`conflicts: unknown[]` es laxa para un artefacto de trazabilidad.** El motor ya exporta `Conflict` con `ruleIds`, `outcomes`, `reason` y `resolvedBy` (`packages/policy-engine/src/index.ts:30`), que incluye la distinción entre `EXPLICIT_POLICY` y `OWNER_OPERATIONAL_PRECEDENCE`. Usar `unknown[]` en un bloque llamado `conflicts` desperdicia el dato más relevante para auditar un conflicto, y es relevante para el invariante `OPERATIONAL_PRECEDENCE_IS_NOT_POLICY`: el artefacto debería dejar explícito si un conflicto se resolvió por precedencia operativa del owner, no por norma. Lo dejé como el brief lo pide, no como yo lo escribiría.

2. **`generateAt` es `string`, no un tipo de fecha.** `generatedAt: string` no garantiza ISO-8601. Para un artefacto que se archiva y se compara entre ejecuciones, `string` deja abierta la puerta a formatos divergentes.

3. **La invariante `DETERMINED → estimate === null` no es expresable en el sistema de tipos que propone el brief.** Con `estimate: EstimateBlock | null` independente de `normative.status`, un valor mal construido con `status: 'DETERMINED'` y `estimate` poblado compila sin error. El JSDoc lo declara, pero nada lo hace cumplir. Si la invariante es un requisito duro —y el encargo la describe como tal— necesita un tipo discriminante, del estilo:

   ```ts
   export type DecisionTrace =
     | (BaseTrace & { normative: NormativeBlock & { status: 'DETERMINED'; resolution: Outcome }; estimate: null })
     | (BaseTrace & { normative: NormativeBlock; estimate: EstimateBlock | null });
   ```

   No lo implementé: el brief pide tipos planos y no me autorizaste a cambiar la forma del contrato. Lo señalo porque es la diferencia entre una invariante documentada y una invariante garantizada.

4. **Ningún test cubre `EvidenceBlock`, `SoftwareCoverageGaps` ni la forma de `basis`.** El test del brief ejercita el camino feliz con dos literales exactos. No hay test que falle si alguien widen `Outcome` a `string` o vuelve opcional `rulesFingerprint`. Es normal en un primer contrato, pero conviene saber que la cobertura es de compilación, no de comportamiento.
