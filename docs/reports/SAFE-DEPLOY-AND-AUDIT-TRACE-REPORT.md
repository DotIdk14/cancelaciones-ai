# Safe Deploy + Audit Trace Report

Fase: cierre de Policy Foundation (DB) + fix del blocker de human correction +
Decision Trace + despliegue.

Dos desviaciones respecto del encargo, dichas primero porque cambian cómo debe
leerse este informe:

1. **El objetivo de la migración fue PRODUCCIÓN, no DEV.** Así lo decidió el
   OWNER en la sesión anterior y así se encontró la base. Ver §11.
2. **La colisión de migraciones descrita en el encargo no existe.** El problema
   real era otro: el ledger estaba incompleto. Ver §2.

---

## 1. Starting State

```text
Repository : DotIdk14/cancelaciones-ai
Branch     : main
HEAD       : 1667c58e511937fb17a11dc7641f6394bd807172
Working tree: 19 paths modificados, SIN commitear
```

Verificado, no asumido. Los 8 commits de Foundation que el encargo lista
existen: `a411f61`, `5a889a9`, `5e7201f`, `d8e1b67`, `723460f`, `0801330`,
`3d3f0d4`, `1667c58`. `git worktree list` muestra un único worktree.

Baseline medido antes de tocar nada:

| Check | Resultado |
|---|---|
| `pnpm test` | **328 PASS** |
| `pnpm typecheck` | PASS |
| Golden Master | 14/14 |
| Hash LF de la fixture | `38e29f44…a0d76` **MATCH** |

Una corrección al encargo: el reporte de remediación que hay en el repo dice 320
tests. La cifra real es 328.

## 2. Working Tree Review

19 paths, clasificados:

| Clasificación | Paths |
|---|---|
| SECURITY | `scripts/ci-guards.mjs` (nuevo), `.github/workflows/ci.yml`, `package.json` |
| MIGRATION | 8 renombres, `20260925140000_policy-foundation-security-closure.sql` (nuevo), `20260925150000_fix-legacy-snapshot-fact-shape.sql` (nuevo) |
| PII CLEANUP | `migrations/20260924170500_finish-audit-48680.sql`, `apps/web/src/server/reporting/template-layout.json`, `apps/web/src/server/policy/blind-audit.test.ts`, `docs/reports/cave-30591-blind-e2e-report.md` |
| DOCUMENTATION | `docs/reports/POLICY-FOUNDATION-DB-SECURITY-CLOSURE.md`, `docs/reports/POLICY-FOUNDATION-MIGRATION-PLAN.md` |

Nada se perdió. No se usó `reset --hard`, `clean -fd`, `checkout .` ni
`restore .`.

**La colisión de §27 no se reproduce.** `feature/dictamen-panel` no existe en
ningún ref, y `fact-run-derivation.sql` no aparece en ninguno. El problema real
era que **8 ficheros nunca se registraron en el ledger** porque su esquema ya
estaba materializado al crearse la rama. El runner rechaza aplicar en desorden
un pendiente más antiguo que la cabeza remota, así que la Foundation no era
alcanzable sin reconciliar antes.

## 3. Human Correction RPC Fix

**Defecto confirmado, no supuesto.** Contra la función desplegada:

```text
claves que lee create_derived_fact_run_v1 : fact_type, classification, value, source_ref, confidence
y el mismo array lo guarda VERBATIM en fact_run_frozen_snapshots.facts
```

La segunda línea es el hallazgo que falaba en el diagnóstico anterior. El mismo
`p_facts` tiene **dos consumidores con contratos distintos**:

1. el `INSERT INTO public.facts` del RPC, que lee claves de **columna**;
2. el snapshot, que lo lee `mapSnapshotFactsToPolicyFacts`
   (`frozen-fact-run.ts:107`), que exige `id`, `type` y `value`.

Por tanto un payload sólo snake_case arregla (1) y rompe (2): deja un Fact Run
derivado sellado e **ilegible**. Uno sólo canónico arregla (2) y deja (1)
fallando. `toDerivedFactRpcPayload()` emite **ambas**, y la canónica manda.

No se tocó la representación interna del dominio. No se tocó ninguna huella: los
fingerprints se calculan sobre los `Fact[]` canónicos, no sobre el payload. No se
inventó ningún id: se conserva el del hecho padre, que es la trazabilidad de la
corrección.

12 tests nuevos. El más importante es el que comprueba que el payload
resultante **pasa** `mapSnapshotFactsToPolicyFacts`.

**No validado contra un Postgres real.** Requiere sesión autenticada, que esta
sesión no tiene. El contrato se verificó leyendo `prosrc` de la función
desplegada.

## 4. Decision Trace Architecture

```text
TRACE != POLICY ENGINE
```

`decision-trace.ts` **no importa** `evaluatePolicy`. Un test lee las sentencias
de import del propio módulo y falla si aparece. Si el trace evaluara, dejaría de
ser un registro y sería una segunda evaluación que además puede discrepar de la
original: eso es peor que no tener trace, porque da una respuesta con apariencia
de evidencia que es una segunda opinión.

**Sin tabla nueva.** La información ya es durable: `engine_runs.evaluation`
(jsonb), `engine_rule_results` (por regla), `fact_run_frozen_snapshots` (hechos
y procedencia). Una tabla nueva sería una segunda copia de la verdad, que es
justo el fallo que Foundation vino a cerrar.

## 5. Decision Trace Contract

`audit-decision-trace-v1`, con `readonly: true`. Bloques: `audit`, `execution`,
`availableRuns`, `facts`, `rules`, `aggregation`, `evidence`, `coverage`,
`review`, `diagnostics`, `envelope`, `comparison`, `evaluationVerbatim`.

Tres propiedades, noglenables:

- **Los huecos se declaran.** Sin envelope → `envelope: null` +
  `PERSISTENCE_ERROR`. Sin snapshot → `facts: []`. Un hecho sin `type` no se
  proyecta y se reporta `FACT_NORMALIZATION_GAP`. `engineVersion` es `null`
  porque no está persistido, y **no** se infiere del `rulesFingerprint`.
- **Nada se recalcula.** Cada hecho se cruza con las condiciones que lo
  consumieron usando los estados que el motor ya persistió. Un mismo hecho puede
  alimentar dos reglas con estados distintos, y el trace lo muestra sin
  promediarlo ni resolverlo.
- **La decisión humana está aislada.** Vive en `comparison` y en ningún otro
  sitio. No toca `aggregation` ni `facts`.

`diagnostics` usa reason codes **técnicos**, cada uno derivado de un campo
persistido. No son resultados normativos.

## 6. Trace API

```text
GET /api/audits/[auditId]/decision-trace
    ?engineRunId=<id>     selecciona una corrida
    ?download=1           devuelve decision-trace.json (mismo contrato)
```

Read-only. No evalúa, no recalcula, no escribe. `404 NO_TRACE_AVAILABLE` si la
auditoría no tiene evaluación registrada — no un trace vacío, porque un trace
vacío parece un trace sin hallazgos.

## 7. Trace UI

Tab nuevo `trazabilidad` en el inspector. No se rediseñó la UI.

La distinción con `PolicyEvaluationPanel` es explícita en el propio panel:

```text
PolicyEvaluationPanel  -> POST /policy          -> EVALÚA
DecisionTracePanel     -> GET  /decision-trace  -> LEE lo ya persistido
```

Por eso el botón dice **«Actualizar lectura»** y no «Evaluar». Cada regla es
expandible y muestra sección del GDM, estado, estado persistido en
`engine_rule_results`, efecto sobre el outcome, y cada condición con su estado,
valor observado, `missing facts` y evidencia.

## 8. Operational Logging

`operational-log.ts` es la **frontera de PII del logging**, y está aislado en un
módulo a propósito. Acepta un conjunto **cerrado** de campos (ids, estados,
reason codes, fingerprints, duraciones) y descarta el resto **en tiempo de
ejecución**. No exporta `log(cualquierCosa)`: el primer uso descuidado
`console.log(evaluation)` es imposible por tipo, no por disciplina.

Los logs de Vercel se indexan, se conservan y acceden a ellos más personas que a
la base de datos. No pueden convertirse en una segunda copia con nombres,
correos y teléfonos dentro. La explicación auditable de una auditoría sale de la
base, no de los logs.

6 tests que fijan la frontera, incluido que `evaluation` y `facts` se descartan
aunque se pasen con el nombre correcto.

## 9. Authorization

Idéntica a `policy/route.ts`: `audit.createdBy !== user.id` → `403`. Sin sesión
→ `401`. Verificado en producción: `/api/audits/x/decision-trace` → **401**.

**No hay excepción por ser debug.** Abrir una convertiría el trace en un oráculo
de datos de cualquier auditoría del sistema.

## 10. PII / Logging Safety

El trace **sí** contiene PII: contiene los hechos. Eso es lo que es. Por eso:

- sale por HTTP con autorización de la auditoría, nunca por log;
- la validación de producción imprime **sólo estructura** (ids, estados,
  conteos, códigos). Ningún valor de hecho, ningún correo, ningún teléfono;
- los valores de prueba de `operational-log.test.ts` se construyen por
  concatenación, porque si el literal estuviera en el fichero la guarda lo
  detectaría — que es justo lo que pasaría con un dato de verdad.

**La guarda de CI detectó PII en dos ficheros escritos en esta misma fase**: los
literales de prueba del test de logging, y los valores reales que el reporte de
cierre documentaba. Documentar el valor real en un documento versionado anula el
propio saneamiento. Ambos corregidos en `1aa0a34`. También se enmascaró el correo
de la cuenta GitHub del propietario, que el reporte mencionaba al describir el
entorno del CLI: en un repositorio público no hace falta para explicar nada y sí
para focalizar al dueño de la cuenta.

## 11. Evaluation Persistence

**PARTIAL — conectado pero histórico.**

`persistPolicyEvaluationAtomically` **sí** tiene caller productivo
(`evaluation.ts:86`). Y sin embargo:

```text
engine_runs                 9   (todas COMPLETED)
audit_evaluation_envelopes  0
```

La causa es temporal, no un defecto: los 9 `engine_runs` se crearon el 24 y 25
de septiembre, y `persist_policy_evaluation_v1` no existía hasta que se aplicó
`20260925120000` en esta fase. Esos runs se materializaron por la vía local con
degradación. **El success path del RPC sigue sin ejercitarse contra un Postgres
real**, porque requiere sesión autenticada.

## 12. Golden Master

```text
14 / 14 PASS
Hash 38e29f441498b72137fcb6bda49b0aa00ff6f4f898c2c7f6504b46a378ea0d76  MATCH
Fixture sin tocar
```

## 13. Regression Results

| # | Check | Antes | Después | Veredicto |
|---|---|---|---|---|
| 1 | `pnpm test` | 328 | **364** (+36) | PASS |
| 2 | `pnpm typecheck` | PASS | PASS | PASS |
| 3 | `pnpm lint` | PASS | PASS | PASS |
| 4 | `pnpm build` | PASS | PASS | PASS |
| 5 | `pnpm guard:ci` | — | PASS | PASS (nuevo) |
| 6 | Golden Master | 14/14 | 14/14 | PASS |
| 7 | Hash fixture | MATCH | MATCH | PASS |
| 8 | `git diff 1667c58..HEAD -- packages/policy-engine/` | — | **vacío** | NO NORMATIVE CHANGE |

**Regresiones: 0.**

`evaluatePolicy` y `v5Rules` son byte-idénticos a `1667c58`. Nada en la lista de
comparación se movió: `suggestedOutcome`, `outcomeStatus`, `decisionStatus`, rule
IDs, rule status, conditions, missing facts, missing evidence, coverage gaps,
next actions, trace, facts fingerprint, rules fingerprint.

## 14. Commits

```text
59025e7  security: remove PII from tracked files and add permanent CI guards
d41adf2  foundation: reconcile migration ledger and close db security remediation
1f57675  fix: align human correction rpc transport with the server contract
7782b69  feat: expose deterministic audit decision trace
0d84ab7  ui: show audit decision trace and stop delete_audit from failing as a 500
1aa0a34  docs: mask residual PII the new CI guard caught in this branch
```

Push a `main`: `1667c58..1aa0a34`. Sin squash. Los dos primeros commits se
rehicieron una vez porque un `git mv` previo había dejado los 8 borrados de
migración en el commit equivocado; nada estaba pusheado todavía, así que se
corrigió sin reescribir historia publicada.

## 15. Vercel Deployment

```text
Método  : auto-deploy por integración GitHub (no hay CLI de Vercel ni token
          en el entorno; el deploy anterior 1667c58 fue por la misma vía)
Commit  : 1aa0a349766c9ddd8662d0f8a757e9e23e95f283
Alias   : https://cancelaciones-ai-main.vercel.app
```

**No se verificó por alias, sino por comportamiento.** La línea base antes del
push era `/api/audits/x/decision-trace` → **404** (la ruta no existía). Tras el
despliegue → **401** (la ruta existe y pide sesión). Un 404 que se convierte en
401 sólo puede significar que el build nuevo está sirviendo.

```text
t+20s   404
t+40s   404
t+60s   404
t+80s   404
t+100s  401   <- desplegado
```

## 16. Production Smoke Test

| Ruta | Antes | Después |
|---|---|---|
| `/login` | 200 | **200** |
| `/auditorias` | 307 | **307** (redirect a login para anónimo) |
| `/api/health/insforge` | 200 | **200** |
| `/api/audits/x/decision-trace` | **404** | **401** |
| `/api/audits/x/policy` | 401 | 401 |

```json
{"ok":true,"service":"insforge","baseUrl":"https://4pw4jdzv.us-west.insforge.app"}
```

Sin errores 500. La salud de InsForge sigue apuntando al backend correcto.

## 17. First Trace Validation

Validado contra las **8 auditorías reales de producción**, en sólo lectura, sin
crear datos sintéticos porque ya había datos reales que trazar. La validación
imprime sólo estructura: **ningún valor de hecho, correo ni teléfono**.

```text
auditorias en produccion: 8
traces construidos      : 7 / 8   (1 sin engine_run)
```

Ejemplo real, `auditId 41214f86-604c-4fa6-b5d7-2cfabc59e7b9`:

```text
engineRunId     e8f33a3e-b904-4639-b725-0fe54c4e3648
factRunId       ce2dd9ae-c85a-4767-847e-7559002ddaf6
politica        GDM_GAM_PRD_MLG_003 V5
policySourceId  gdm-gam-prd-mlg-003-local-unverified
extractor       deterministic-facts-v1
factsFP         ce09dab7924e954a…
rulesFP         0fc7b96eaced78a9…
envelope        NO PERSISTIDO
outcome         —
decisionStatus  INDETERMINATE
reviewRequired  true

5.2   GDM-V5-5.2-A-CONTACT-ATTEMPTS         UNKNOWN         persisted=UNKNOWN
      UNKNOWN  calls-count                   facts=[935609aa…]
      UNKNOWN  calls-spacing                 facts=[935609aa…]
      UNKNOWN  written-count                 facts=[9f716f6e…]
      UNKNOWN  written-distribution          facts=[9f716f6e…]
5.7.e GDM-V5-5.7-E-INITIAL-BIMESTER-GRADES  UNKNOWN         persisted=UNKNOWN
      UNKNOWN  initial-bimestre-grades       missing=[classroom.hasGrades]
5.8.a GDM-V5-5.8-A-NON-LICENCIATURA         NOT_SATISFIED   outcomeEffect=CANCELACION_VENTA
      TRUE     no-effective-contact          facts=[97201994…]
      TRUE     student-level                 facts=[f112f5d2…]
      FALSE    non-licenciatura-no-activity  facts=[cde41e3e…]

missingFacts    classroom.hasGrades
coverageGaps    12
diagnosticos    PERSISTENCE_ERROR(1) MISSING_EVIDENCE(1) MISSING_FACT(1)
                POLICY_COVERAGE_GAP(12) RULE_EVALUATION_PATH(2)
```

Las 7 auditorías: `INDETERMINATE`, sin outcome, y el mismo patrón — 5.2 y 5.7.e
`UNKNOWN` por falta de hechos, 5.8.a `NOT_SATISFIED`.

**Esto responde la pregunta que motivaba la fase.** Antes había que leer código
para saber por qué una auditoría salía `INDETERMINATE`; ahora está en una
pantalla y en un JSON.

## 18. Known Blockers

| # | Blocker | Estado |
|---|---|---|
| 1 | Second human correction sigue colisionando (`+human-correction` sin unicidad) | abierto, `REQUIRES_OWNER_DECISION: HUMAN_CORRECTION_PARENT_SEMANTICS` |
| 2 | `delete_audit` devuelve 409 en vez de borrar | controlado, no resuelto: `AUDIT_ARCHIVAL_STATE` |
| 3 | `AI_DECISION_V1` armado sin caller productivo | `ARMED / NOT PRODUCTIVELY CONNECTED` |
| 4 | Success path de `persist_policy_evaluation_v1` sin ejercitar | requiere sesión autenticada |
| 5 | Matriz RLS con sesión sin medir | el anon key da 401 en el gateway |
| 6 | Historial de Git con PII | `OWNER_ACTION` |
| 7 | Credenciales expuestas en conversación | `OWNER_ACTION` |
| 8 | Sin perfil `OWNER` en producción | toda puerta `current_app_role() = 'OWNER'` es inalcanzable |
| 9 | `PolicyEvaluationPanel` y `delete_audit` con 500 pre-migración | fuera de alcance |

### AUDIT_TRACE_FINDINGS

No se corrigió ninguna regla. Se registran para revisión del OWNER.

| # | auditId | engineRunId | Observación | Capa sospechosa |
|---|---|---|---|---|
| 1 | los 7 con trace | — | `envelope` ausente en corridas `COMPLETED`. **Histórico**: los runs son del 24–25 y el RPC no existía. `persistPolicyEvaluationAtomically` sí está conectado. | PERSISTENCE |
| 2 | `41214f86…` y otros | `e8f33a3e…` | 5.8.a `NOT_SATISFIED` con `non-licenciatura-no-activity = FALSE` y `outcomeEffect = CANCELACION_VENTA`. Divergencia 5.8.a **ya documentada**; el Golden Master la congela. | RULE_IMPLEMENTATION (conocida) |
| 3 | los 7 | — | 5.7.e `UNKNOWN` sin efecto de outcome. Divergencia 5.7.e **ya documentada**. | POLICY_COVERAGE (conocida) |
| 4 | los 7 | — | 12 secciones sin formalizar. | POLICY_COVERAGE (conocida) |
| 5 | `41214f86…` | `e8f33a3e…` | `missingFacts = classroom.hasGrades` bloquea 5.7.e. No es un fallo: es la causa real del `INDETERMINATE`. | EVIDENCE |

**No se modificó ninguna regla, umbral ni outcome.** 1, 3 y 4 son divergencias
normativas ya documentadas y `REQUIRES_OWNER_DECISION`. 5 no es un defecto: es
la explicación del resultado.

## 19. OWNER_ACTION

| # | Acción | Prioridad |
|---|---|---|
| 1 | Rotar las credenciales expuestas en conversación (user API key de InsForge, token de Vercel del handoff previo) | **HIGH** |
| 2 | Reescribir el historial de Git: la PII del estudiante sigue en `5d2d4ba`, en 5 refs. Instrucciones en `POLICY-FOUNDATION-DB-SECURITY-CLOSURE.md` §7 | **HIGH** |
| 3 | Enmascarar el correo de la cuenta GitHub del propietario en cualquier otro documento | MEDIA |

Nada de esto bloqueó el trabajo de código, y nada está marcado `PASS` hasta que
el OWNER lo confirme.

## 20. Recommended Next Step

**No** empezar `EXTRACTION TOOLS + DECLARATIVE SHADOW ENGINE`. Sus condiciones de
entrada nunca fueron sobre código.

Cuando haya varias auditorías reales trazadas, el orden que propone este informe:

1. **Usar el trace para clasificar hallazgos**, no para arreglar reglas. El
   bloque 18 es el punto de partida: cada discrepancia se clasifica por capa
   (`EVIDENCE`, `EXTRACTION`, `FACT_NORMALIZATION`, `RULE_IMPLEMENTATION`,
   `POLICY_COVERAGE`, `AGGREGATION`, `SYSTEM`) antes de tocar nada.
2. **Decidir `HUMAN_CORRECTION_PARENT_SEMANTICS`** y con ello la idempotencia de
   la segunda corrección.
3. **Decidir `AUDIT_ARCHIVAL_STATE`.** Hoy no hay forma de eliminar una auditoría
   creada por error, que es la razón de existir de `delete_audit`.
4. **Verificar el success path de `persist_policy_evaluation_v1`** con una sesión
   real, para cerrar el bloque 1 y que los traces futuros traigan envelope.
5. Sólo entonces, con criterios authorised, empezar a tocar reglas. Y una regla
   cada vez, con su propio `rulesFingerprint`, de modo que `availableRuns` permita
   comparar el antes y el después.

El principio de esta fase era no ajustar el motor para que un caso concreto
"salga bien". El trace existe para poder observar primero, clasificar después, y
corregir sólo con autorización.
