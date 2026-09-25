# La frontera entre extracción, evidencia y política

> Documento normativo-frontera. No crea comportamiento: describe los límites que
> el código ya impone y qué se rompe si se confunden.
>
> **Los cuatro `!=` de abajo no son eslóganes.** Cada uno tiene un mecanismo
> concreto detrás, y en dos casos (`Fact Confidence != Decision Confidence`,
> `System Failure != Indeterminate Policy Decision`) el mecanismo es un **tipo**,
> no una convención.

---

## 1. Las cuatro separaciones

```text
Extraction Tool != Policy Rule
Fact Confidence != Decision Confidence
Evidence Completeness != Policy Outcome
System Failure != Indeterminate Policy Decision
```

### 1.1 `Extraction Tool != Policy Rule`

Una herramienta de extracción produce **hechos con procedencia**. Una regla
normativa es una **condición sobre la fuente del propietario**, con documento,
versión, sección y página. Viven en paquetes distintos, con contratos distintos, y
el motor normativo no importa nada de la capa de extracción.

**Qué rompe la confusión.** Si un extractor pudiera emitir un `ruleId`, un
`outcome` o un `suggestedOutcome` —incluso como un campo más, incluso anidado
dentro de `value`—, la evidencia empezaría adictar el resultado. El motor
normativo dejaría de ser la única fuente de outcomes y la trazabilidad
`regla ← evidencia ← hecho ← artefacto` se rompería por el eslabón más débil: un
valor de base de datos escrito por un componente que no es normativo. Peor: sería
**invisible**. Nadie vería el campo raro; sólo vería un outcome que cambió.

**Qué lo impide, mecánicamente:**

- El schema de salida es `z.object({ facts: … }).strict()` y el de cada hecho
  también es `.strict()`: no hay dónde colar un campo extra
  (`apps/web/src/server/extraction/contracts.ts:73,65`).
- Siete claves —`outcome`, `suggestedOutcome`, `decision`, `resolution`,
  `ruleId`, `matchedRule`, `policyDecision`— están prohibidas **recursivamente a
  cualquier profundidad** dentro de `fact.value`
  (`addForbiddenValueIssues`, `contracts.ts:34-54`), con un `seen: Set<object>`
  para no ciclar.
- La misma prohibición se aplica **en el schema declarado**, en tiempo de
  registro y sin ejecutar nada: `validateOutputSchema` +
  `schemaAllowsField` recorren el árbol interno del schema de Zod y lanzan
  `EXTRACTION_OUTPUT_SCHEMA_INVALID` (`registry.ts:61-80`).
- `policy-engine` no importa nada de `apps/web`. `evaluatePolicy` recibe
  `Fact[]` y nada más; su entrada es `{ policyCode, policyVersion, facts,
  ownerPrecedences? }` (`packages/policy-engine/src/index.ts:209`).
- Las reglas viven en `policySets = { GDM_GAM_PRD_MLG_003: { '2': v2Rules, '5':
  v5Rules } }` (`index.ts:207`) y cada regla lleva `source: { documentCode,
  version, section, page }` porque su procedencia normativa es obligatoria y
  distinta de la procedencia del hecho.

**No es una separación de convenciones, es una separación de tipos, de schemas
validados en runtime y de grafo de dependencias.**

---

### 1.2 `Fact Confidence != Decision Confidence`

Son dos números que no miden lo mismo y que viven en sitios distintos.

| | Confianza del **hecho** | Confianza de la **decisión** |
|---|---|---|
| Qué afirma | "el extractor encontró esto en esta evidencia con esta certeza" | "la decisión se sustenta en estas reglas y estos hechos" |
| Campo | `Fact.extractionConfidence` (`number \| undefined`, `[0,1]`) y `FactProvenanceV1.confidence` | **no existe un número de confianza de decisión** |
| Dónde | `packages/domain/src/policy-foundation.ts:15,22` y en la `provenance` de cada hecho extraído | — |
| Cómo se expresa la decisión | `suggestedOutcome`, `outcomeStatus`, `decisionStatus`, `decisiveRules`, `supportingRules`, `opposingRules`, `pendingRules`, `conflictingRules`, `blockedRules` | idem |
| Qué lo fija | el extractor | el motor, derivándolo de las reglas evaluadas |

**Lo decisivo: no hay `decisionConfidence` en ninguna parte.** No es que esté
separado; es que el modelo de datos **no tiene** un número de confianza de
decisión. La incertidumbre de una decisión se expresa **estructuralmente**, con
enums y con listas de reglas, nunca con un escalar que alguien pueda promediar.

`extract_contact_attempts` muestra por qué: cuando la fuente está incompleta, la
herramienta emite `state: 'UNKNOWN'` y `sourceCompleteness: 'UNKNOWN'`
(`extract-contact-attempts.ts:50-70`). No emite `confidence: 0.4`. La
completitud y la confianza son **ejes distintos**, y el motor los consume por
separado: `sourceCompleteness` gobierna si la condición puede evaluarse; la
`extractionConfidence` es un atributo informativo del hecho.

**Qué rompe la confusión.** Un `confidence` de decisión agregado sería
peligroso de forma inmediata: promediar confianza sobre reglas con estados
heterogéneos (`TRUE`/`FALSE`/`UNKNOWN`/`NOT_APPLICABLE`) produce un número que no
significa nada, y **un número que no significa nada se presenta igual que uno que
sí**. El caso `partial-contact-collections` del Golden Master es exactamente la
prueba: 16 llamadas observadas sobre una fuente `PARTIAL` dan `UNKNOWN` en la
regla 5.2, no "confianza media". Un escalar habría invited a alguien a
presentarlo como "probablemente hay contacto suficiente".

Lo mismo aplica con `ownerPrecedences`: `OPERATIONAL_PRECEDENCE_IS_NOT_POLICY`
— una precedencia aprobada por el owner es un dato operativo que se guarda y se
muestra **separado** de la fuente normativa, nunca mezclado en ella.

---

### 1.3 `Evidence Completeness != Policy Outcome`

Que falte evidencia **no** es un resultado. Es un `UNKNOWN` de una condición, y
un `UNKNOWN` no empuja la decisión en ninguna dirección.

**Qué lo impide, mecánicamente:**

- `state` de una condición es `'TRUE' | 'FALSE' | 'UNKNOWN' | 'NOT_APPLICABLE'`,
  y `UNKNOWN` **nunca** aporta soporte positivo. En `evaluatePolicy`, el outcome
  sugerido sale de `outcomeRules`, que son reglas `SATISFIED` con `outcomeEffect`
  (`index.ts:213-215`).
- Una regla con alguna condición `UNKNOWN` **no** está `SATISFIED`:
  `stateToRule` la degrada. Por eso `missingFacts` es lo que produce
  `missingData`, y eso produce `severity: 'BLOCKING'` o `'IMPORTANT'`
  (`index.ts:225-230`), no un outcome.
- El resultado de la falta de evidencia se reporta en campos **aparte**:
  `missingData`, `missingEvidence`, `missingFacts`, `nextActions`,
  `suggestedReason: null`, `explanation`, y en el envelope
  `AuditEvaluationEnvelopeV1.evidence.{missingFacts, missingEvidence,
  contradictoryEvidence, reasonCodes}` con sus propios
  `MISSING_EVIDENCE` / `CONTRADICTORY_EVIDENCE`
  (`packages/policy-engine/src/evaluation-envelope.ts:29-35`).
- `softwareCoverageGaps` se reporta **separado** de los faltantes de evidencia y
  de los faltantes normativos: `index.ts:231-246` produce once entradas
  ("Sección 5.3 no formalizada todavía", etc.) y `evaluation-envelope.ts:36-43`
  las mete en `policy.coverageGaps`, no en `evidence.missingEvidence`.
- `mapSnapshotFactsToPolicyFacts` (`frozen-fact-run.ts:114`) **rechaza** un hecho
  sellado sin `value` (`FROZEN_SNAPSHOT_PAYLOAD_INVALID: facts[i].value ausente`),
  con el motivo escrito: un `value` ausente se perdería en la proyección a
  `Fact[]`, y perderlo es exactamente la forma en que `UNKNOWN` se convierte en
  `false` sin que nadie lo note.

El corpus del Golden Master bloquea esta separación de forma explícita:
`missing-all-facts` termina con `suggestedOutcome: null`,
`outcomeStatus: 'INDETERMINATE'`, `decisionStatus: 'INDETERMINATE'`,
`reviewRequired: true` y cinco `nextActions` de tipo `UPLOAD_EVIDENCE`. Cero
evidencia no produce **ningún** outcome.

Lo que **sí** cambia con la evidencia no es una substitución de
"indeterminado" por "algo": es una **evaluación nueva**, con otra
`facts_fingerprint` y por tanto otro `engine_run`. La decisión anterior no se
reescribe (`PRESERVE_MACHINE_DECISION`).

**Qué rompe la confusión.** Si la falta de evidencia degradara a un outcome
—"no se puede acreditar el contacto, entonces procede la cancelación"—, el
sistema estaría **inventando criterio normativo**. El resultado sería indistinguible
de una regla aplicada, y sería el peor fallo posible del sistema: uno que
produce respuestas con apariencia de dictamen sin ninguna regla detrás.

---

### 1.4 `System Failure != Indeterminate Policy Decision`

Son dos cosas que se ven iguales desde fuera (no hay resultado) y que **no**
pueden colapsarse.

| | Fallo del sistema | Decisión política indeterminada |
|---|---|---|
| Ejemplo | `PARSE_ERROR`, `MODEL_ERROR`, `SCHEMA_ERROR`, `PERSISTENCE_ERROR` | no hay regla de outcome suficientemente sustentada |
| Dónde se registra | `AuditEvaluationEnvelopeV1.system.reasonCodes` | `AuditEvaluationEnvelopeV1.decision` + `evidence` + `policy` |
| Tipo TypeScript | `EvaluationSystemReasonCode` | `EvaluationReasonCode` completo |
| ¿Es un estado del motor? | **no** | **sí**: `suggestedOutcome: null`, `outcomeStatus: 'INDETERMINATE'` |

`evaluation-envelope.ts:10-13` hace la separación **a nivel de tipos**:

```ts
export type EvaluationSystemReasonCode = Extract<
  EvaluationReasonCode,
  'MODEL_ERROR' | 'PARSING_ERROR' | 'SCHEMA_ERROR' | 'PERSISTENCE_ERROR'
>;
```

y `AuditEvaluationEnvelopeV1` los coloca en bloques distintos: `system.reasonCodes`
sólo puede contener códigos del sistema; `decision.reasonCodes` **sólo** puede
contener `'NO_POLICY_OUTCOME'`; `evidence.reasonCodes` sólo `MISSING_EVIDENCE` o
`CONTRADICTORY_EVIDENCE`; `policy.reasonCodes` sólo `POLICY_COVERAGE_GAP` o
`MISSING_NORMATIVE_SOURCE`; `review.reasonCodes` sólo `HUMAN_REVIEW_REQUIRED`.
Es una **partición de tipos**, no un campo de texto donde se mezclan.

**Qué rompe la confusión.** Si un `PERSISTENCE_ERROR` se reportara como
"indeterminado", un fallo de infraestructura se leería como una afirmación
normativa: alguien concluiría que "el sistema no pudo determinar" cuando en
realidad el motor quizá sí habría determinado y lo que falló fue escribirlo. Eso
convierte un error transitorio en un dato sobre el caso, y lo hace de forma
**durable**: la fila queda registrada, y una fila registrada es evidencia. En el
otro sentido, tratar una decisión realmente indeterminada como si fuera un fallo
de sistema la esconde: nadie reintenta, nadie lo arregla, y el caso se pierde.

En el código, el mismo razonamiento se repite en la frontera
AUSENCIA/FALLO de `isFoundationObjectMissing`
(`apps/web/src/server/facts/foundation-objects.ts:60`): un error de negocio del
RPC (`AUTH_REQUIRED`, `FORBIDDEN`, `POLICY_SOURCE_NOT_REGISTERED`…) **se
propaga**, y sólo la ausencia del objeto degrada. La razón escrita en el JSDoc es
exacta: si se confundieran, "un fallo de autorización se disfrazaría de 'funciona
porque cayó al camino viejo'".

---

## 2. `ShadowPolicyEngine`: por qué expone sólo `id`, `version` y `evaluate`

`packages/policy-engine/src/shadow-engine.ts:6-10`:

```ts
export interface ShadowPolicyEngine {
  readonly id: string;
  readonly version: string;
  evaluate(input: unknown): Promise<ShadowPolicyResult>;
}
```

Tres miembros, y ninguno es un método de persistencia.

| Miembro | Para qué |
|---|---|
| `id` | Identidad del motor. Permite decir *qué* motor comparó. |
| `version` | Permite saber *con qué versión*. Sin esto, un `matches: true` no dice si compararon el mismo criterio. |
| `evaluate(input: unknown)` | Ejecuta. `input: unknown` a propósito: el motor shadow no declara qué acepta. |

Lo que **no** hay, y por qué:

- **No hay `persist`, `save`, `write` ni `record`.** Un motor declarativo es una
  función; darle un método de escritura lo convertiría en un sistema de decisión
  con efectos. La única forma de que una comparación shadow llegue a la base es
  que **otro** componente lo decida, y ese componente tendría que pasar por
  `appendAiDecisionV1` o por el RPC de evaluación, que son los caminos con
  identidad, hash y trazabilidad.
- **No hay `compare` en el engine.** `compare` vive en el runner
  (`createNonAuthoritativeShadowRunner`), que es un objeto distinto con un
  trabajo distinto: comparar.
- **No hay acceso al `policy engine` oficial, ni a la base de datos, ni al
  registry de fuentes.** `shadow-engine.ts` importa **dos** cosas de
  `@cancelaciones/domain`: `canonicalFingerprintV1` y el tipo
  `ShadowPolicyResult`. No importa nada más. El motor no puede citar una fuente
  porque no tiene dónde buscarla.

### 2.1 Por qué el resultado está tipado `authoritative: false`

`ShadowPolicyResult` está en `packages/domain/src/policy-foundation.ts:30-34`:

```ts
export interface ShadowPolicyResult {
  authoritative: false;
  source: 'DECLARATIVE_SHADOW';
  evaluation: unknown;
}
```

Los dos discriminantes son **tipos literales**, no campos opcionales: no se puede
construir un `ShadowPolicyResult` que diga otra cosa. Y `evaluation` es
`unknown`, no `PolicyEvaluation`: el motor shadow no promete la forma del motor
oficial, precisamente porque no tiene por qué tenerla.

`createNonAuthoritativeShadowRunner` construye el resultado con esos dos valores
**literales** (`shadow-engine.ts:28-32`), sin importar nada de la decisión
oficial. Es la codificación de `POLICY_ENGINE_DECIDES` en el tipo: nada que venga
de un motor shadow puede ser autoritativo, y ningún consumidor puede confundirlo
con una decisión real salvo que **ignore el tipo a propósito**.

### 2.2 Por qué el runner está congelado y no persiste

`createNonAuthoritativeShadowRunner` devuelve `Object.freeze({ authoritative:
false as const, compare: … })` (`shadow-engine.ts:24-40`). Dos razones:

1. **Congelado:** su única propiedad de estado es `authoritative: false`. Sin
   `Object.freeze`, un consumidor podría asignarle `true` y el tipado del resto
   del sistema mentiría. Congelarlo hace que la garantía sea de **runtime**, no
   de convención.
2. **Sin método de persistencia:** `compare` devuelve
   `{ official, shadow, matches }` — un valor, no un efecto. El runner **no**
   escribe en ninguna parte. `matches` se calcula con
   `canonicalFingerprintV1(input.official) === canonicalFingerprintV1(shadow.evaluation)`,
   es decir comparando **huellas canónicas**, no objetos. Dos resultados
   estructuralmente iguales dan el mismo `matches` aunque difieran en campos
   operativos (`createdAt`, `updatedAt`, `completedAt`, `executionId`, `runId`),
   que es exactamente para lo que existe `canonicalFingerprintV1` (ver
   `docs/architecture/ai-decision-snapshots.md` §3).

Y el corollary importante: **`NonAuthoritativeShadowRunner` no tiene ningún
método de persistencia**, y el código del repositorio no tiene ninguno
importado desde este módulo. El runner existe para **responder una pregunta en
memoria** ("¿coincide este motor declarativo con el oficial?"), no para dejar un
rastro. Dejar un rastro de una comparación no autoritativa con la misma tabla
que las decisiones reales las mezclaría en la trazabilidad.

**Honestidad sobre el estado:** esta es una frontera **tipada y probada**, y el
`Object.freeze` es una garantía real. Pero `ShadowPolicyEngine` y
`NonAuthoritativeShadowRunner` **no tienen caller productivo** en el pipeline de
evaluación. La frontera existe y está verificada por tests; el uso no está
conectado.

---

## 3. La barrera de sanitización ciega: fail-closed

El modo `BLIND_MACHINE_AUDIT` existe para que una evaluación ciega no pueda
ver la decisión humana. Es un control de **filtrado de entrada**, y como tal es
fail-closed: ante cualquier duda, se **excluye**, y si la exclusión no puede
explicarse, se aborta.

### 3.1 El recorrido

```
  artefactos CRUDOS  (result / text / transcript, con el documento que sea)
          │
          │  1) ¿todas las evidencias tienen document_role?  ── no ──► BLIND_INPUT_INVALID
          │                                                        (blind-audit.ts:240)
          ▼
  blindEvidenceSanitizer(evidencesForSanitization, artifactTextMap)
          │  excluye por ROL:      HUMAN_DECISION_DOCUMENT, ADJUDICATION_EVIDENCE
          │                       y todo lo que no sea exactamente 'EVIDENCE'
          │  excluye por HEURÍSTICA de texto:
          │     DETECTED_DICTAMEN_SYNTACTIC, DETECTED_FORMAL_OUTCOME,
          │     DETECTED_RESOLUTION_PHRASE, DETECTED_DICTAMEN_SECTION,
          │     DETECTED_HUMAN_REFERENCE
          │  excluye por DENSIDAD: ≥2 keywords de outcome humano
          ▼
  allowedEvidenceIds   ──►   buildBlindInputManifest → BlindInputManifestV1
          │                          [{ artifactId, evidenceId }]
          │  assertBlindManifestComplete(manifest, allowedEvidenceIds)
          │     → BLIND_MANIFEST_INCOMPLETE si una entrada no mapea a una
          │       evidencia permitida, o si un artifactId mapea a dos evidenceIds
          ▼
  filterBlindArtifactsAndFacts(artifacts|storedFacts, manifest)
          │  un artefacto con evidenceId no permitido NO PASA
          │  un artifactId cuyo evidenceId no coincide con el manifest NO PASA
          │  un item sin sourceRef ni (id, evidenceId) NO PASA  ← fail-closed
          ▼
  assertBlindReferencesValid({ manifest, artifacts, storedFacts, candidates })
          │  BLIND_REFERENCE_INVALID si CUALQUIER referencia no resuelve
          ▼
  extracción / grafo de evidencia  (sólo con lo permitido)
```

### 3.2 Por qué es fail-closed y no fail-open

Cuatro decisiones concretas, todas en
`apps/web/src/server/policy/blind-evidence-sanitizer.ts`:

1. **El rol manda sobre el contenido.** `role !== 'EVIDENCE'` excluye. Una
   evidencia con `document_role` `undefined` o `null` **se excluye**, no se
   incluye por defecto. El `roleLabel` los convierte a `'undefined'` y `'null'`
   para que la exclusión sea legible en el log.
2. **Las heurísticas sólo restan.** Las cinco heurísticas de
   `humanDecisionHeuristics` y la regla de densidad de `POTENTIAL_HUMAN_KEYWORDS`
   detectan **posible** contenido de dictamen humano y excluyen. No hay ninguna
   heurística que *incluya*: un texto que no dispare ninguna heurística no gana
   ninguna protección adicional, simplemente no se excluye.
3. **La densidad es un umbral de riesgo, no de certeza.** `keywordCount >= 2` excluye.
   Un solo keyword no excluye, y eso es correcto: "dictamen" aparece en textos
   inocuos. El coste de un falso positivo es una evidencia menos; el coste de un
   falso negativo es **contaminar la auditoría ciega**, que es irrecuperable
   porque la comparación ya no es ciega.
4. **Lo que no se puede verificar no pasa.** `filterBlindArtifactsAndFacts`
   devuelve `false` — es decir, **excluye** — para cualquier item que no tenga
   ni un `sourceRef` reconocible ni un par `(id, evidenceId)` consistente
   (`blind-evidence-sanitizer.ts:227-245`). La última rama del `filter` es
   `return false`, no `return true`. Ésa es la definición de fail-closed en una
   línea.

Y `assertBlindReferencesValid` (líneas 160-225) es la segunda capa: valida que
cada entrada del manifest tenga `artifactId` y `evidenceId` no vacíos, que un
`artifactId` no mapee a dos `evidenceId`, que cada artefacto tenga su par
coherente, que cada `sourceRef` de hecho resuelva a una evidencia permitida, que
los hashes declarados coincidan con `artifact.contentSha256`, y que cada
candidato tenga `evidenceRefs` **y** `artifactRefs` no vacíos. Cualquier fallo →
`BLIND_REFERENCE_INVALID`, que aborta con
`blindInputFailure('BLIND_INPUT_INVALID', …)`.

### 3.3 Las dos barreras, y por qué son dos

| | Barrera 1 — sanitización ciega | Barrera 2 — validación de referencias |
|---|---|---|
| Módulo | `blind-evidence-sanitizer.ts` | `extraction/evidence-reference-validation.ts` |
| Pregunta | ¿**qué** evidencia puede ver la evaluación ciega? | ¿**cada referencia** que el extractor produce es real, permitida y coherente? |
| Momento | antes de construir el input ciego | en la entrada del tool y en su salida |
| Criterio | `document_role` + heurísticas + densidad de keywords | existencia, pertenencia a la auditoría, `documentRole` en modo `BLIND`, `contentSha256`, `allowedEvidenceIds` |
| Aborta con | `BLIND_MANIFEST_INCOMPLETE`, `BLIND_REFERENCE_INVALID`, `BLIND_INPUT_INVALID` | `EXTRACTION_REFERENCE_INVALID`, `EXTRACTION_REFERENCE_INCOMPLETE` |

Son dos porque operate sobre cosas distintas y en momentos distintos. La barrera 1
responde "¿puede **entrar** esto?", y trabaja sobre metadatos de rol y heurísticas
de texto. La barrera 2 responde "¿**sale** esto bien?", y trabaja sobre
identificadores y hashes concretos. Un extractor podría citar, sin querer, un
artefacto que sí está permitido pero cuyo hash no coincide; la barrera 1 no lo
vería, porque no lleva hashes. Y un artefacto podría pasar la barrera 1 con un
rol correcto y contener un dictamen con una forma que ninguna heurística reconoce;
la barrera 2 no lo vería, porque no lee texto.

El manifest `BlindInputManifestV1` (`readonly Array<{ artifactId, evidenceId }>`)
es el contrato entre las dos: la barrera 1 decide qué se permite y produce el
manifest; la barrera 2 lo toma como lista blanca de pares autorizados. Un
`artifactId` que no esté en el manifest no tiene `evidenceId` válido, y por tanto
no puede ser referenciado.

### 3.4 Lo que la barrera no promete

- **No promete que la sanitización sea completa.** Las heurísticas son un filtro
  heurístico. Una evasión deliberada que no dispare ninguna de las cinco
  heurísticas ni dos keywords pasa. La barrera reduce la probabilidad; no la
  elimina.
- **No es una garantía criptográfica.** No hay firma, ni attestation, ni
  derivación de clave. Es un control estructural de pipeline.
- **No cubre el caso de las respuestas de la IA ciega.** La barrera filtra la
  **entrada**; si la IA produce una conclusión influenced por un nombre, una
  fecha o un tono del documento, eso no lo arregla ninguna de las dos barreras.

---

## 4. Las cuatro separaciones, resumidas

| Separación | Mecanismo | Tipo de garantía |
|---|---|---|
| `Extraction Tool != Policy Rule` | `.strict()` en los schemas, firewall recursivo de 7 campos, inspección del schema en `register()`, grafo de dependencias sin arista de `apps/web` a `packages/policy-engine` | runtime + compilación |
| `Fact Confidence != Decision Confidence` | `extractionConfidence` en el hecho; **no existe** `decisionConfidence`; la incertidumbre se expresa con enums y listas de reglas | tipos |
| `Evidence Completeness != Policy Outcome` | `UNKNOWN` nunca aporta soporte; `missingData`/`missingEvidence`/`softwareCoverageGaps`/`nextActions` en campos separados; envelope con bloques separados | tipos + lógica del motor |
| `System Failure != Indeterminate Policy Decision` | `EvaluationSystemReasonCode` vs `EvaluationReasonCode`; `system.reasonCodes` vs `decision.reasonCodes`; `isFoundationObjectMissing` no degrada errores de negocio | tipos + lógica de errores |
| Sanitización ciega fail-closed | exclusión por rol, heurísticas sólo restan, `filter` con `return false` por defecto, manifest como lista blanca entre las dos barreras | runtime |
| Motor shadow no autoritativo | `authoritative: false` y `source: 'DECLARATIVE_SHADOW'` como literales de tipo, runner `Object.freeze`d, sin método de persistencia, `evaluation: unknown` | tipos + runtime |

Ninguna de estas garantías depende de que alguien "sea cuidadoso". Todas están
en tipos, en schemas validados en runtime, en literales congelados o en la
lógica del motor. Ésa es la razón de que la frontera sea defendible: no es un
pacto social sobre qué no hacer, es una propiedad que el sistema verifica.

**Lo que esta frontera no cubre, y conviene decir:** el motor normativo sigue
teniendo once secciones sin formalizar en v5 (`softwareCoverageGaps`,
`index.ts:231-246`), y `GDM_GAM_PRD_MLG_003` sigue sin verificación formal
contra la fuente oficial del propietario. La frontera protege contra la
contaminación *arquitectónica*; no resuelve la brecha *normativa*, que es una
decisión del propietario y que en el Golden Master está marcada
`REQUIRES_OWNER_DECISION` (ver `docs/testing/golden-master.md` §6).
