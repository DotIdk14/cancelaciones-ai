# Phase Prompt — Decision Tree, Phase 2: Resolución de Ambigüedades y Motor Puro

**Status:** `GENERATED_NOT_EXECUTED`. Este documento es un prompt, no una
implementación.
**Precondition:** Phase 1 está completa y commiteada.
**Do not implement this prompt until the owner explicitly starts Phase 2 AND
resolves the blocking ambiguities listed in §2.**

---

## Objective

Convertir la base normativa de Fase 1 en un **motor determinista, puro y
testeable**, después de que el Owner haya resuelto por escrito las **14
ambigüedades bloqueantes** que Fase 1 registró.

Phase 1 produjo:

| Artefacto | Contenido |
|---|---|
| `docs/policy-v2/source-lock.md` | Bloqueo de fuente; SHA-256; procedencia |
| `docs/policy-v2/normative-inventory.md` | 139 enunciados transcritos con página verificada |
| `docs/policy-v2/fact-catalog.md` | 125 hechos con cita; 4 centinelas; 3 conectivas |
| `docs/policy-v2/decision-tree.md` | 19 ramas, 6 desenlaces, 4 filtros de prevalencia |
| `docs/policy-v2/ambiguities.md` | 28 ambigüedades, 14 bloqueantes |
| `docs/policy-v2/coverage-matrix.md` | 10 huecos declarados; 2 secciones `NOT_COVERED` |

---

## Precondición absoluta: las 14 ambigüedades bloqueantes

**No se puede iniciar la implementación del motor** hasta que el Owner registre
una decisión para cada una. Cada decisión debe citar documento, versión, sección
y fecha, conforme a la regla de trabajo del proyecto.

| # | ID | Pregunta que el Owner debe responder |
|---|---|---|
| 1 | `AMB-CON-01` | ¿`N-33` (falta de retención → baja) prevalece sobre `N-27` (solicitud previa al inicio → CV)? |
| 2 | `AMB-CON-02` | En 5.6.f, ¿rige la ruta de `N-57` (comité de 4 áreas) o la de `N-58` (Mejora Continua)? |
| 3 | `AMB-CON-03` | ¿`N-52` (sin evidencias → CV) requiere además cumplir los 3 requisitos de `N-46`? |
| 4 | `AMB-CON-04` | ¿Qué criterio separa `CANCELACION_VENTA` de `BAJA` en ajuste administrativo, y qué evidencia acredita la «expresión tácita»? |
| 5 | `AMB-NUM-01` | ¿Cuál es el número de contacto vigente y cuál es su relación con los tres de 5.2.g? |
| 6 | `AMB-NUM-02` | ¿Cuál es el intervalo que colapsa 2+ marcaciones en una sola interacción? |
| 7 | `AMB-LOG-01` | ¿Los mínimos de 16 llamadas y 6 interacciones escritas se acumulan (`AND`) o son alternativos (`OR`)? |
| 8 | `AMB-LOG-04` | ¿`5.8.h` sustituye, complementa o alterna con el criterio de `N-69`? |
| 9 | `AMB-TEM-01` | ¿Cuál es el orden de prevalencia de los 7 umbrales temporales? |
| 10 | `AMB-TEM-02` | ¿«cualquier solicitud» de `N-35` incluye las solicitudes de CV por causal de negocio? |
| 11 | `AMB-TEM-06` | ¿Qué límite temporal aplica a cada causal dentro de la ventana de 2 semanas? |
| 12 | `AMB-EXT-01` | ¿Puede incorporarse el Glosario de operación escolar a la fuente? |
| 13 | `AMB-EXT-02` | ¿Pueden incorporarse la descripción de actividades y el diagrama de flujo? |
| 14 | `AMB-EXT-04` | ¿Pueden incorporarse el Anexo 5 y la definición de «decisión 35 en tiempo y forma»? |

**Prohibición:** si una decisión se implementa como default de código, constant
o comentario, la ambigüedad **no** está resuelta. Se maquilla de determinista y
sigue siendo una `REQUIRES_OWNER_DECISION`.

---

## Non-negotiable constraints

Se heredan de `docs/phase-prompts/rebuild-decision-tree-phase-1.md` y siguen
vigentes. Si una implementación los contradice, se detiene y se reporta.

1. **Única fuente normativa**:
   `normative/GDM_GAM_PRD_MLG_003  PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES.docx.pdf`
   (SHA-256 `71faf64634805b1b4820132cdfcc1304d740ff00d1e9573dd850222c9496c7d2`,
   versión 5, 26 páginas). Nada más define política.

2. **No reintroducir** (retirado y verificado por los gates del clean slate):
   - `CANCELACION_*` outcomes como enum fijo de 3
   - `NON_LICENCIATURA`
   - `ShadowPolicyResult` / `DECLARATIVE_SHADOW`
   - conjunto cerrado de exactamente 3 reglas
   - `policy_code`/`policy_version` como identificador de regla
   - `engine_runs`, `engine_rule_results`, `audit_evaluation_envelopes` como
     destinos de escritura

3. **`UNKNOWN` no es `FALSE`.** Toda condición evalúa a `TRUE`, `FALSE` o
   `UNKNOWN`, y el agregador propaga.

4. **La IA extrae; el motor decide.** Sin excepciones.

5. **Cada regla cita exactamente:** documento, versión, sección, página
   **verificada**. Fase 1 verificó las 26 páginas; la deriva de página del motor
   legacy fue de 2 y 3 páginas.

6. **El motor es puro.** Determinista, testeable, desacoplado de React,
   Next.js, InsForge, OpenRouter, AssemblyAI, sistema de archivos y HTTP. La
   base normativa debe cargarse sin ninguno de ellos.

7. **Ninguna precedencia operacional presentada como política.** Toda
   prioridad aprobada por el Owner se almacena y se muestra separada, con su
   propia procedencia.

8. **Trazar cada decisión:** regla, condición, hecho, referencia de evidencia. Un
   resultado que no nombre su cita no es publicable.

---

## Tasks

### Task 1 — Resolver y versionar las decisiones del Owner

Para cada una de las 14 ambigüedades bloqueantes:

1. Abrir la sección correspondiente de `docs/policy-v2/ambiguities.md`.
2. Registrar la decisión en un documento nuevo:
   `docs/policy-v2/owner-decisions.md` con columnas: ambigüedad, decisión,
   documento, versión, sección, página, fecha, firmante.
3. Marcar la ambigüedad como `RESOLVED` **en `ambiguities.md`**, conservando el
   texto original de las lecturas soportadas. No se borra la ambigüedad: se
   documenta su resolución.
4. Separar explícitamente la decisión del Owner de la fuente normativa, para
   satisfacer `OPERATIONAL_PRECEDENCE_IS_NOT_POLICY`.

**Las 14 ambigüedades no bloqueantes** (`AMB-NUM-03`, `AMB-LOG-02`, `03`, `05`,
`AMB-TEM-03`, `04`, `05`, `AMB-EXT-03`, `05`, `AMB-GAP-01`, `02`, `03`,
`AMB-REF-01`, `AMB-DEF-01`) se resuelven o se registran como tales, pero **no
bloquean** el inicio si el Owner lo decide explícitamente. `AMB-TEM-03` ya es
resoluble por lectura del texto.

### Task 2 — Construir la base normativa como datos puros

Convertir el inventario en un artefacto cargable sin dependencias:

```
packages/normative/src/source/gdm-gam-prd-mlg-003.v5.json
```

Estructura mínima por enunciado:

```ts
interface NormativeStatementV1 {
  id: string;                    // 'N-45', derivado de la sección, no inventado
  section: string;               // '5.6.a', tal como está impreso
  page: number;                  // VERIFICADO contra el PDF
  pageSpan?: [number, number];   // p.ej. 5.6.f cruza de la 10 a la 11
  type: 'condition' | 'exception' | 'counterevidence' | 'requirement'
      | 'definition' | 'procedure' | 'temporal' | 'scope' | 'indicator';
  verbatim: string;              // texto exacto, erratas preservadas (TR-01..TR-09)
  dependsOn: string[];
  factIds: string[];             // hechos del catálogo que esta regla consume
  ambiguityIds: string[];        // ambigüedades que bloquean su evaluación
}
```

Reglas duras:

- `verbatim` **no** se corrige. Las 9 erratas del original (`TR-01`…`TR-09`) se
  preservan con su marca.
- `section` es el identificador impreso, **no** un índice interno.
- Todo `factId` y `ambiguityId` debe existir en `fact-catalog.md` y
  `ambiguities.md`. Los tests deben verificar esta integridad.
- La base **no** contiene desenlaces precalculados.

### Task 3 — Implementar la lógica de tres valores

```ts
type Tri = 'TRUE' | 'FALSE' | 'UNKNOWN';
```

Implementar exactamente las cuatro leyes verificadas en `fact-catalog.md` §4.1:

| Expresión | Resultado |
|---|---|
| `UNKNOWN ∧ TRUE` | `UNKNOWN` |
| `UNKNOWN ∧ FALSE` | `FALSE` |
| `UNKNOWN ∨ TRUE` | `TRUE` |
| `UNKNOWN ∨ FALSE` | `UNKNOWN` |

Reglas adicionales:

- Los centinelas `NOT_APPLICABLE`, `NOT_OBSERVED`, `PENDING` y
  `NOT_EXTRACTABLE` **nunca** se convierten a `FALSE`. Un centinela no es
  evidencia de incumplimiento.
- Todo `UNKNOWN` debe llevar `unknownReason`. Un `UNKNOWN` sin causa se
  considera bug.
- Los umbrales temporales son **datos con cita**, nunca números en código. Hay
  **7** umbrales y 4 fueron bloqueantes; tras Task 1 deben existir como
  constantes citadas con su procedencia de la decisión del Owner.

### Task 4 — Modelar excepciones y contraevidencia

El motor legacy no tenía modelo de excepciones. Fase 1 identificó:

| Tipo | Cantidad | Ejemplo |
|---|---|---|
| `counterevidence` | 3 (`N-50`, `N-74`, `N-75`) | «en al menos una asignatura → no aplica CV» |
| `exception` | 4 (`N-42`, `N-53`, `N-95`, `N-112`) | «si el cambio de ciclo es de EE → NO es CV» |

Cada excepción declara **qué regla niega** y **bajo qué condición**. No se
implementan como `else` genéricos.

**Caso especial obligatorio — polaridad de `5.8.a`:** los cuatro criterios de
actividad por nivel tienen **tres polaridades opuestas** (`AMB-LOG-02`). La
polaridad debe declararse en la definición del dato, nunca en un `if`:

| Nivel | `TRUE` significa |
|---|---|
| Licenciatura | hay actividad (localizado) |
| Posgrado/Ejecutiva | **no** hay foros (ilocalizable) |
| Alianza | **no** hay ingreso (ilocalizable) |
| Diplomado | **no** hay foros (ilocalizable) |

Un test debe cubrir los cuatro niveles con la misma entrada para demostrar que
no hay inversión.

### Task 5 — Filtros de prevalencia

Implementar los 4 filtros de `decision-tree.md` §1 **antes** de cualquier
evaluación causal, en este orden:

1. `N-64` (p.11) — calificaciones en bimestre 1 → `BAJA` siempre
2. `N-105` (p.17) — canal Mystery Shopper → `CANCELACION_MATRICULA`
3. `N-95` (p.16) — incidencia de sistema → desactiva 5.9
4. `N-33` (p.5) — falta de retención → `BAJA` sin importar fecha ni D35/D53

El filtro 4 estaba `BLOCKED` por `AMB-CON-01`. Su resolución en Task 1 define si
prevalece sobre `N-27`.

### Task 6 — Golden cases derivadas de la fuente

Construir casos **solo** desde la fuente. Los casos históricos de `docs/legacy/`
son práctica, no política (`HISTORICAL_CASES_ARE_NOT_POLICY`).

Cada caso debe citar los enunciados que ejercita. **Un caso que no puede citar sus
secciones no pertenece a la suite.**

Cobertura mínima obligatoria:

| Caso | Ejercita | Cita |
|---|---|---|
| Solicitud previa al inicio con retención | `CAUSAL-V` | `N-27`, `N-32` |
| Solicitud previa al inicio sin retención | Filtro 4 | `N-33` |
| Con calificaciones en bimestre 1 | Filtro 1 | `N-64` |
| Canal Mystery Shopper | Filtro 2 | `N-105` |
| Incidencia en Aula Virtual | Filtro 3 | `N-95`, `N-98` |
| Cambio de ciclo antes del inicio | `CAUSAL-CICLO-A` | `N-41` |
| Cambio de ciclo desde el inicio, por EE | `CAUSAL-CICLO-B` | `N-42` |
| Quórum, evidencia de alternativa ofrecida | `CAUSAL-QUORUM` | `N-110`, `N-111` |
| Quórum, **después** del inicio | `CAUSAL-QUORUM` + override | `N-108`, `N-112` |
| Ilocalizable, 4 niveles de programa | `CAUSAL-ILOC` | `N-70`…`N-73` |
| Actividad en una sola asignatura | Contraevidencia | `N-74` |
| Cualquier contacto con el estudiante | Contraevidencia | `N-75` |
| Posgrado con foro participation | Polaridad | `N-71` |
| Promesa con rechazo de beneficios | `CAUSAL-PROMESA` | `N-46` |
| Validación completa + intención de baja | Excepción | `N-53` |
| Área operativa no canalizó | `OP-D` | `N-99` |
| Discrepancia de paquete | `OP-F` | `N-101` |
| Falta del conjunto de acciones de activación | `CAUSAL-ILOC-ESPECIAL` | `N-80` |
| Solicitud a día 22 | Regla temporal rectora | `N-35` |
| **Evidencia ausente en 2 hechos** | `UNKNOWN` | `UNKNOWN_IS_NOT_FALSE` |
| **Hecho en `PENDING`** | Centinela | No colapsa a `FALSE` |
| **Canal College con 5.9.a** | `NOT_APPLICABLE` | `N-93` |

**Mínimo: 22 casos.** Los 4 últimos verifican el comportamiento de `UNKNOWN`, que
es donde un motor mal construido falla.

### Task 7 — Reporte de cobertura ejecutable

Generar `docs/reports/normative-coverage-phase2.md` con, por enunciado:

| Campo | Contenido |
|---|---|
| `statementId` | `N-xx` |
| `citation` | documento, versión, sección, página |
| `factsUsed` | hechos consumidos |
| `casesCovering` | casos dorados que lo ejercitan |
| `coverage` | `COVERED` / `NO_CASE` / `BLOCKED` |
| `ambiguities` | ambigüedades asociadas, con estado |

Los enunciados `NO_CASE` se listan explícitamente. No se omiten en silencio.

### Task 8 — Golden cases validados contra la fuente

Sólo tras que los casos de Task 6 existan: verificar cada uno contra el PDF. Un
caso derivado de `docs/legacy/` que no se valide explícitamente contra la fuente
**no se incorpora a la suite**, aunque su resultado parezca correcto.

---

## Definition of done

- [ ] Las 14 ambigüedades bloqueantes tienen decisión escrita del Owner, con
      documento, versión, sección, página y fecha
- [ ] `owner-decisions.md` existe y separa la decisión del Owner de la fuente
- [ ] La base normativa carga sin React, Next.js, InsForge, IA, FS ni HTTP
- [ ] Cada enunciado cita documento, versión, sección y página **verificada**
- [ ] Cada condición puede evaluar `TRUE`, `FALSE` y `UNKNOWN`
- [ ] Las 4 leyes de tres valores están implementadas y testeadas
- [ ] Los 4 centinelas existen y ninguno colapsa a `FALSE`
- [ ] Todo `UNKNOWN` lleva `unknownReason`
- [ ] Los 7 umbrales temporales existen como datos con cita
- [ ] Las 4 excepciones y 3 contraevidencias declaran qué regla niegan
- [ ] La polaridad de los 4 niveles de `5.8.a` está en la definición del dato
- [ ] Los 4 filtros de prevalencia se evalúan antes de cualquier causal
- [ ] 22 casos dorados mínimo, cada uno citando las secciones que ejercita
- [ ] El reporte de cobertura nombra sus propios huecos
- [ ] Ningún desenlace es un enum fijo de 3
- [ ] `NON_LICENCIATURA`, `ShadowPolicyResult` y `DECLARATIVE_SHADOW` ausentes
- [ ] `typecheck`, `lint`, `test` y `build` pasan
- [ ] La frontera sigue cerrada: `AUDIT_ENGINE_NOT_IMPLEMENTED`
- [ ] Las 4 puertas del clean slate siguen pasando sin cambios

---

## Explicitly out of scope for Phase 2

- Conectar el motor a rutas API, jobs o UI
- Persistir resultados normativos en tablas
- IA que redacte, sugiera o revise reglas
- Migraciones o cambios de base de datos
- Reabrir la deuda de PII del historial Git
- Sustituir `Dictamen.pdf` como plantilla de salida
- Resolver ambigüedades sin decisión escrita del Owner

---

## Escalation

Detener y reportar si:

- Una ambigüedad bloqueante no tiene decisión del Owner
- La decisión del Owner contradice el texto de la fuente (registrar como
  `POLICY_DIVERGENCE`, no aplicar en silencio)
- Una regla necesita un concepto que la fuente no contiene
- La fuente se contradice en un punto no registrado en `ambiguities.md`
- Implementar algo exige revivir un constructo legacy retirado

**No** resolver ambigüedad eligiendo la lectura más plausible. **No** introducir
un default. **No** degradar `UNKNOWN` a `FALSE` para desbloquear una decisión.
