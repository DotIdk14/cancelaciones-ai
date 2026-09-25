# Diseño: Policy Foundation Remediation

## Estado

Aprobado por el propietario el 2026-09-24.

## Objetivo

Preparar los fundamentos técnicos de evidencias, facts, provenance, frozen fact runs, snapshots inmutables, herramientas de extracción y shadow engine sin cambiar la autoridad normativa ni el comportamiento productivo de `evaluatePolicy` y `v5Rules`.

## Invariantes

- `GDM_GAM_PRD_MLG_003` permanece como autoridad normativa.
- Ninguna fuente normativa se busca, infiere ni corrige en internet.
- Las discrepancias normativas se reportan como `REQUIRES_OWNER_DECISION`.
- `evaluatePolicy` y `v5Rules` permanecen sin cambios normativos.
- Los Golden Masters congelan comportamiento técnico actual, no verdad normativa.
- Un Golden Master nunca se actualiza automáticamente para ocultar divergencias.
- Un Fact Run `FROZEN` es irreversible.
- Toda corrección humana crea otro Fact Run con `parentFactRunId` y motivo de derivación.
- Un `AI_DECISION_V1` completado es append-only.
- El fingerprint canónico identifica la entrada; el hash de integridad acredita el snapshot completo.
- El sanitizer blind es fail-closed y precede a cualquier extracción.
- `validateEvidenceReferences()` actúa como segunda barrera después del sanitizer.
- Extraction Tools sólo producen facts y provenance.
- Ninguna Extraction Tool, OpenRouter o shadow result entra al pipeline productivo en esta fase.
- El shadow engine es explícitamente no autoritativo y no puede escribir ni sustituir resultados oficiales.
- El flujo legacy se conserva y se aísla; no se elimina.
- La Dictamen.pdf conserva su rol de plantilla canónica.

## Arquitectura

La remediación será un monolito modular progresivo. Cada capacidad tendrá una implementación única y reutilizable:

```text
EVIDENCE LAYER
  -> EXTRACTION TOOLS
  -> FACT CANDIDATES + PROVENANCE
  -> FROZEN FACT RUN
  -> CURRENT POLICY ENGINE
  -> APPEND-ONLY DECISION SNAPSHOT
  -> HUMAN REVIEW / RECONCILIATION / ADJUDICATION
```

Los contratos nuevos estarán desacoplados de React, Next.js, InsForge, OpenRouter y HTTP donde sea posible. Los adaptadores de aplicación conservarán compatibilidad progresiva con los contratos actuales.

## Componentes

### Canonical Policy Source Registry

El registro técnico identificará `policyCode`, `policyVersion`, `documentId`, SHA-256, vigencia, estado, verificador, fecha de verificación y notas. El PDF/hash no confirmado por OWNER se registrará como `PENDING_VERIFICATION`; no se declarará `CANONICAL` por intuición.

Los contratos de referencia enlazarán:

| Concepto | Campos |
|---|---|
| Referencia de regla | `policyCode`, `policyVersion`, `documentId`, `section`, `page`, `citation` |
| Estado | `CANONICAL`, `LEGACY`, `PENDING_VERIFICATION`, `SUPERSEDED` |

No se completarán citas ni hashes de reglas actuales sólo para poblar el registro.

### Golden Master

Los casos sintéticos capturarán la salida completa del motor actual: evaluación, reglas, condiciones, estados, missing facts, missing evidence, outcomes, review status, next actions, trace y fingerprints. Incluirán casos completos, incompletos, UNKNOWN, colecciones PARTIAL, 5.2, 5.7.e, ramas 5.8.a, conflictos y coverage gaps.

El corpus no incluirá expedientes reales. Una divergencia normativa se registra y bloquea; no se corrige automáticamente.

### Facts y provenance

El contrato `ExtractedFactV1` representará un `factType`, `value`, `state`, `confidence` cuando aplique y un arreglo completo de provenance. Los estados serán:

- `OBSERVED`
- `INFERRED`
- `UNKNOWN`
- `CONTRADICTORY`

La provenance preservará evidence ID, artifact ID, hash, página, timestamps, source text, método de extracción, extractor ID y versión, además de confianza cuando exista.

`missing`, `unknown` y `not observed` nunca se convertirán en `false`.

### Fact Runs inmutables

La transición a `FROZEN` se hará por una operación controlada. Después del freeze:

- facts, provenance, hashes y policy source no podrán modificarse;
- las revisiones humanas no cambiarán el conjunto efectivo del run original;
- una corrección producirá un nuevo Fact Run;
- el run derivado registrará `parentFactRunId`, `derivationReason`, `createdAt` y `createdBy`;
- el snapshot congelado quedará vinculado al motor y a la decisión que lo consumió.

Las invariantes críticas se implementarán mediante constraints, triggers, RLS y funciones controladas, no únicamente en TypeScript.

### AI_DECISION_V1

La primera decisión machine/blind se persistirá como snapshot append-only con:

- audit y Fact Run;
- policy code, version y source ID;
- engine, prompt y extractor versions;
- provider y model;
- input fingerprint;
- decision snapshot;
- rule trace snapshot;
- evidence snapshot;
- timestamp de creación;
- hash de integridad de contenido relevante.

El hash no truncará campos ni omitirá metadatos de identidad. Una nueva ejecución generará una nueva versión/run. No habrá actualización del resultado V1.

La revisión humana podrá compararse con V1, corregir hechos en un Fact Run derivado y producir reconciliation/adjudication separada. No alterará V1.

### Evaluation envelope

`AuditEvaluationEnvelopeV1` separará:

- `decision`;
- `evidence`;
- `policy`;
- `system`;
- `review`.

Distinguirá al menos `NO_POLICY_OUTCOME`, `MISSING_EVIDENCE`, `CONTRADICTORY_EVIDENCE`, `POLICY_COVERAGE_GAP`, `MISSING_NORMATIVE_SOURCE`, `MODEL_ERROR`, `PARSING_ERROR`, `SCHEMA_ERROR`, `PERSISTENCE_ERROR` y `HUMAN_REVIEW_REQUIRED`.

`PolicyEvaluation` seguirá disponible mediante adapter. La envelope no alterará por sí sola la semántica del motor actual.

### Extraction Tool Contract

Cada tool tendrá ID estable, versión, schema de input, schema de output, versión de schemas y flag deterministic. La ejecución validará input y output, producirá provenance, distinguirá UNKNOWN, validará evidence references y rechazará campos normativos.

La salida permitida será un contenedor de facts. Quedarán prohibidos `outcome`, `suggestedOutcome`, `decision`, `resolution`, `ruleId`, `matchedRule` y `policyDecision` en outputs de tools.

El contrato LLM futuro almacenará provider, model, prompt version, tool version, input fingerprint, raw response fingerprint, structured output, confidence y provenance. La salida del modelo se tratará como no confiable hasta superar schema y provenance validation. OpenRouter no se conectará en esta fase.

### Extraction Tool Registry

El registry permitirá `get`, `list` y `execute`, y registrará tool ID, versión, determinismo y versiones de schemas. Será pequeño y local, sin framework adicional.

Se implementarán sólo tools shadow/test:

- `extract_dates`: lectura determinista de fechas estructuradas;
- `extract_contact_attempts`: reutilización de normalización determinista existente cuando sea razonable.

No se sustituirá el pipeline productivo.

### Evidence Reference Validation

`validateEvidenceReferences()` comprobará:

- existencia del evidence ID;
- artifact ID válido cuando aplique;
- pertenencia a la auditoría;
- permiso de uso por la ejecución;
- exclusión de artifacts `HUMAN_DECISION` en una ejecución blind;
- correspondencia de hashes y provenance cuando aplique.

Una referencia inventada o no permitida se rechazará.

### Blind Sanitization

El flujo será:

```text
RAW ARTIFACTS
  -> BLIND SANITIZER
  -> ALLOWED MANIFEST
  -> EXTRACTION
```

Si falta un manifest, una referencia no puede asignarse al artifact, o el sanitizer no puede resolver una entrada, la ejecución blind fallará cerrada. Los artifacts de decisión humana quedarán excluidos antes de interpreter, reasoner o grafo.

### Fingerprints

Se definirá canonicalización versionada que excluya IDs de ejecución, `Date.now()`, `new Date()` y `createdAt` generados cuando no formen parte de la evidencia original.

La misma entrada canónica, versión de extractor y versión de policy producirán el mismo input fingerprint, aunque cambien execution IDs y timestamps operativos.

El hash de integridad será posterior y cubrirá el snapshot completo.

### Shadow Engine

Se definirá una interfaz mínima `ShadowPolicyEngine` y un resultado marcado como no autoritativo. No tendrá repositorio de resultados oficiales, acceso de escritura a snapshots ni pathway hacia API/UI oficial.

No se migrarán reglas ni se ejecutará un motor declarativo productivo.

## Persistencia DB

Las migraciones serán forward-only e idempotentes donde corresponda. No borrarán datos ni reescribirán decisiones históricas.

Entre las protecciones esperadas:

- triggers que rechacen mutaciones de facts, provenance, snapshots y decisiones completadas;
- transiciones válidas hacia `FROZEN`;
- bloqueo de UPDATE/DELETE para registros append-only;
- RLS y funciones de escritura específicas;
- hashes completos y constraints de unicidad e idempotencia;
- separación entre Fact Runs y derivaciones humanas;
- rollback lógico documentado sin borrar historia.

Las migraciones se aplicarán y validarán en InsForge DEV. La validación E2E comprobará RLS, append-only, transiciones freeze y separación de correcciones.

## Golden Master y regresión

La equivalencia comparará la salida completa, no sólo outcome. Cualquier cambio en outcome, trace, rule status, conditions, missing data, coverage o next action será regresión hasta demostrar autorización normativa explícita.

`evaluatePolicy` y `v5Rules` no se modificarán. Las divergencias normativas conocidas, especialmente 5.2, 5.7.e y 5.8.a, permanecerán reportadas y bloqueadas.

## Pruebas

Se aplicará TDD para:

- FROZEN no mutable;
- corrección humana crea Fact Run derivado;
- `AI_DECISION_V1` no sobrescribible;
- provenance completa;
- missing evidence distinto de false;
- tool no puede emitir outcome normativo;
- evidence ID inventado rechazado;
- artifact humano excluido antes de extracción;
- sanitizer fail-closed;
- mismo input produce mismo fingerprint;
- artifact produce facts y provenance;
- stable output del Golden Master;
- shadow engine no oficial;
- RLS y append-only en InsForge DEV.

Se corregirán los errores TypeScript preexistentes de los tests E2E sin cambiar sus objetivos de cobertura.

## Documentación

Se actualizarán o crearán:

- `docs/architecture/fact-immutability.md`;
- `docs/architecture/ai-decision-snapshots.md`;
- `docs/architecture/extraction-tools.md`;
- `docs/architecture/policy-boundary.md`;
- `docs/testing/golden-master.md`.

Quedará explícito:

```text
Extraction Tool != Policy Rule
Fact Confidence != Decision Confidence
Evidence Completeness != Policy Outcome
System Failure != Indeterminate Policy Decision
```

## Validación final

Se ejecutará:

```bash
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

También se validarán migraciones y E2E/RLS en InsForge DEV. El reporte final registrará evidencia PASS/FAIL/BLOCKED sin declarar PASS no demostrado.

## Rollout

La remediación se entregará primero para revisión. No se continuará automáticamente con `EXTRACTION TOOLS + DECLARATIVE SHADOW ENGINE`.

## Criterios de terminación

- Foundation implementada sin cambiar outcomes del motor actual.
- Invariantes críticas de freeze y snapshots también en DB.
- Herramientas y shadow engine fuera del pipeline productivo.
- Migraciones aplicadas y validadas en InsForge DEV.
- Golden Master estable y regresión completa en verde o con fallos preexistentes explícitamente aislados.
- Documentación y reporte final completos.
- Ningún gap normativo resuelto silenciosamente.
