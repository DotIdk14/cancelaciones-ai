# Task 5 — Evaluation Envelope y Shadow Engine no oficial

## Estado

COMPLETADO.

Se implementó un adapter puro desde `PolicyEvaluation` y una frontera de evaluación shadow estrictamente no autoritativa, sin modificar `evaluatePolicy` ni `v5Rules`, y sin introducir persistencia, DB, IDs operativos, serializers oficiales ni writes.

## Archivos

Creados:

- `packages/policy-engine/src/evaluation-envelope.ts`
- `packages/policy-engine/src/evaluation-envelope.test.ts`
- `packages/policy-engine/src/shadow-engine.ts`
- `packages/policy-engine/src/shadow-engine.test.ts`

Modificado:

- `packages/policy-engine/src/index.ts`

En `index.ts` se añadieron exports únicamente para `evaluation-envelope` y `shadow-engine`. El export existente de `source-registry`, que ya estaba en el workspace antes de Task 5, se preservó.

## Implementación

### Evaluation envelope

- `AuditEvaluationEnvelopeV1` separa `decision`, `evidence`, `policy`, `system` y `review`.
- `toAuditEvaluationEnvelopeV1(evaluation, context)` copia sin reinterpretar `suggestedOutcome`, `outcomeStatus` y `decisionStatus` desde `PolicyEvaluation`.
- Define los diez reason codes requeridos mediante `EVALUATION_REASON_CODES` y `EvaluationReasonCode`.
- `NO_POLICY_OUTCOME` queda en `decision` únicamente cuando `suggestedOutcome` es `null`.
- `MISSING_EVIDENCE` y `CONTRADICTORY_EVIDENCE` quedan en `evidence`.
- `MISSING_NORMATIVE_SOURCE` y `POLICY_COVERAGE_GAP` quedan en `policy`.
- `MODEL_ERROR`, `PARSING_ERROR`, `SCHEMA_ERROR` y `PERSISTENCE_ERROR` quedan en `system` y no alteran `decision.outcomeStatus`.
- `HUMAN_REVIEW_REQUIRED` queda en `review` y conserva `reviewRequired` sin reinterpretarlo.
- El listado global `reasonCodes` conserva el orden: errores de sistema, fuente normativa, coverage, conflictos, missing facts/evidence y review.
- Los fingerprints de rules y facts se preservan.
- Las entradas se copian y deduplican sin mutar `PolicyEvaluation`.

El contexto acepta únicamente `systemReasonCodes` y `contradictoryEvidence`, ambos opcionales, manteniendo el adapter puro y sin dependencias de infraestructura.

### Shadow boundary

- `ShadowPolicyEngine` contiene solamente `id`, `version` y `evaluate(input): Promise<ShadowPolicyResult>`.
- `NonAuthoritativeShadowRunner` expone solamente `authoritative: false` y `compare(...)`.
- `createNonAuthoritativeShadowRunner` acepta un evaluator mínimo para soportar el contrato de prueba `{ evaluate }` del brief.
- `compare` recibe sólo `official` y `shadowInput`, ejecuta el shadow engine y compara ambos resultados en memoria mediante `canonicalFingerprintV1`.
- El wrapper fuerza siempre `authoritative: false` y `source: 'DECLARATIVE_SHADOW'`, incluso si un evaluator intenta declarar `authoritative: true`.
- El runner no expone `persist`, `write`, `databaseClient` ni serializer.
- No se aceptaron `DatabaseClient`, audit ID, engine run ID ni pathways de persistencia.

## TDD RED → GREEN

### Línea base

Comando:

```bash
pnpm --filter @cancelaciones/policy-engine test
```

Resultado inicial: PASS, 5 archivos y 46 tests.

### RED 1 — envelope ausente

Primero se creó `evaluation-envelope.test.ts`.

Comando:

```bash
pnpm --filter @cancelaciones/policy-engine test -- evaluation-envelope.test.ts
```

Resultado RED esperado: FAIL al cargar `./evaluation-envelope` porque el módulo no existía.

Después de implementar el adapter: GREEN, 3 tests.

### RED 2 — shadow boundary ausente

Primero se creó `shadow-engine.test.ts`.

Comando:

```bash
pnpm --filter @cancelaciones/policy-engine test -- shadow-engine.test.ts
```

Resultado RED esperado: FAIL al cargar `./shadow-engine` porque el módulo no existía.

Después de implementar la interfaz y el wrapper: GREEN, 4 tests.

### RED 3 — orden global de causas ausente

Se añadió primero una aserción para exigir el orden global de reason codes.

Comando:

```bash
pnpm --filter @cancelaciones/policy-engine test -- evaluation-envelope.test.ts
```

Resultado RED esperado: FAIL porque `envelope.reasonCodes` era `undefined`.

Después de añadir el campo y su orden: GREEN, 3 tests.

## Verificación final

Suite completa:

```bash
pnpm --filter @cancelaciones/policy-engine test
```

Resultado: PASS — 7 archivos, 53 tests, 0 fallos. Incluye `golden-master.test.ts` con 13 tests verdes.

Typecheck:

```bash
pnpm --filter @cancelaciones/policy-engine typecheck
```

Resultado: PASS — `tsc --noEmit`, exit code 0.

Lint:

```bash
pnpm --filter @cancelaciones/policy-engine lint
```

Resultado: PASS — el paquete delega lint al typecheck ya aprobado.

## Invariantes verificadas

- `PolicyEvaluation` no fue alterado.
- `evaluatePolicy` no fue modificado.
- `v5Rules` no fue modificado.
- No se añadieron comentarios al código.
- No se añadieron dependencias.
- No se crearon DB, repositorios, persistencia, writes ni serializers.
- No se realizaron commits.
- No se alteraron archivos ajenos a Task 5; los cambios preexistentes del workspace se preservaron.

## Concerns

No hay bloqueos ni concerns críticos.

El brief no definía la forma exacta de `context`; se adoptó una API mínima y explícita con `systemReasonCodes` y `contradictoryEvidence`. Si una fase posterior requiere mensajes estructurados de error o identificadores de evidencia contradictoria, deberá ampliar este contrato mediante una nueva prueba/specificación, sin reinterpretar los outcomes actuales.

`NO_POLICY_OUTCOME` permanece dentro de `decision.reasonCodes` y también se incluye en el listado global de causas. El listado global conserva el orden de errores de sistema, fuentes normativas, coverage, evidencia, review y decisión.

No se realizó commit, merge, push ni creación de PR.

## Fix report — correcciones de Task 5

### Estado

CORREGIDO Y VERIFICADO.

Se corrigieron los cinco hallazgos solicitados sin modificar `evaluatePolicy` ni `v5Rules`, sin añadir comentarios al código y sin realizar commits.

### Correcciones

- `evaluation.conflicts` ya no alimenta `contradictoryEvidence`; sólo `context.contradictoryEvidence` se copia al envelope.
- `missingFacts` permanece únicamente en `evidence.missingFacts`; `MISSING_EVIDENCE` se activa sólo cuando existe `evaluation.missingEvidence`.
- `reasonCodes` global ahora incluye `NO_POLICY_OUTCOME` y deduplica el agregado, manteniendo la separación de `decision`, `evidence`, `policy`, `system` y `review`.
- `createNonAuthoritativeShadowRunner` acepta exactamente `ShadowPolicyEngine`, con `id`, `version` y `evaluate(input: unknown): Promise<ShadowPolicyResult>`. Se eliminó `Promise<unknown>` y se conserva `authoritative: false` y `source: 'DECLARATIVE_SHADOW'` forzados.
- Se separaron las pruebas de `conflicts`/`contradictoryEvidence` y `missingFacts`/`missingEvidence`; todas las entradas del shadow test usan `ShadowPolicyEngine` tipado.

### Verificación final

- Suite policy-engine: PASS — 7 archivos, 56 tests, 0 fallos.
- Tests específicos envelope/shadow: PASS — 10 tests, 0 fallos.
- Golden Master: PASS — 13 tests, 0 fallos.
- Typecheck: PASS — `tsc --noEmit`, exit code 0.
- Lint: PASS — el paquete delega lint al typecheck.
- `git diff --check`: PASS.

### Concerns

No quedan concerns funcionales o de tipado conocidos. El typecheck inicial detectó únicamente que `vi.fn` había ensanchado literales a `boolean/string`; se corrigió anotando el mock como `Promise<ShadowPolicyResult>` y la verificación final quedó verde.
