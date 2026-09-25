# Snapshots de decisión de máquina `AI_DECISION_V1`

> **ESTADO: la tabla `ai_decision_snapshots` NO EXISTE en ninguna base de datos.**
> La migración que la crea (`migrations/20260925120000_policy-foundation-immutability.sql`,
> §7, líneas 511-531) está **escrita y versionada pero NO APLICADA**. Todo lo que
> este documento describe como garantía de base de datos está marcado
> **`NO APLICADA`**.
>
> Lo que **sí existe y está commiteado** es el contrato de tipos, el
> constructor del snapshot, el cálculo del hash de integridad y el repositorio
> append-only, todo verificado por tests unitarios contra un cliente falso. La
> identidad de base de datos que hace que `appendAiDecisionV1` sea correcto
> (`ai_decision_snapshots_identity`) está **escrita y no aplicada**, así que la
> traducción de `23505` a `AI_DECISION_V1_ALREADY_EXISTS` nunca se ha ejercitado
> contra un Postgres real.
>
> **DB VALIDATION: BLOCKED.**

---

## 1. Qué es este snapshot y por qué existe

Una evaluación del motor normativo produce un `engine_run` (estado, outcome
sugerido, `rules` evaluadas, `facts` usadas). Eso dice **qué** decidió el motor,
pero no **bajo qué circumstances**: qué versión del motor corrió, qué prompt, qué
modelo, qué facts entró, qué evidencia las respaldaba, ni **cuándo**. Sin eso, una
decisión de máquina no es auditable: si mañana el prompt o el modelo cambian, la
fila registrada es indistinguible de la nueva.

`ai_decision_snapshots` es el registro append-only de **esas** circunstancias. Es
la expresión en base de datos de `TRACE_EVERY_DECISION` y `PRESERVE_MACHINE_DECISION`:
la fila se inserta una vez y jamás se modifica ni se borra, de modo que una
decisión de máquina no se puede reescribir a posteriori.

- Contrato de tipos: `AiDecisionV1Snapshot` en `packages/db/src/index.ts:1366`.
- Constructor y hash: `apps/web/src/server/policy/ai-decision-snapshot.ts`.
- Repositorio: `createPolicyFoundationRepository` en `packages/db/src/index.ts:1445`.
- Tabla: `migrations/20260925120000_policy-foundation-immutability.sql` §7.

---

## 2. Los 16 campos que entra al hash, más `hash`

`aiDecisionV1HashPayload` (`ai-decision-snapshot.ts:23`) devuelve
**exactamente** 16 campos, y su tipo de retorno es
`Record<AiDecisionV1HashField, unknown>` donde
`AiDecisionV1HashField = keyof AiDecisionV1SnapshotHashable` y
`AiDecisionV1SnapshotHashable = Omit<AiDecisionV1Snapshot, 'hash'>`. Los 16
campos son, **en el orden en que el hash los recorre**:

| # | Campo (TS) | Columna (`snake_case`) | Tipo TS | `NOT NULL` en DB |
|---|---|---|---|---|
| 1 | `auditId` | `audit_id` | `string` | sí |
| 2 | `factRunId` | `fact_run_id` | `string` | sí |
| 3 | `decisionVersion` | `decision_version` | `'AI_DECISION_V1'` | sí |
| 4 | `policyCode` | `policy_code` | `string` | sí |
| 5 | `policyVersion` | `policy_version` | `string` | sí |
| 6 | `policySourceId` | `policy_source_id` | `string` | sí |
| 7 | `engineVersion` | `engine_version` | `string` | sí |
| 8 | `promptVersion` | `prompt_version` | `string \| null` | **no** (nullable) |
| 9 | `extractorVersion` | `extractor_version` | `string` | sí |
| 10 | `provider` | `provider` | `string \| null` | **no** |
| 11 | `model` | `model` | `string \| null` | **no** |
| 12 | `inputFingerprint` | `input_fingerprint` | `string` | sí |
| 13 | `decisionSnapshot` | `decision_snapshot` | `Record<string, unknown>` | sí |
| 14 | `ruleTraceSnapshot` | `rule_trace_snapshot` | `Record<string, unknown>` | sí |
| 15 | `evidenceSnapshot` | `evidence_snapshot` | `Record<string, unknown>` | sí |
| 16 | `createdAt` | `created_at` | `string` | sí |
| — | `hash` | `hash` | `string` | sí, `CHECK hash ~ '^[a-f0-9]{64}$'` |

`hash` es el SHA-256 de la serialización canónica de los 16 anteriores
(`createHash('sha256').update(canonical).digest('hex')`).

### 2.1 Por qué la lista está escrita a mano y no con `...rest`

El tipo obliga a enumerar los 16 campos. Si mañana se agrega un campo a
`AiDecisionV1Snapshot`, el compilador **falla** en
`aiDecisionV1HashPayload` hasta que se decida explícitamente si entra o no al
hash. `...rest` está prohibido por el tipo: filtraría el hash justo en el caso
que importa (un campo operativo nuevo que alguien asumiera no significativo).
Este es un mecanismo de **tiempo de compilación**, no una convención social.

### 2.2 `decisionVersion` lo fija la función, no el llamador

`BuildAiDecisionV1SnapshotInput = Omit<AiDecisionV1SnapshotHashable,
'decisionVersion'>`, y `buildAiDecisionV1Snapshot` asigna
`decisionVersion: 'AI_DECISION_V1'` de forma literal
(`ai-decision-snapshot.ts:64`). No es posible construir un snapshot durable con
otra versión por esa vía. (La columna acepta `'AI_DECISION_V2'` por el
`CHECK decision_version IN ('AI_DECISION_V1','AI_DECISION_V2')`, pero **ningún
constructor del repositorio lo emite todavía**: la columna está preparada para
una versión futura, no describe una capacidad existente.)

### 2.3 `created_at` es `NOT NULL` **sin** `DEFAULT`

A propósito: el instante guardado es el mismo que entra en el hash, así que no
puede depender del reloj del servidor. Si el servidor pusiera `now()` por su
cuenta, la fila podría tener un `created_at` que no corresponde a los bytes que
el hash cubre, y la verificación de integridad sería falsa.

---

## 3. `canonicalFingerprintV1` vs `canonicalizeV1`: la distinción que sostiene todo

Éste es el punto técnico más importante del documento, y la razón de que
`hashAiDecisionV1Snapshot` **no** use la función de fingerprint de dominio.

Ambos viven en `packages/domain/src/policy-foundation.ts` y comparten el mismo
motor `canonicalizeValue`. Difieren en **un** parámetro booleano:

```ts
const OPERATIONAL_FINGERPRINT_FIELDS = ['createdAt', 'updatedAt', 'completedAt', 'executionId', 'runId'] as const;

export function canonicalizeV1(value: unknown): unknown {
  return canonicalizeValue(value, false);          // NO descarta campos operativos
}

export function canonicalFingerprintV1(value: unknown): string {
  return JSON.stringify(canonicalizeValue(value, true)) ?? 'null';   // SÍ los descarta
}
```

| | `canonicalFingerprintV1` | `canonicalizeV1` |
|---|---|---|
| Devuelve | `string` (JSON serializado) | el valor canónico como estructura |
| Descarta `createdAt`, `updatedAt`, `completedAt`, `executionId`, `runId` | **sí** | **no** |
| Descarta claves con valor `undefined` | sí | sí |
| Ordena claves por code point | sí | sí |
| Recorre arrays respetando el orden de los elementos | sí | sí |
| Uso en el repo | identidad de entradas: `input_fingerprint`, idempotencia, `matches` del shadow runner, Golden Master | **integridad de un registro que no se puede reescribir** |

`hashAiDecisionV1Snapshot` usa `canonicalizeV1` **a propósito**
(`ai-decision-snapshot.ts:52-57`, con el motivo escrito en el JSDoc):

> Se usa `canonicalizeV1` (no `canonicalFingerprintV1`) a propósito: el
> fingerprint de dominio descarta campos operativos (`createdAt`, `updatedAt`,
> `completedAt`, `executionId`, `runId`) y ese snapshot NO puede perderlos, porque
> su inmutabilidad depende de que el hash cubra el snapshot entero.

### 3.1 Consecuencia concreta: dos snapshots con distinto `createdAt` tienen distinto hash

Si dos ejecuciones idénticas producen el mismo resultado con instantes
diferentes, sus filas **deben** ser distinguibles: son dos decisiones tomadas en
dos momentos. Con `canonicalFingerprintV1` su colisionarían; con `canonicalizeV1`
no.

El test *"expone exactamente el conjunto de campos del contrato AI_DECISION_V1"*
y el *"cambia el hash al cambiar evidenceRefs (sin truncar)"* fijan este
comportamiento.

### 3.2 Qué sí es invariante: el orden de las claves, no el de los elementos

`canonicalizeV1` ordena claves por code point, porque Postgres es `JSONB` y
**reordena las claves al leer**. Sin esa normalización, la fila releída de la base
produciría un hash distinto del calculable en el cliente. El test
*"no depende del orden de las claves: Postgres (JSONB) reordena al leer"* lo
verifica.

El **orden de los elementos de un array sí es significativo**, porque el orden de
los hechos es parte de la identidad de la evaluación. El test *"sí depende del
orden de los elementos: el orden de las evidencias es significant"* lo afirma.

Y el hash **no trunca**: el test *"cubre el texto completo: el ultimo caracter de
un string de 200 cambia el hash"* demuestra que no hay truncamiento.

### 3.3 `hash` se excluye a sí mismo del cálculo

`hashAiDecisionV1Snapshot` acepta `AiDecisionV1SnapshotHashable & { hash?: string }`
y llama a `aiDecisionV1HashPayload(snapshot)`, que **no incluye** `hash` en su
salida porque el tipo de retorno no lo tiene. El test *"ignora el campo hash al
recomputar"* lo afirma: recomputar el hash de una fila releída de la base
reproduce exactamente el `hash` almacenado.

---

## 4. Por qué `createdAt` está dentro del hash de integridad y fuera del fingerprint de entrada

Son dos identificadores con trabajos distintos y **no** intercambiables.

| | `inputFingerprint` | `hash` |
|---|---|---|
| Trabajo | responder "¿entró **la misma entrada**?" | responder "¿esta fila sigue siendo **la misma**?" |
| Qué debe cubrir | el contenido que produjo la decisión | **todo** lo que se guardó |
| Campos operativos (`createdAt`, …) | **excluidos** | **incluidos** |
| Calculado con | `canonicalFingerprintV1` | `canonicalizeV1` |
| Cambia si la entrada es idéntica pero cambia el reloj | no | sí |
| Consecuencia si se mezclaran | dos decisiones idénticas se tomarían por la misma, y la segunda escritura sería rechazada por identidad | una fila podría alterarse cambiando sólo su reloj, sin que el hash lo notara |

El razonamiento de fondo es `AI_DECISION_V1_ALREADY_EXISTS` (§5): la identidad de
la fila es `(audit_id, decision_version, input_fingerprint)`. Si `createdAt`
estuviera dentro de `inputFingerprint`, **reintentar la misma decisión** generaría
una huella distinta, pasaría el `SELECT` previo, y el `INSERT` **sí** tendría
éxito: dos filas con la misma decisión de máquina, que es exactamente lo que
`PRESERVE_MACHINE_DECISION` prohíbe. Con `createdAt` fuera del fingerprint de
entrada y dentro del hash de integridad, se obtiene lo contrario: el reintento se
rechaza por identidad, y si alguna vez se acepta una fila nueva, su contenido
completo queda protegido.

Nótese el matiz: `input_fingerprint` **no** tiene `CHECK` de 64 hex en la tabla.
El tipo TypeScript lo declara `string` y sólo el productor actual emite hex; un
`CHECK` estrecho rechazaría un esquema de fingerprint futuro legítimo sin que
exista una migración que lo cambie. La garantía real para la identidad es
`btrim(input_fingerprint) <> ''`.

---

## 5. Append-only: cómo se fuerza, y en qué dos capas

### 5.1 En el código (`packages/db/src/index.ts:1445-1491`)

`createPolicyFoundationRepository(database).appendAiDecisionV1(snapshot)` hace
**sólo dos cosas** sobre la base de datos: un `SELECT` y un `INSERT`. **Nunca
hay un `.update()` ni un `.delete()`** sobre `ai_decision_snapshots` en todo el
paquete.

El flujo, literalmente:

1. `SELECT` de las 17 columnas filtrando por
   `(audit_id, decision_version, input_fingerprint)`, `limit(1)`.
2. Si la lectura falla → `throw` con el mensaje del servidor
   (*"propaga el error de lectura sin tragárselo"*).
3. Si ya existe una fila → `throw new Error(AI_DECISION_V1_ALREADY_EXISTS)`.
4. `INSERT` de las 17 columnas (`.insert([{...}]).select(columns).single()`).
5. Si el `INSERT` falla:
   - `isUniqueViolation({ code, message })` reconoce **`23505`** o el texto
     `duplicate key value violates unique constraint` → `throw new Error(AI_DECISION_V1_ALREADY_EXISTS)`;
   - cualquier otro error → se propaga tal cual.
6. Si no vuelve `data` → `throw` con un mensaje estable.

**El paso 3 es un check-then-act, y por eso importa tanto el paso 5.** Sin la
restricción de identidad de la base de datos, dos escrituras concurrentes para la
misma identidad pasarían ambas el `SELECT` y el segundo `INSERT` también tendría
éxito. El `23505` es la única red. Es exactamente por eso que
`ai_decision_snapshots_identity` es "objeto crítico" de la migración.

`AI_DECISION_V1_ALREADY_EXISTS` es un string constante exportado
(`packages/db/src/index.ts:1358`) y los tests afirmar que se lanza tanto por
colisión en el `SELECT` previo como por el `23505` traducido.

**Honestidad sobre el alcance:** `appendAiDecisionV1` **no tiene caller
productivo**. Su propio JSDoc lo dice: *"`appendAiDecisionV1` es de uso
explícito: no hay caller productivo"*. En el repositorio sólo lo exercitan los
tests. Por eso ninguna de estas dos capas se ha observado nunca contra una base
real.

### 5.2 En la base de datos (migración §7 y §9.1) — **`NO APLICADA`**

Tres mecanismos, complementarios. Ninguno sustituye a otro:

| # | Mecanismo | Objeto exacto | Qué cierra | Qué NO cierra |
|---|---|---|---|---|
| (A) | ACL | `REVOKE ALL … FROM anon`; `REVOKE UPDATE, DELETE ON public.ai_decision_snapshots FROM anon, authenticated`; `GRANT SELECT, INSERT … TO authenticated` | que el rol de cliente **intente** la escritura | que la escriba el propietario de la tabla o un `GRANT` accidental |
| (B) | RLS | `ai_decision_snapshots_select_visible` (`SELECT`), `ai_decision_snapshots_insert_visible` (`INSERT`), ambas con `EXISTS (SELECT 1 FROM public.audits WHERE … (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER'))` | que un `authenticated` lea o escriba evidencia de otra auditoría | nada por sí sola: no impide `UPDATE`/`DELETE` si el privilegio existiera |
| (C) | Trigger | `ai_decision_snapshots_append_only` (`BEFORE UPDATE OR DELETE`) → `guard_append_only_row()`, que aborta con `APPEND_ONLY_TABLE: ai_decision_snapshots` | la escritura **por cualquier rol**, incluido el propietario de la tabla y DDL | — |

`INSERT` se conserva a propósito en (A): es la única vía de escritura que tiene
`appendAiDecisionV1` (inserta directo, no hay RPC para esta tabla en esta
migración). `UPDATE` y `DELETE` quedan revocados **y** con trigger.

### 5.3 La restricción de identidad

```sql
CONSTRAINT ai_decision_snapshots_identity UNIQUE (audit_id, decision_version, input_fingerprint)
```

**`NO APLICADA`.** Es la pieza que hace correcto el `check-then-act` del
repositorio (ver §5.1). Está declarada en la migración con un bloque de
comentario entero dedicado a explicar por qué es crítica.

### 5.4 Índices (todos **`NO APLICADOS`**)

- `ai_decision_snapshots_audit_created_idx` sobre `(audit_id, created_at DESC)`.
- `ai_decision_snapshots_fact_run_idx` sobre `fact_run_id`.
- `ai_decision_snapshots_hash_idx` sobre **`left(hash, 63)`** — prefijo de 63
  bytes, no el hash entero, por el límite de bytes por entrada de índice B-tree
  de la versión de Postgres del backend.

---

## 6. Reintento, idempotencia y "crece, nunca reemplaza"

Hay que decirlo con precisión, porque la formulación fácil ("un reintento produce
una versión nueva") no es exactamente lo que hace el código.

| Situación | Qué ocurre | Test que lo afirma |
|---|---|---|
| Reintento con **la misma** `(auditId, decisionVersion, inputFingerprint)` | **Se rechaza** con `AI_DECISION_V1_ALREADY_EXISTS`. No se escribe nada. La fila existente **no se muta** (el `INSERT` falla, no hay `UPDATE`). | *"falla con AI_DECISION_V1_ALREADY_EXISTS ante colision de audit, version e input fingerprint"*, *"no muta la fila existente cuando el append se rechazado"* |
| Reintento con **distinto** `inputFingerprint` (misma auditoría, misma versión) | **Se inserta una fila nueva.** La colección crece; la anterior no se toca. | *"permite append cuando cambia el inputFingerprint (crece, nunca reemplaza)"* |
| Cambio de `auditId` | Se inserta una fila nueva, es otra identidad. | *"permite append cuando cambia el auditId"* |

O sea: **una fila nunca se sobrescribe**. O bien la identidad ya existe y la
escritura se rechaza, o bien la identidad es nueva y se añade una fila más. No
hay un tercer camino.

Y `decisionVersion` **no** es la Palanca de versionado en el sentido de
"reintento con V2": el constructor fija `'AI_DECISION_V1'` de forma literal, así
que el versionado real de una segunda major version de la decisión de máquina
tendría que venir con un constructor nuevo, y la columna ya está preparada para
aceptarlo. **Hoy no existe tal constructor.**

### 6.1 El `integrity_hash` de este snapshot y el del Fact Run no son comparables

No confundir: el `hash` de `ai_decision_snapshots` lo calcula la aplicación con
`canonicalizeV1` sobre los 16 campos TS. El `integrity_hash` de
`fact_run_frozen_snapshots` lo calcula el **servidor** con
`digest(jsonb_build_object(...)::text, 'sha256')` cuando el RPC existe, y con
`sha256(stableFingerprint({...}))` en el `fallback` local de captura legacy. Son
tres fórmulas distintas para dos objetos distintos. Compararlos no tiene sentido.

---

## 7. Separación respecto de la corrección humana

`ai_decision_snapshots` y `fact_run_frozen_snapshots` responden a preguntas
distintas y **no se pisan**.

| | `ai_decision_snapshots` | `fact_run_frozen_snapshots` |
|---|---|---|
| Pregunta | ¿qué decidió la máquina, con qué circunstancias? | ¿qué hechos vio la máquina, exactamente? |
| Se escribe | cuando corre una evaluación de máquina | cuando un Fact Run pasa a `FROZEN` |
| Se ve afectado por una corrección humana | **no** | el run derivado sí abre su propio snapshot; el del padre **no** se toca |
| Quién lo produce | `appendAiDecisionV1` (repositorio) | `freeze_fact_run_v1` (RPC) o el `fallback` de aplicación |

La regla que separa las dos cosas es `PRESERVE_MACHINE_DECISION` y la regla que
protege los hechos es `UNKNOWN_IS_NOT_FALSE` + `PRESERVE_EVIDENCE_PROVENANCE`. Una
corrección humana **nunca** modifica un snapshot de decisión de máquina: si la
evidencia cambió, la consecuencia es que hay que **evaluar otra vez**, lo que
produce un `engine_run` nuevo con otra `facts_fingerprint` y por tanto —según la
identidad del §5.3— otro `input_fingerprint` y otra fila. Las dos decisiones
coexisten; ninguna borra a la otra.

Lo mismo aplica al otro sentido: una decisión de máquina no corrige hechos. Si el
motor decide que falta un dato, produce `missingData` / `nextActions`; no inventa
el hecho.

Ambas piezas tienen además un refuerzo en la migración §9.4 (trigger
`audit_runs_guard_append_only`, **`NO APLICADO`**) que aborta cualquier `UPDATE`
o `DELETE` sobre un `audit_runs` cuyo `run_type` es `'AI_DECISION_V1'` o
`'AI_DECISION_V2'`, o cuyo `status` ya es `'COMPLETED'`, con
`AUDIT_RUN_APPEND_ONLY: …`. Es la barrera que cubre la fila de la corrida, no la
del snapshot.

---

## 8. Lo que la migración NO hace con esta tabla

- **No la crea en ninguna base.** `NO APLICADA`.
- **No le pone `DEFAULT` a `created_at`**, a propósito (§2.3).
- **No restringe `input_fingerprint` a 64 hex**, a propósito (§4).
- **No revoca `INSERT` a `authenticated`**, a propósito (§5.2): sin RPC, es la
  única vía de escritura del repositorio.
- **No le aplica ningún `policy`**: no aplica reglas, no decide outcomes, no
  modifica datos históricos.
- **No marca ninguna fuente como `CANONICAL`.**

---

## 9. Resumen: qué está garantizado y cómo

| Afirmación | Mecanismo | ¿Vigente hoy? |
|---|---|---|
| El hash cubre los 16 campos del contrato, sin truncar | tipo `AiDecisionV1HashField` + `aiDecisionV1HashPayload` | **sí** (test) |
| Añadir un campo al snapshot obliga a decidir si entra al hash | el compilador falla en `aiDecisionV1HashPayload` | **sí** (tiempo de compilación) |
| `createdAt` está en el hash de integridad y fuera del fingerprint de entrada | `canonicalizeV1` vs `canonicalFingerprintV1` | **sí** (test) |
| El hash no depende del orden de las claves (JSONB reordena) | ordenación por code point en `canonicalizeValue` | **sí** (test) |
| Recomputar el hash de una fila releída reproduce el `hash` almacenado | `hash` excluido del payload | **sí** (test) |
| El repositorio nunca actualiza ni borra la fila | sólo `SELECT` + `INSERT` en `appendAiDecisionV1` | **sí** (test) |
| Un reintento de la misma identidad se rechaza y no muta lo existente | `SELECT` previo + traducción de `23505` | **sí en código**; la traducción de `23505` **no verificada contra Postgres** |
| La identidad `(audit_id, decision_version, input_fingerprint)` es única | `ai_decision_snapshots_identity` | **`NO APLICADA`** |
| `UPDATE`/`DELETE` imposibles para el rol de cliente | `REVOKE` (§7) | **`NO APLICADA`** |
| `UPDATE`/`DELETE` imposibles para cualquier rol | trigger `ai_decision_snapshots_append_only` | **`NO APLICADA`** |
| Un `authenticated` no lee ni escribe snapshots de otra auditoría | RLS `…_select_visible` / `…_insert_visible` | **`NO APLICADA`** |
| `appendAiDecisionV1` tiene un caller productivo | — | **no lo tiene** (sólo tests) |

`appendAiDecisionV1` es el único de estos mecanismos que **nunca** se ha
ejecutado contra una base de datos. `DB VALIDATION: BLOCKED`.
