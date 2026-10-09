# Fecha de inicio de ciclo aportada por una persona — Diseño

**Fecha:** 2026-10-08
**Estado:** implementado. Este documento conserva las decisiones de diseño; el comportamiento vigente está en `AGENTS.md` y `docs/ARCHITECTURE.md`.
**Relacionado:** incidente de producción (dictamen en ERROR)

---

## 1. El incidente y su causa raíz

Una auditoría terminó en ERROR tras agotar 2 intentos (`MAX_PROVIDER_ATTEMPTS = 2`):

1. `SCHEMA_VALIDATION_ERROR ... case.cycleStartDate debe coincidir con temporalAnalysis.cycleStartDate (2026-08-21)` — inválido en `src/skills/audit/schema.ts:454`.
2. `INVALID_EVIDENCE_REFERENCE (unknown evidence reference)` — `src/skills/audit/execute.ts:68`.

El log de runtime de Vercel **no contenía el error**: las entradas de nivel `error` son el `DeprecationWarning: url.parse()` impreso a stderr. El detalle real se pierde, porque en estado ERROR `result_json` queda `null` y el error de referencias no deja detalle atestiguado.

**Causa raíz.** El contrato de salida pide la misma fecha en tres sitios y exige igualdad entre ellos:

| Copia | Dónde | Cómo llega |
|---|---|---|
| `case.cycleStartDate` | `schema.ts:97` | el modelo lo emite |
| `temporalAnalysis.cycleStartDate` | `schema.ts:33` | el modelo lo emite, acreditado |
| `facts["cycle_start_date"].value` | validado en `schema.ts:459` | el modelo lo emite |

Sobre `case.cycleStartDate`:

- El system prompt **no dice nada** de él: `instructions.ts` no menciona `case` en ningún punto. El modelo lo emite solo porque el JSON Schema lo marca requerido.
- Es el único campo de fecha sin validación de formato: `z.string().nullable()` sin el `IsoDate` de `schema.ts:20`. Y `case` no es `.strict()`.
- **Nadie lo lee**: cero coincidencias de `cycleStartDate` en `src/components/**` y en `src/server/dto.ts`. La invariante de `:454` dice "la UI muestra case.cycleStartDate" y ese comentario es obsoleto: la UI lee `facts`, `timeline` y `audit` del `resultJson`.
- Su única defensa es una igualdad que solo puede comprobarse después, y cuyo fallo tumba el dictamen entero.

**Riesgo sistémico.** Existen ~20 invariantes validadas post-hoc porque un JSON Schema no puede expresarlas. Una de ellas (`schema.ts:316-325`) exige que el modelo escriba literalmente "falta 1 llamada" / "faltan N llamadas" en español con la gramática correcta. Es la misma clase de fallo esperando ocurrir.

---

## 2. Decisiones del owner (2026-10-08)

1. `case.cycleStartDate` deja de ser una emisión del modelo: **lo deriva el servidor**.
2. La fecha de inicio que falta se captura a mano, **en el expediente**, y es un **dato humano con procedencia** (quién y cuándo), no evidencia del expediente.
3. Referencias a evidencia: **se mantiene el fallo cerrado**, pero **se persiste el detalle** del fallo.
4. Al capturar la fecha, **no se re-audita solo**: se ofrece "Volver a auditar".

---

## 3. Workstream A — Derivar `case.cycleStartDate` en servidor

Elimina la causa del incidente sin cambiar lo que la UI muestra.

**Cambios**

| Archivo | Cambio |
|---|---|
| `src/skills/audit/schema.ts:92-98` | El modelo deja de emitir `case.cycleStartDate`. Se mantiene en el tipo de salida para que `result_json` lo conserve, pero se rellena en servidor desde `temporalAnalysis.cycleStartDate` antes de validar. |
| `src/skills/audit/schema.ts:454-456` | La invariante de igualdad se elimina: deja de ser una comprobación y pasa a ser una asignación. |
| `src/skills/audit/types.ts:243` | Corregir el doc que afirma "la UI lee `case`": es falso. |
| `src/server/ai/provider-schema.ts:55` | El JSON Schema enviado a OpenRouter refleja el shape; al quitar el campo del lado modelo, deja de exigirse. |
| `src/skills/audit/instructions.ts:308-310` | El bloque "Contrato de salida" deja de listar el campo. No requiere más: el prompt nunca lo mencionaba. |
| `tests/cycle-start-date.test.ts:354-364` | El test que afirma el rechazo por divergencia pasa a afirmar la derivación. |
| `tests/schema.test.ts:27-34,231,277` y `tests/fixtures/audit-result.ts:5-10` | Ajustar fixtures. |
| `tests/provider-schema.test.ts:28-39` | `case` deja de exigir `cycleStartDate`. |
| `README.md:194-255`, `docs/AUDIT_PIPELINE.md:116-123` | Documentar que el campo es derivado, no afirmado. |

**Precauciones**

- `case` **no** pasa a `.strict()`: los dictámenes ya emitidos guardan ese campo y `AuditResultSchema` los relee. Un `.strict()` rompería la lectura de históricos.
- El valor derivado se valida con `IsoDate` antes de escribirse.
- Un dictamen ya emitido **no** se reinterpreta (`PROJECTION_IS_NOT_THE_DICTAMEN`): la derivación solo aplica a auditorías nuevas.

---

## 4. Workstream B — Fecha de inicio aportada por una persona

### 4.1 Persistencia

Tres columnas nuevas en `cases` (la única fuente es humana por definición, así que no hace falta una columna `source`):

| Columna | Tipo | Nota |
|---|---|---|
| `cycle_start_date` | `date` nullable | El dato. |
| `cycle_start_date_by` | `uuid` nullable → `auth.users(id)` | Quién lo capturó. |
| `cycle_start_date_at` | `timestamptz` nullable | Cuándo. |
| `cycle_start_date_by_name` | `text` nullable, máx. 120 | Nombre que escribe la persona. |

Sobre el nombre: **no existe un nombre de usuario autoritativo en el sistema**. La revisión humana resuelve lo mismo guardando `case_reviews.reviewer_name` como texto que la persona escribe (`CaseReviewPanel.tsx:318`, `src/skills/review/schema.ts:109`). Se replica ese patrón: `cycle_start_date_by` (uuid) es el autor real y con sello de auditoría; `_by_name` es solo para mostrar, igual que hoy `reviewer_name`.

- Migración nueva, forward-only e idempotente: `migrations/20261008090000_case-cycle-start-date-human.sql`.
- Comprobaciones en `scripts/migration-checks/20261008090000_case-cycle-start-date-human.checks.json`, siguiendo el patrón existente.
- **No se toca RLS**: las políticas de `cases` siguen igual.

### 4.2 Endpoint — sin gastar una Function

Vercel Hobby admite 12 Functions y el proyecto **está en 12/12**. Por eso el endpoint nuevo **no** es un archivo nuevo en `api/`: se añade el método `PATCH` a `api/cases/[caseId]/index.ts`, que hoy solo atiende `GET`.

- Body: `{ cycleStartDate: "YYYY-MM-DD" }`.
- Validación con Zod en servidor, antes de escribir: formato ISO estricto, fecha no futura y año entre 2000 y 2100. Este rango es un **cabo de coherencia**, no una regla normativa: la política no impose qué fechas son admisibles.
- Alcance: `getScopedCaseOr404` + `assertCaseOwner`, igual que los comentarios por área. Un caso ajeno responde **404**, nunca 403.
- `methodNotAllowed` se actualiza para admitir `GET, PATCH`.

Capas afectadas: `src/server/cases.ts` (escritura y lectura), `src/server/dto.ts` (exposición en `caseToDetail`), `src/lib/api.ts` (cliente `setCycleStartDate`).

### 4.3 Cómo entra al dictamen

`buildAuditInputs` inyecta la fecha al expediente. Al ser un valor tipado y validado a ISO, no admite texto libre: **no puede portar prompt injection**, y se documenta por qué no usa `wrapUntrusted`.

Regla nueva en `instructions.ts`:

> Si existe una fecha de inicio aportada por el equipo, es un dato de contexto: puede sustentar `cycleStartDate`, pero el razonamiento debe declarar que la aportó una persona y no la acredita la evidencia del expediente. Si no existe, `cycleStartDate` es `null` y `relationToCycleStart` es `NO_DETERMINABLE`.

### 4.4 Cómo cambian las invariantes

Hoy, afirmar `cycleStartDate` exige evidencia citada (`schema.ts:430-439`) y un fact con evidencia, cita y `confidence < 1` (`:458-471`). Eso no admite un dato humano. Reglas resultantes:

| Situación | Regla |
|---|---|
| No existe `cases.cycle_start_date` | `cycleStartDate` debe ser `null`. Prohibido afirmarla. |
| Existe la fecha humana y el modelo la afirma | Se acepta **sin** `cycleStartEvidenceIds`; `cycleStartEvidenceText` explica el origen humano. El fact `cycle_start_date` se sigue exigiendo, con `evidenceIds` vacío y `confidence < 1`. |
| El modelo afirma una fecha **distinta** de la capturada | **Se corrige a la capturada y se registra la discrepancia.** No tumba el dictamen. |

La última regla es deliberada y es la lección del incidente: una discrepancia que el modelo no puede evitar de forma fiable no puede ser motivo de fallo total. Como la captura es visible con nombre y hora, un error humano se corrige editando el dato y re-auditando.

**La captura no se hereda automáticamente.** Que exista `cases.cycle_start_date` no obliga al assessment a afirmarla: si el modelo mantiene `cycleStartDate` en `null`, es un dictamen legítimo y así se persiste. La UI muestra ambos datos por separado —la fecha capturada y la que el dictamen usó— para que la diferencia sea visible en lugar de pasar inadvertida.

**Sin campo nuevo en el assessment.** La procedencia vive en `cases` y la UI la muestra junto al dictamen. Añadir `cycleStartDateSource` al assessment sería vocabulario nuevo sin consumidor claro.

### 4.5 Interfaz

Componente nuevo: `src/components/CycleStartDateCapture.tsx`, montado en el `aside` de `src/components/CaseDetailPage.tsx`, justo después de `AreaQuickComments` (`:507-513`): es la misma zona donde ya vive el contexto humano previo a la auditoría.

- **Aparece** cuando hay dictamen `COMPLETED`, `temporalAnalysis.cycleStartDate === null` (o `relationToCycleStart === "NO_DETERMINABLE"`) y no existe `cases.cycle_start_date`.
- **Ventana inline**, sin librería de modal, igual que el prompt de notas ya implementado: título "Falta la fecha de inicio de clases", explicación de que el dictamen no pudo acreditarla con la evidencia del expediente y de que capturándola podrá comparar la solicitud contra el inicio del ciclo, un campo `date`, y acciones "Guardar" / "Ahora no".
- **Si ya está capturada**: se muestra "Fecha de inicio de clases: 2026-08-21 · capturada por {nombre} el {fecha}", con opción de corregir y, si el dictamen vigente no la usa, el aviso de re-auditar.
- **No re-audita solo** (`DO_NOT_REPROCESS_AI_UNNECESSARILY`). Tras guardar, mensaje y botón "Volver a auditar" que **enfoca el botón "Auditar con IA" ya existente** (`CaseDetailPage.tsx:724`): no se crea una segunda vía de re-auditoría, se reutiliza la que ya hay. Mismo lenguaje que ya usa la sección de notas de Back Office / HelpDesk.
- Accesibilidad: `label` asociado, región `aria-live`, foco al abrir, operable por teclado.

### 4.6 Pruebas

- Endpoint: 400 por formato inválido, 400 por fecha futura, 404 por caso ajeno, 200 escribe y relee, y que la escritura no toque otros campos.
- `buildAuditInputs`: inyecta la fecha cuando existe y no cuando no.
- Validación: acepta afirmar la fecha humana sin evidencia; rechaza afirmarla si la columna está vacía; una fecha divergente se corrige a la capturada.
- UI: la ventana aparece en el caso descrito y no en el contrario; guardar no dispara auditoría; el aviso de re-auditar aparece cuando el dictamen vigente no usa la fecha.

---

## 5. Workstream C — Que el fallo sea diagnosticable

1. **Atestiguar el id infractor.** `validateAssessmentReferences` (`execute.ts:68-99`) lanza fuera del `try` de `parseWithInvalidAiError`, así que su error no lleva detalle (`schema.ts:501`). Pasa a llevar detalle saneado con la ruta y el id.
2. **Clasificación sin acoplamiento textual.** `openrouter.ts:386` clasifica `INVALID_EVIDENCE_REFERENCE` con un regex sobre el mensaje. Se reemplaza por un código estable, no por texto: renombrar el mensaje reclasifica el fallo y rompe `tests/openrouter.test.ts:399`.
3. **Persistencia.** En `provider_metadata.openrouterAttempts[]` se guarda, por intento: `failureCategory`, `path` y el detalle saneado. **No** se persiste la salida cruda del modelo (no es segura ni barata), pero sí la lista de ids citados que no existen: son UUIDs de evidencia, no contienen PII, y son lo que hace falta para diagnosticar.
4. **Visibilidad.** `providerMetadata` ya viaja en el DTO pero **ningún componente lo renderiza**. Se añade en el panel de error del dictamen: categoría, ruta y detalle saneado. Nunca texto crudo del modelo.
5. **Ruido de Vercel (documentado, no arreglado aquí).** El `DeprecationWarning: url.parse()` (`DEP0169`) aparece en cada invocación de la función y Vercel lo etiqueta como `error`, ocultando errores reales. **No viene de nuestro código**: `url.parse` no aparece en ningún archivo del proyecto, es una dependencia (el mismo arranque muestra otros avisos de `pdfjs-dist`). Se documenta como ruido conocido y la forma de distinguir un error real de este warning. Arreglarlo exigiría tocar la dependencia, fuera del alcance de este cambio.

---

## 6. Invariantes que se preservan

- `POLICY_IS_IMMUTABLE`: la procedencia humana no crea política. La fecha es un **dato**; el criterio sigue siendo el procedimiento v5.
- `TRACE_EVERY_DECISION`: el razonamiento del assessment declara el origen de la fecha; el fact exige `confidence < 1`.
- `NO_RESOURCE_EXISTENCE_LEAK`: 404 para caso ajeno, igual que los comentarios por área.
- `HOBBY_FUNCTION_BUDGET`: 12/12 → el endpoint es un `PATCH` en un archivo existente, no uno nuevo.
- `VALIDATE_BEFORE_EFFECT`: validación Zod antes de escribir.
- `DO_NOT_REPROCESS_AI_UNNECESSARILY`: capturar la fecha no re-audita.
- `PROJECTION_IS_NOT_THE_DICTAMEN`: los dictámenes emitidos no se reinterpretan.
- `FAIL_CLOSED`: sesión, rol y alcance se resuelven en servidor.
- `NO_PII_IN_GIT`: sin datos reales ni nombres de personas en el repositorio.

---

## 7. Riesgos

| Riesgo | Mitigación |
|---|---|
| Permitir afirmar la fecha sin evidencia abre que el modelo la afirme por su cuenta | La fecha solo es afirmable si la columna existe; si no existe, debe ser `null` |
| El JSON Schema del proveedor cambia | Se actualizan `provider-schema.test.ts` y el smoke en vivo |
| Divergencia entre lo que afirma el modelo y lo capturó una persona | Se corrige a la capturada y se registra; la captura es visible con nombre y hora |
| Que capturar la fecha "arbitre" el resultado | La procedencia se muestra siempre en el dictamen; nunca se presenta como evidencia del expediente |
| Un humano puede escribir una fecha equivocada | Se corrige y se re-audita; la fecha anterior queda en el historial de la auditoría por `updated_at` del caso |
| La procedencia se usa para justificar una fecha sin respaldo | El razonamiento del assessment debe declararlo, y el fact exige `confidence < 1` |

---

## 8. Fuera de alcance

- Capturar la fecha desde la pantalla de nuevo caso (solo en el expediente).
- Re-auditoría automática al capturar.
- Relajar la política fail-closed de referencias a evidencia.
- Persistir la salida cruda del modelo.
- Cualquier cambio en la política oficial o en `Dictamen.pdf`.

---

## 9. Criterios de aceptación

1. Un assessment cuyo `case.cycleStartDate` no lo emita el modelo se persiste con el campo derivado y la auditoría termina `COMPLETED`.
2. Un caso con dictamen `NO_DETERMINABLE` muestra la ventana de captura; al guardar, la fecha queda con autor y hora, y el caso ofrece "Volver a auditar".
3. Una re-auditoría posterior usa la fecha capturada y el razonamiento declara su origen humano.
4. Un id de evidencia inexistente deja rastro: categoría, ruta e id infractor visibles en el panel de error y persistidos en `provider_metadata`.
5. `api/` sigue con 12 archivos.
6. Las tres puertas del repo en verde: `npm run verify:release`.
