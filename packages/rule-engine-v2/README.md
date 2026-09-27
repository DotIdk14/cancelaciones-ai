# Rule Engine V2 — árbol de decisión de deserción

Motor normativo **puro y determinista** que decide el desenlace de una auditoría a
partir de los hechos extraídos y de la fuente primaria ownersupplied
`GDM_GAM_PRD_MLG_003`.

No depende de React, Next.js, InsForge, OpenRouter, HTTP ni del sistema de
archivos. Es una función: mismos hechos + mismo contexto + misma versión de
política ⇒ misma evaluación, byte a byte.

## Fuente de autoridad

`GDM_GAM_PRD_MLG_003` es la **única** fuente que puede fijar un desenlace de
primer nivel.

| Fuente | Rol | SHA-256 |
|---|---|---|
| `GDM_GAM_PRD_MLG_003` Procedimiento Deserción | `PRIMARY_NORMATIVE_SOURCE` | `71faf646…96c7d2` |
| `GDM_GAM_PRD_MXL_008` Procedimiento D53 | `AUXILIARY_REFERENCED_SOURCE` | `49c30482…ee7c383` |
| Glosario de operación escolar | `AUXILIARY_DEFINITION_SOURCE` | `de15e50b…63e9f5` |

> **D53 no es un desenlace de primer nivel.** Es un procedimiento auxiliar. Su
> nombre no aparece en `OUTCOMES` y ninguna de sus reglas puede fundar un cierre
> normativo. Ver `src/tests/21-primary-outcome-constraint.test.ts`.

Una regla puede fundamentar un desenlace si cita al primario en `sourceRefs` o si
declara un `primaryGrounding` que lo conecte. Sin eso la regla es
*provisional-only*: declara su desenlace, el auditor recibe una respuesta
concreta, y el estado escala a `REQUIRES_HUMAN_REVIEW`.

## Los dos campos que no se confunden

```ts
normativeOutcome: Outcome | null   // qué dice la norma. Sólo en DETERMINATE.
closestOutcome: Outcome | null     // qué se parece más a esta evidencia. Provisional.
```

Que coincidan a veces no significa que sean la misma cosa. Cuando la fuente
primaria calla, `normativeOutcome` es `null` aunque `closestOutcome` tenga valor.

| Estado | Significado |
|---|---|
| `DETERMINATE` | La fuente cierra el caso. `normativeOutcome` obligatorio. |
| `INSUFFICIENT_EVIDENCE` | La política es clara pero faltan hechos. |
| `REQUIRES_HUMAN_REVIEW` | Conflicto o ambigüedad normativa: decide el Owner. |

`REQUIRES_HUMAN_REVIEW` **no** borra la resolución. Un caso con un desenlace más
respaldado siempre trae `closestOutcome` poblado. Sólo queda `null` ante empate
real o ausencia total de candidatos, y en ambos casos se listan las alternativas.

## Uso

```ts
import { evaluateAudit, POLICY_VERSION, OUTCOMES } from '@cancelaciones/rule-engine-v2';

const evaluation = evaluateAudit({ facts, evidenceContext, policyVersion: POLICY_VERSION });

evaluation.normativeStatus;    // 'DETERMINATE' | 'INSUFFICIENT_EVIDENCE' | 'REQUIRES_HUMAN_REVIEW'
evaluation.normativeOutcome;   // Outcome | null
evaluation.closestOutcome;     // Outcome | null
evaluation.provisionalOnly;    // reglas auxiliares con su desenlace y su ambigüedad pendiente
evaluation.trace;              // explicación completa, con fingerprint
```

## Hechos: cinco valores, no dos

Un hecho no es `true` o `false`. Es `KNOWN`, `UNKNOWN`, `NOT_APPLICABLE` o
`CONTRADICTED`.

`UNKNOWN_IS_NOT_FALSE` es la razón de que `UNKNOWN` no se trate como `false` ni
como `true`: la ausencia de evidencia no es una condición falsa, y una regla que
depende de un hecho desconocido **no** puede cerrar el caso. Lo mismo aplica a
`NOT_APPLICABLE`, que además debe declararlo con su motivo.

## Traza

`TRACE_EVERY_DECISION`: cada decisión enlaza regla, condición, hecho y
evidencia/fuente. La traza tiene 13 tipos de paso, entre ellos:

- `AUTHORITY` — por regla, si su desenlace es normativo o sólo propuesto, con su
  grounding y sus ambigüedades.
- `PROVISIONAL_ONLY` — qué reglas auxiliares impiden cerrar y qué las desbloquea.
- `STATUS` — el motivo **específico** del estado, no una etiqueta genérica.
- `RESULT` — dos pasos separados: `normative` y `provisional`.

Cuando un caso escala, el motivo enumera **todas** las causas. Si además hay una
lectura auxiliar viva, advierte que resolver el conflicto no basta: mientras el
primario no pueda cerrar en solitario, el caso sigue abierto.

## Determinismo

`rulesFingerprint` y `trace.fingerprint` cubren las entradas que cambian una
decisión, incluidas `primaryGrounding` y `awaitsAmbiguityIds`, que cambian la
autoridad. El fingerprint **no** cambia si se reordena `sourceRefs`: el orden de
citación no es una decisión.

## Estructura

```
src/
  sources.ts          roles normativos y hashes verificados
  facts/catalog.ts    94 hechos canónicos
  facts/derive.ts     derivaciones deterministas
  rules/authority.ts  quién puede fijar un desenlace
  rules/phase15.ts    reglas derivadas de las fuentes
  nodes/graph.ts      16 nodos del recorrido
  conflicts/xdc.ts    17 conflictos normativos
  conditions/         evaluación de condiciones de cinco valores
  temporal/           ventanas y anclas de fecha
  ranking/            ranking provisional por soporte entero
  evaluator/          estado normativo, ranking, fingerprint, traza
  tests/              23 archivos, 343 tests
```

## Lo que este motor NO hace

- No resuelve las 15 ambigüedades abiertas del Owner. Las materializa, las
  escala y las nombra.
- No adivina hechos ausentes.
- No persiste nada: es puro. La persistencia es de la aplicación.
- No emite dictámenes. `Dictamen.pdf` es un artefacto separado y exige base
  normativa confirmada.
- No ejecuta nada sobre datos que no puede leer. Ver
  `docs/owner-decisions/OD-001-provisional-audit-integration.md` §3.

## Comandos

```bash
npx tsc --noEmit -p tsconfig.json   # typecheck estricto
npx vitest run                      # 343 tests
```

Un test de la suite escanea todos los archivos del paquete y falla si aparece
carácter CJK: el vocabulario normativo va en español o inglés técnico, y un
carácter fuera de ese rango indica texto corrupto o pegado de otra fuente.
