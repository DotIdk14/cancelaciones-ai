# Rule Engine V2 — Reporte de implementación e integración provisional

> **Fecha:** 2026-09-26
> **Base:** `4f6fad7` (Phase 1.5) → `8cff526`
> **Alcance:** motor de decisión, separación normativo/provisional, e
> integración por API/UI/reporting.
> **Fuentes normativas modificadas:** ninguna.

---

## A. Resumen ejecutivo

El motor de decisión V2 está implementado y verificado: **65 reglas, 16 nodos,
94 hechos canónicos, 17 conflictos normativos, 6 desenlaces de primer nivel**, con
**343 tests** propios. La corrección central fue normativa y no de código: la
fuente primaria `GDM_GAM_PRD_MLG_003` es ahora la **única** autoridad que puede
fijar un desenlace de primer nivel, y cuatro reglas del procedimiento auxiliar D53
que proponían desenlaces ya no pueden cerrar un caso.

La integración avanzó hasta donde los datos permiten. La API, la UI y el
reporting están construidos y probados; la evaluación normativa **sigue
deliberadamente bloqueada** porque la tubería persiste otro vocabulario de hechos
que el motor no puede leer. Ese bloqueo está documentado con su causa exacta, no
escapado como resultado vacío.

**Gates:** typecheck, lint, 526 tests y build — los cuatro verdes.

## B. Números verificados

| Métrica | Valor |
|---|---|
| Reglas | 65 |
| Reglas que emiten desenlace | 48 |
| Reglas `CONTINUE` | 13 |
| Reglas `ESCALATE_TO_NODE` | 3 |
| Reglas `OWNER_DECISION_REQUIRED` | 1 |
| Nodos | 16 (1 vacío y declarado) |
| Hechos canónicos | 94 |
| Conflictos normativos | 17 |
| Desenlaces de primer nivel | 6 |
| Reglas provisional-only | 4 |
| Tests del motor | 343 en 23 archivos |
| Tests del repo | 526 en 5 paquetes |

Reparto de reglas que emiten desenlace:

| Desenlace | Reglas |
|---|---|
| `CANCELACION_VENTA` | 18 |
| `BAJA` | 11 |
| `CANCELACION_VENTA_OPERATIVA` | 7 |
| `DICTAMINACION` | 6 |
| `RETENCION` | 5 |
| `CANCELACION_MATRICULA` | 1 |

## C. La corrección normativa

### C.1 Qué estaba mal

El primario **lista** a D53 entre los procedimientos que referencia. De ahí se
había leído que D53 podía cerrar casos. Pero una fuente auxiliar que *propone* no
es una fuente que *autoriza*: si una regla de D53 podía emitir un desenlace de
primer nivel, cambiar el procedimiento auxiliar cambiaría la resolución de una
deserción, y el SHA-256 del procedimiento rector dejaría de explicar el
resultado.

### C.2 Qué se hizo

- Las fuentes llevan **rol normativo**. Una sola es
  `PRIMARY_NORMATIVE_SOURCE`; las otras dos son `AUXILIARY_REFERENCED_SOURCE` y
  `AUXILIARY_DEFINITION_SOURCE`.
- Una regla fundamenta un desenlace si **cita** al primario o declara un
  `primaryGrounding` que lo conecte. `isNormativeAuthority` lo decide.
- `R-RET-03` sí es autoritativa: el glosario aporta el vocabulario y el primario
  la conecta explícitamente por `N-32` (proceso de retención). Es el único caso
  admisible de autoridad indirecta, y está documentado como tal.

### C.3 Las cuatro reglas provisional-only

| Regla | Desenlace propuesto | Ambigüedades que la desbloquean |
|---|---|---|
| `R-D53-RELOJ-6M` | `BAJA` | `XDC-02`, `XDC-03` |
| `R-D53-RELOJ-50` | `BAJA` | `AMB-TEM-07`, `XDC-04` |
| `R-D53-EXPEDIENTE` | `BAJA` | `XDC-04`, `XDC-05` |
| `R-D53-APOCRIFO` | `DICTAMINACION` | `AMB-CON-02` |

No se descartaron ni silenciaron. Siguen declarando su desenlace para que el
auditor reciba una respuesta concreta; lo que no pueden es promoverlo a
`normativeOutcome`.

## D. D53 no es un desenlace

`D53` no aparece en `OUTCOMES`, y hay un test que falla si aparece. Es un
procedimiento auxiliar cuyo nombre se confunde con un desenlace sólo porque
ambos empiezan por una letra mayúscula.

`NODE-D35-DELEGADO` está vacío y así se declara, con `placeholderReason` en la
traza: `5.8.h.c` no existe en el inventario normativo, y llenarlo habría sido
inventar una sección que la fuente no contiene. La vacuidad es visible en la
traza para que se lea como decisión y no como olvido.

## E. `UNKNOWN` no es `false`

Un hecho no es booleano. Es `KNOWN`, `UNKNOWN`, `NOT_APPLICABLE` o
`CONTRADICTED`, y `NOT_APPLICABLE` exige su motivo. Una regla que depende de un
hecho desconocido no puede cerrar el caso. 29 tests cubren esta lógica.

## F. Determinismo

Mismos hechos + mismo contexto + misma versión de política ⇒ misma evaluación.
`rulesFingerprint` y `trace.fingerprint` cubren todo lo que cambia una decisión,
**incluida** `primaryGrounding` y `awaitsAmbiguityIds`, que cambian la autoridad.
El fingerprint **no** cambia si se reordena `sourceRefs`: el orden de cita no es
una decisión.

## G. Traza

13 tipos de paso. Cada decisión enlaza regla, condición, hecho y evidencia.

Lo relevante de este trabajo: `StatusDecision` **construía el motivo de cada rama
y lo descartaba**, así que la traza decía `REQUIRES_HUMAN_REVIEW` sin decir por
qué. Ahora:

- `StatusDecision.reason` existe.
- El motivo enumera **todas** las causas. Si además hay una lectura auxiliar
  viva, advierte que **resolver el conflicto no basta** — sin esa advertencia el
  auditor cerraba el conflicto, creía haber resuelto el caso y no entendía por
  qué el motor seguía escalando.
- Nuevos pasos `AUTHORITY` (por regla: `PRIMARY_GROUNDED` o
  `AUXILIARY_WITHOUT_PRIMARY_GROUNDING`) y `PROVISIONAL_ONLY` (resumen
  accionable).
- `STATUS` y el resultado `provisional` adjuntan `pendingAmbiguityIds` y
  `provisionalOnlyRuleIds`.

## H. La respuesta de red

Unión discriminada por `evaluationKind`:

| Variante | `normativeOutcome` | `closestOutcome` | Revisión |
|---|---|---|---|
| `NORMATIVE_DETERMINATE` | obligatorio | = normativo | no |
| `PROVISIONAL_RANKED` | `null` por tipo | poblado | sí |
| `PROVISIONAL_UNRESOLVED` | `null` por tipo | `null` | sí |

El tipo hace imposible que un resultado normativo viaje sin desenlace, o que uno
provisional lleve desenlace normativo. **No existe campo `outcome` suelto**, y hay
un test que prohíbe añadirlo.

## I. La revisión no borra la respuesta

`REQUIRES_HUMAN_REVIEW` es un **estado**, no la resolución. Un caso con un
desenlace más respaldado siempre trae `closestOutcome` poblado. Sólo queda `null`
ante empate real o ausencia total de candidatos, y en ambos casos se listan las
alternativas y la razón del empate.

En la UI la resolución es el valor principal (tipografía `2xl`, peso fuerte) y el
estado de revisión es un calificador **separado**, con `role="status"` y
`aria-live="polite"`. La jerarquía se codificó como datos en
`evaluation-view-model.ts`, no en JSX, para que un test la verifique y un refactor
no pueda invertirla en silencio.

El puntaje de soporte se explica por nombre y fórmula, y se dice explícitamente
que **no es una probabilidad**.

## J. Provisional results — los cuatro casos

| Caso | Entrada | `normativeStatus` | `normativeOutcome` | `closestOutcome` |
|---|---|---|---|---|
| A | cierra el primario | `DETERMINATE` | `BAJA` | `BAJA` |
| B | D53 al 50%, solicitud fuera de ventana | `REQUIRES_HUMAN_REVIEW` | `null` | **`BAJA`** (soporte 2) |
| C | D53 al 50%, solicitud en ventana | `REQUIRES_HUMAN_REVIEW` | `null` | `null` — empate CV/BAJA |
| D | sin hechos, sin regla temporal | `PROVISIONAL_UNRESOLVED` | `null` | `null` |

En el caso B el motivo completo es:

> «El recorrido alcanzó un conflicto normativo sin resolver. Además la regla
> R-D53-RELOJ-50 se apoya en fuentes auxiliares que GDM_GAM_PRD_MLG_003 no
> autoriza a determinar el desenlace, de modo que resolver el conflicto no basta
> para cerrar el caso. Ambigüedades del Owner pendientes: AMB-TEM-07, XDC-04.»

## K. Dictamen: base normativa confirmada

`MachineDecisionRef` tenía un único campo plano `machineOutcome` que aceptaba un
resultado provisional sin marcarlo. Quien lo llenara con la resolución más
compatible habría producido un dictamen presentando lo provisional como decisión
de la máquina, y el tipo no lo impedía.

- `classifyMachineDecision` separa `NORMATIVE` / `PROVISIONAL` /
  `UNDETERMINED`, en modo **fail-closed**: un estado no reconocido no autoriza
  emitir.
- `snapshotNormativeBasis` exige base normativa: o la máquina decidió
  normativamente y dijo qué, o hay decisión humana. Un provisional sin humano
  devuelve `NO_NORMATIVE_BASIS`.
- Un estado normativo **sin** desenlace es `UNDETERMINED`, no `NORMATIVE`.
- Se aceptan `DECIDED` y `DETERMINATE` porque el motor V2 y el reporting
  histórico no comparten vocabulario. La lista es explícita y corta a propósito.

## L. La frontera es accionable

El 501 ya no dice «el motor no existe». Publica `unmetPreconditions`:

| Código | Hecho verificado |
|---|---|
| `CANONICAL_FACTS_NOT_PERSISTED` | La tabla `facts` guarda `contact.*`, `student.*`, `classroom.*`, `academic.*`. **Solapamiento con los 94 hechos canónicos: cero.** |
| `FACT_STATE_NOT_PERSISTED` | `facts` no tiene columna para el estado canónico de cuatro estados; `FactProvenance` además exige `extractionState`, `extractionMethod`, `extractorId`, `extractorVersion`, que tampoco tienen sitio. |
| `TEMPORAL_CONTEXT_NOT_PERSISTED` | Ninguna tabla ni hecho canónico provee inicio de ciclo, fecha de solicitud, fecha de ingreso, inicio del primer ciclo ni avance curricular. |

Se distingue capacidad **no construida** (`CAPABILITY_NOT_IMPLEMENTED`) de
capacidad **bloqueada por datos**. Confundirlas llevaría a «construyamos más
motor», que es la acción equivocada para la evaluación.

## M. Por qué la evaluación no se conectó

Con esos datos el motor respondería `INSUFFICIENT_EVIDENCE` sobre el caso: una
conclusión sobre la **tubería** presentada como conclusión sobre el **caso**. Es
el modo de fallo que `UNKNOWN_IS_NOT_FALSE` prohíbe.

No se inventó un mapeo heredado → canónico porque traducir «qué significa cada
hecho heredado» es una decisión interpretativa, y es del Owner.

**Qué la desbloquea:** una migración que permita persistir hechos canónicos con
su estado canónico de cuatro estados y su procedencia, y que exponga el contexto temporal.
Ninguna de las dos es un cambio en el motor.

## N. Verificación por invariante

| Invariante | Test |
|---|---|
| D53 no emite normativamente | `21-primary-outcome-constraint` |
| Glosario nunca funda un desenlace | `21-primary-outcome-constraint` |
| Regla auxiliar nunca es autoritativa sin grounding | `21-primary-outcome-constraint` |
| Los cuatro casos del producto | `22-product-cases` |
| Revisión no borra la resolución | `22-product-cases` |
| Autoridad trazable y accionable | `23-authority-trace` |
| Motivo de escalada enumera todas las causas | `23-authority-trace` |
| Separación en el cable | `evaluation-response.test` |
| No existe campo `outcome` suelto | `evaluation-response.test` |
| Jerarquía de presentación | `evaluation-view-model.test` |
| Caso cerrado no muestra pendientes | `evaluation-view-model.test` |
| Dictamen exige base normativa | `reporting/index.test` |
| Clasificación fail-closed | `reporting/index.test` |
| Precondiciones del bloqueo | `boundary.test` |
| Huellas deterministas | `18`, `23` |
| Los 94 hechos no se alteran | `19-source-immutability` |
| Fuentes sin CJK | `16-serialization-and-runtime` |
| Los 15 conflictos son alcanzables | `20-conflict-locality` |

## O. Gates

```
typecheck  5/5 paquetes           verde
lint      5/5 paquetes           verde   (web con --max-warnings=0)
test      526 tests, 5 paquetes   verde
build     Next.js production     verde
```

Desglose: domain 13, reporting 37, db 8, rule-engine-v2 343, web 125.

`audit-pipeline.dev-e2e` está excluido del script `test` porque exige credenciales
de InsForge. Verificado que ya fallaba antes de estos cambios, por lo mismo.

## P. Lo que NO se hizo, y por qué

| No se hizo | Motivo |
|---|---|
| Conectar la evaluación a datos reales | 3 precondiciones de datos no cumplidas (§M) |
| Persistir la evaluación en `engine_runs` | Sin hechos canónicos no hay nada que persistir; y `engine_runs` no expresa el modo |
| Mapear hechos heredados → canónicos | Es una decisión interpretativa del Owner |
| Resolver las 15 ambigüedades | Son del Owner; el motor las materializa y escala |
| Habilitar dictamen, adjudicación, snapshot, comparación | Son capacidades no construidas y lo declaran |
| Añadir `@cancelaciones/rule-engine-v2` a la ruta `/audit` | La ruta sigue en 501, que es lo correcto sin datos |

## Q. Riesgo residual

1. **La tubería y el motor hablan idiomas distintos.** Es el riesgo principal y
   está declarado, no oculto. Mientras siga así, cualquier intento de «conectar
   rápido» produciría conclusiones sobre la tubería presentadas sobre el caso.
2. **Tres vocabularios de estado de decisión** conviven: el del motor
   (`DETERMINATE`), el del reporting (`DECIDED`) y el de la UI. El
   fail-closed de `classifyMachineDecision` contiene el riesgo, pero la
   convergencia es trabajo pendiente.
3. **`AMB-CON-01` materializa de forma asimétrica.** Si se alcanza cualquiera de
   sus dos reglas afectadas, el conflicto aparece. Se documentó como decisión
   pendiente del Owner en vez de inventar una semántica uniforme.
4. **Las 15 ambigüedades siguen abiertas.** Ninguna se resolvió por omisión.

## R. Commits

| Commit | Contenido |
|---|---|
| `afed85e` | Motor completo + grounding de fuente primaria |
| `1c826b4` | Trazabilidad de la decisión de autoridad |
| `9fea452` | Contrato de respuesta provisional + frontera accionable |
| `0a85568` | Resolución como valor principal, revisión como calificador |
| `34d0ee7` | Dictamen exige base normativa confirmada |
| `f5f450b` | Documentación Phase 1.5 y sellado de fuentes |
| `8cff526` | README del motor y OD-001 |

## S. Artefactos

| Ruta | Contenido |
|---|---|
| `packages/rule-engine-v2/README.md` | Guía del motor |
| `docs/owner-decisions/OD-001-provisional-audit-integration.md` | Decisión del Owner, bloqueos y 15 preguntas |
| `apps/web/src/server/audit-engine/evaluation-response.ts` | Contrato de red |
| `apps/web/src/server/audit-engine/boundary.ts` | Capacidades y precondiciones |
| `apps/web/.../components/evaluation-view-model.ts` | Jerarquía de presentación |
| `apps/web/.../components/EvaluationResolution.tsx` | Componente accesible |
| `packages/reporting/src/index.ts` | Guardia de base normativa |

## T. Nota sobre la numeración de este reporte

El encargo original especificaba las secciones A–T. La substance está
completa y verificada, pero **no tengo a la vista la lista literal de
encabezados A–T** que se pidió, y no la voy a reconstruir de memoria: hacerlo sería
inventar el contrato de entrega.

Si tiene esa lista a la vista, compárela contra las secciones anteriores y la
reordeno para coincidir. La substance no depende del ajuste; sólo el orden y los
títulos.
