# OD-001 — Integración provisional de la auditoría y límites de la fuente primaria

> **Estado:** `ACCEPTED_FOR_IMPLEMENTATION` con bloqueos declarados.
> **Fecha:** 2026-09-26
> **Alcance:** track de integración provisional. **No** modifica los artefactos
> congelados de Phase 1.5 ni el informe de esa fase.
> **Ámbito normativo:** ninguna. Este documento registra una decisión de
> *operación del producto*, no una regla normativa
> (`OPERATIONAL_PRECEDENCE_IS_NOT_POLICY`).

## 1. Contexto

El árbol de decisión V2 está implementado y verificado: 65 reglas, 16 nodos, 94
hechos, 17 conflictos, 343 tests en 23 archivos. Separate normativo de provisional
es una máquina de estados, no una convención: el motor no puede promover a
`normativeOutcome` un desenlace cuya regla se apoya sólo en una fuente auxiliar.

Lo que faltaba era la INTEGRATION: que el resultado llegue al auditor por API, se
muestre en la UI y no pueda convertirse en dictamen por error.

## 2. Decisiones

### OD-001.1 — La fuente primaria es la única autoridad de desenlace

`GDM_GAM_PRD_MLG_003` puede fijar un desenlace de primer nivel. D53
(`GDM_GAM_PRD_MXL_008`) es fuente auxiliar referenciada y el Glosario es fuente
auxiliar de definición. **D53 no es un desenlace de primer nivel** y su nombre no
aparece en el catálogo `OUTCOMES`.

*Consecuencia:* cuatro reglas de D53 que proponían desenlaces
(`R-D53-RELOJ-6M`, `R-D53-RELOJ-50`, `R-D53-EXPEDIENTE`, `R-D53-APOCRIFO`) nunca
pueden cerrar un caso. Siguen declarando su desenlace para que el auditor reciba
una respuesta concreta, y el estado escala a `REQUIRES_HUMAN_REVIEW`.

*Consecuencia:* `R-RET-03` sí es autoritativa, con grounding explícito en `N-32`
(el proceso de retención del primario). El glosario sólo aporta vocabulario.

### OD-001.2 — La revisión humana es un estado, no la resolución

`REQUIRES_HUMAN_REVIEW` **no** sustituye a la resolución. Un caso con un
desenlace más respaldado devuelve siempre `closestOutcome` poblado junto al
estado de revisión. Un `REQUIRES_HUMAN_REVIEW` sin candidato sólo ocurre cuando
hay empate real o no hay nada que ordenar, y en ambos casos se listan las
alternativas.

*Consecuencia:* la UI presenta la resolución como valor principal y el estado de
revisión como calificador separado. El orden es fijo y está codificado en
`evaluation-view-model.ts`, no en el JSX.

### OD-001.3 — La respuesta de red no admite confusión

La respuesta es una unión discriminada por `evaluationKind`:
`NORMATIVE_DETERMINATE`, `PROVISIONAL_RANKED`, `PROVISIONAL_UNRESOLVED`. El tipo
hace imposible que un resultado normativo viaje sin desenlace, o que uno
provisional lleve desenlace normativo. No existe campo `outcome` suelto.

### OD-001.4 — Un dictamen exige base normativa confirmada

`Dictamen.pdf` sólo se emite si la máquina decidió normativamente **y** dijo
qué decidió, o si existe decisión humana registrada. Un resultado provisional de
la máquina sin decisión humana se rechaza con `NO_NORMATIVE_BASIS`. La
clasificación es *fail-closed*: un estado no reconocido no autoriza emitir.

### OD-001.5 — La evaluación normativa sigue bloqueada, y el bloqueo lo declara

Las cuatro capacidades que dependían de ejecución normativa siguen lanzando
`501 AUDIT_ENGINE_NOT_IMPLEMENTED`. El 501 ahora publica `unmetPreconditions`,
de modo que es una lista de trabajo y no un misterio.

## 3. Bloqueos declarados (no son fallos del motor)

Verificados por inspección de la tubería real, no supuestos:

| Código | Hecho verificado | Efecto |
|---|---|---|
| `CANONICAL_FACTS_NOT_PERSISTED` | La tabla `facts` guarda el vocabulario heredado (`contact.*`, `student.*`, `classroom.*`, `academic.*`). **Solapamiento con los 94 hechos canónicos: cero.** | El motor no tiene insumo. |
| `FACT_STATE_NOT_PERSISTED` | `facts` no tiene columna para el estado canónico de cuatro estados. `FactProvenance` además exige `extractionState`, `extractionMethod`, `extractorId`, `extractorVersion`, que tampoco tienen sitio. | Una revisión `NOT_APPLICABLE` / `CONTRADICTED` no se persiste ni se reproduce. |
| `TEMPORAL_CONTEXT_NOT_PERSISTED` | Ninguna tabla ni hecho canónico provee inicio de ciclo, fecha de solicitud, fecha de ingreso, inicio del primer ciclo ni avance curricular. | Las ventanas del primario no se pueden calcular. |

**Por qué no se ejecutó de todos modos.** Con esos datos, el motor respondería
`INSUFFICIENT_EVIDENCE` sobre el caso, que es una conclusión sobre la **tubería**
presentada como conclusión sobre el **caso**. Es el modo de fallo que
`UNKNOWN_IS_NOT_FALSE` prohíbe, y por eso la evaluación no se conecta.

**Por qué no se inventó un mapeo.** Traducir el vocabulario heredado a hechos
canónicos es una decisión interpretativa sobre qué significa cada hecho. Eso es
del Owner, no del código.

**Qué se necesita para desbloquear.** Una migración que (a) permita persistir
hechos canónicos con su estado canónico de cuatro estados y su procedencia, y (b) exponga
el contexto temporal. Ninguna de las dos es un cambio en el motor.

## 4. Vocabulario de estados

El motor usa `DETERMINATE` / `INSUFFICIENT_EVIDENCE` / `REQUIRES_HUMAN_REVIEW`.
El reporting histórico usa `DECIDED`. `classifyMachineDecision` acepta ambos
estados normativos y trata cualquier otro como no normativo. La lista es
explícita y corta a propósito: ante la duda, no autorizar.

## 5. Las 15 preguntas al Owner siguen abiertas

`docs/policy-v2/ambiguities.md` §14 registra las quince. **Ninguna se ha
resuelto, y el motor no las resuelve por omisión.** Cada una que afecta a un
camino alcanzado se materializa como `PolicyConflict` en la traza, escala el caso
y nombra la ambigüedad pendiente.

| # | Pregunta | ID | ¿Afecta un desenlace? |
|---|---|---|---|
| 1 | Ventana de CV | `XDC-01` | Sí — `CANCELACION_VENTA` |
| 2 | Plazo de la carta compromiso (2 vs 6 meses) | `XDC-02` | Sí — `BAJA` vía D53 |
| 3 | Anclaje del plazo de 6 meses | `XDC-03` | Sí — `BAJA` vía D53 |
| 4 | Duración de un bimestre | `XDC-04` | Sí — `BAJA` vía D53 |
| 5 | ¿El 50% de avance sigue vigente? | `AMB-TEM-07` | Sí — `BAJA` vía D53 |
| 6 | Documentos del expediente completo | `XDC-05` | Sí — `BAJA` vía D53 |
| 7 | ¿Carta manifiesto = carta compromiso? | `XDC-09` | Sí |
| 8 | Polaridad de 3 niveles en `5.8.a` | `AMB-LOG-02` | Sí |
| 9 | Prevalencia `N-46` sobre `N-52` | `AMB-CON-03` | Sí |
| 10 | Ruta de escalamiento de `5.6.f` | `AMB-CON-02` | Sí — `DICTAMINACION` |
| 11 | Prevalencia `N-33` sobre `N-27` | `AMB-CON-01` | Sí |
| 12 | Reglas divergentes México / LATAM | `AMB-CON-05` | Sí |
| 13 | Estándar probatorio de «de manera tácita» | `AMB-CON-04` | Sí |
| 14 | «Decisión 35 en tiempo y forma» | `AMB-EXT-04` | Sí — nodo vacío |
| 15 | Doble definición de deserción | `AMB-TEM-05` | Sí |

**Nota sobre `NODO-D35-DELEGADO`:** el nodo está vacío y así se declara. `5.8.h.c`
no existe en el inventario normativo, y no se inventaron reglas para llenarlo.
El nodo aparece en la traza con `placeholderReason` para que su vacuidad sea
visible y no un olvido.

## 6. Lo que este documento NO decide

- No resuelve ninguna de las quince ambigüedades.
- No autoriza a D53 a emitir desenlaces.
- No modifica `GDM_GAM_PRD_MLG_003` ni ninguna fuente.
- No habilita la evaluación normativa contra datos reales: §3.
- No habilita dictamen, adjudicación, snapshot de reporte ni comparación humana;
  esas capacidades siguen sin construirse y lo declaran.

## 7. Cómo se verifica

| Invariante | Dónde |
|---|---|
| D53 no emite normativamente | `src/tests/21-primary-outcome-constraint.test.ts` |
| Los cuatro casos del producto | `src/tests/22-product-cases.test.ts` |
| Autoridad trazable y accionable | `src/tests/23-authority-trace.test.ts` |
| Separación en el cable | `apps/web/.../evaluation-response.test.ts` |
| Jerarquía de presentación | `apps/web/.../evaluation-view-model.test.ts` |
| Dictamen exige base normativa | `packages/reporting/src/index.test.ts` |
| Precondiciones del bloqueo | `apps/web/.../boundary.test.ts` |
