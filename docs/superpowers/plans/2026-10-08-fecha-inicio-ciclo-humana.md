# Fecha de inicio de ciclo aportada por una persona — Plan de implementación

> **Para agentes implementadores:** SUB-SKILL REQUERIDO: usar `subagent-driven-development` (recomendado) o `executing-plans` para ejecutar este plan tarea por tarea. Los pasos usan casillas (`- [ ]`) para dar seguimiento.

**Objetivo:** (1) eliminar la causa del incidente que tumbó un dictamen en producción, (2) permitir que una persona capture la fecha de inicio de clases cuando el dictamen no pudo acreditarla, y (3) hacer diagnosticable el fallo de referencias a evidencia.

**Arquitectura:** tres workstreams independientes que se tocan en `src/skills/audit/`. A quita al modelo la obligación de emitir un campo que nadie lee; B guarda la fecha en `cases` vía `PATCH` en un endpoint existente y la inyecta al expediente; C atestigua y persiste el detalle del fallo. Un solo endpoint nuevo como método, ninguno archivo nuevo en `api/`.

**Stack:** React 18 + Vite + TypeScript estricto, Zod, Vitest + Testing Library (jsdom), Vercel Functions + InsForge (Postgres).

**Spec:** `docs/superpowers/specs/2026-10-08-fecha-inicio-ciclo-humana-design.md` — **léelo primero**. Viaja con este plan: contiene el análisis del incidente y las decisiones del owner. Si el plan y el spec discrepan, el spec manda; si unsure, para y pregunta.

**Decisiones del owner (2026-10-08):** el modelo no emite `case.cycleStartDate` (lo deriva el servidor) · la fecha se captura a mano **solo en el expediente** y es un dato humano **con procedencia** · las referencias a evidencia **siguen siendo fail-closed** pero su fallo **se persiste** · capturar **no re-audita solo**: ofrece "Volver a auditar".

---

## Mapa de referencias (lee solo esto, no archivos completos)

| Qué | Dónde |
|---|---|
| `case` del modelo (5 campos, `cycleStartDate` incluido) | `src/skills/audit/schema.ts:92-98` |
| `case` del resultado persistido | `src/skills/audit/schema.ts:168` (`AuditResultSchema`) |
| Invariante que tumbó el dictamen | `src/skills/audit/schema.ts:454-456` |
| Reglas de fecha de ciclo del prompt | `src/skills/audit/instructions.ts:96-148`, `:210`, `:308-310` |
| Validación de referencias (origen del fallo #2) | `src/skills/audit/execute.ts:68-99` |
| Punto donde el validador pierde el detalle | `src/skills/audit/schema.ts:479-503` (comentario en `:501`) |
| Clasificación del fallo por regex sobre el mensaje | `src/server/openrouter.ts:386` |
| Feedback correctivo del 2º intento | `src/server/openrouter.ts:196`, `:411`, `:615-621` |
| Loop de intentos (2 máximo) | `src/server/openrouter.ts:438`, `src/server/audit-service.ts:451-528` |
| Endpoint del caso (hoy solo `GET`) | `api/cases/[caseId]/index.ts:24-56` |
| Escrituras y alcance de un caso | `src/server/cases.ts:73-85`, `:153-170` |
| DTO del caso | `src/server/dto.ts` (`caseToDetail`) |
| Cliente HTTP | `src/lib/api.ts` (`createCase:405`, `saveAreaComment:515`) |
| Zona donde se monta contexto humano | `src/components/CaseDetailPage.tsx:501-513` |
| Botón de auditar (el que debe enfocarse) | `src/components/CaseDetailPage.tsx:724` |
| Patrón de nombre escrito por la persona | `src/components/CaseReviewPanel.tsx:318`, `src/skills/review/schema.ts:109` |
| Patrón de prose mism y captura nombre | `src/components/AreaQuickComments.tsx:103-124` |
| Observabilidad y allowlist del DTO | `src/server/audit-observability.ts:211-224`, `:242` |
| Última migración + sus checks | `migrations/20261005120000_origin-country-channel.sql`, `scripts/migration-checks/20261005120000_origin-country-channel.checks.json` |
| Tests del ciclo de vida de la fecha | `tests/cycle-start-date.test.ts` (la suite que hay que updating) |

## Restricciones globales

- **`api/` sigue con 12 archivos.** Cero Functions nuevas: el endpoint es un método `PATCH` en `api/cases/[caseId]/index.ts`. Si necesitas un archivo nuevo, consolidates una familia en un segmento dinámico primero.
- **Nunca toques `api/cases/[caseId]/index.ts` sin añadir `PATCH`**: hoy responde `methodNotAllowed` a todo lo que no sea `GET` (`:25-28`).
- Alcance: `getScopedCaseOr404` + `assertCaseOwner`. Un caso ajeno responde **404**, nunca 403.
- Validación de entrada **siempre en servidor**, antes de escribir (Zod).
- `POLICY_IS_IMMUTABLE`: la fecha es un **dato**, no política. No inventes rangos normativos de fechas: el único rango del plan es de coherencia (año 2000-2100, no futura).
- `DO_NOT_REPROCESS_AI_UNNECESSARILY`: capturar la fecha **no** dispara auditoría.
- `PROJECTION_IS_NOT_THE_DICTAMEN`: los dictámenes ya emitidos **no** se reinterpretan ni se reescriben.
- `TRACE_EVERY_DECISION`: si el assessment afirma una fecha, su razonamiento declara el origen.
- Copia de interfaz en español, tono coherente con el existente. Sin dependencias nuevas, sin librería de modal.
- Accesibilidad: `label` asociado, región `aria-live`, foco al abrir, operable por teclado.
- TypeScript estricto: nada de `any` implícito ni casts para callar al compilador.
- No registrar PII ni texto crudo del modelo en logs.

## Review Focus

Cinco entradas o modos de fallo que el spec implica y que una tarea puede no cubrir. Cada línea tiene su prueba asignada.

1. **Dictamen histórico sin `case.cycleStartDate` en el `result_json`**: al releerlo no debe romperse `parseAuditResult`.
2. **Persona que escribe una fecha futura o con formato `dd/mm/aaaa`**: 400, no un 500 ni una fecha corrupta guardada.
3. **Fecha capturada que el modelo no afirma**: el dictamen sigue siendo `COMPLETED` y la UI muestra ambos datos por separado.
4. **Reintento de escritura de la fecha**: es `UPSERT`; no puede duplicar ni dejar la fila anterior con fecha distinta y autor distinto.
5. **`evidenceId` alucinado**: el detalle persists con ruta e id, y el feedback del 2º intento lo nombra.

---

## Tarea 1 — El servidor deriva `case.cycleStartDate`

Elimina la causa del incidente. Sin cambios de servidor ni de persistencia.

**Archivos**
- Modificar: `src/skills/audit/schema.ts`, `src/skills/audit/types.ts`, `src/skills/audit/instructions.ts`
- Tests: `tests/cycle-start-date.test.ts`, `tests/schema.test.ts`, `tests/provider-schema.test.ts`, `tests/fixtures/audit-result.ts`
- Docs: `README.md:194-255`, `docs/AUDIT_PIPELINE.md:116-123`

**Interfaces**
- Produce: `deriveCaseCycleStartDate(result: AuditResult): AuditResult` en `src/skills/audit/schema.ts`, exportada. Rellena `result.case.cycleStartDate` con `result.temporalAnalysis.cycleStartDate`. Idempotente.
- Produce: dos shapes distintos. `AiAuditAssessmentSchema` (`:90`) describe lo que **emite el modelo** y su `case` pasa a `.strict()` **sin** `cycleStartDate`. `AuditResultSchema` (`:168`) describe lo que se **persiste** y conserva `case.cycleStartDate: IsoDate.nullable()` para poder releer históricos.

- [ ] **Paso 1.1** Prueba que falla: en `tests/cycle-start-date.test.ts`, sustituye el test de rechazo por divergencia (`:354-364`) por tres casos: (a) un assessment de modelo **sin** `case.cycleStartDate` que, al derivar, produce `result.case.cycleStartDate === result.temporalAnalysis.cycleStartDate`; (b) un assessment de modelo que **sí** emite `case.cycleStartDate` con un valor distinto → el validador lo rechaza como clave no reconocida; (c) un **resultado persistido heredado** que llega a `parseAuditResult` **sin** `case.cycleStartDate` y con `temporalAnalysis.cycleStartDate` presente → se relee sin error y con el campo derivado. El caso (c) es el que protege los dictámenes ya emitidos.
- [ ] **Paso 1.2** Ejecuta `node_modules/.bin/vitest.cmd run tests/cycle-start-date.test.ts` y confirma que falla por la ausencia de `deriveCaseCycleStartDate`.
- [ ] **Paso 1.3** Implementa en `src/skills/audit/schema.ts`: `deriveCaseCycleStartDate(result: AuditResult): AuditResult` con la firma de arriba. Quita `cycleStartDate` del `case` de `AiAuditAssessmentSchema` (`:97`) y pon `.strict()` en ese `case`. **No toques** el `case` de `AuditResultSchema`.
- [ ] **Paso 1.4** Llama la derivación en `src/skills/audit/execute.ts`, una sola vez, después de validar el assessment del modelo y antes de construir el resultado que se persiste.
- [ ] **Paso 1.5** Corrige el doc de `src/skills/audit/types.ts:243` que afirma "la UI lee `case`" (es falso: no hay lector) y el bloque de contrato de salida en `src/skills/audit/instructions.ts:308-310`.
- [ ] **Paso 1.6** Ejecuta `node_modules/.bin/vitest.cmd run tests/cycle-start-date.test.ts tests/schema.test.ts tests/provider-schema.test.ts` y arregla **uno por uno** los fixtures que fallen. Ojo: `tests/fixtures/audit-result.ts:5-10` es un fixture de **resultado**, no de modelo: sus `case` con `cycleStartDate` siguen siendo válidos.
- [ ] **Paso 1.7** Actualiza `README.md:194-255` y `docs/AUDIT_PIPELINE.md:116-123` para decir que el campo es derivado, no afirmado.
- [ ] **Paso 1.8** Ejecuta `node_modules/.bin/tsc.cmd --noEmit` → exit 0.
- [ ] **Paso 1.9** Commit: `git add src/skills/audit tests/cycle-start-date.test.ts tests/schema.test.ts tests/provider-schema.test.ts tests/fixtures README.md docs/AUDIT_PIPELINE.md && git commit -m "fix(auditoria): case.cycleStartDate lo deriva el servidor y el modelo ya no lo emite"`

## Tarea 2 — Persistencia y endpoint de la fecha capturada

**Archivos**
- Crear: `migrations/20261008090000_case-cycle-start-date-human.sql`, `scripts/migration-checks/20261008090000_case-cycle-start-date-human.checks.json`
- Modificar: `api/cases/[caseId]/index.ts`, `src/server/cases.ts`, `src/server/dto.ts`, `src/lib/api.ts`

**Interfaces**
- Produce: `setCaseCycleStartDate(client: InsForgeClient, caseId: string, value: { date: string; byUserId: string; byName: string }): Promise<void>` en `src/server/cases.ts`. `UPSERT`: una segunda escritura pisa fecha, autor y nombre, y actualiza `updated_at`.
- Produce: `PATCH /api/cases/:caseId` con body `{ cycleStartDate: string; cycleStartDateByName: string }` → `200 { case: CaseDetail }`. Errores: `400 VALIDATION_ERROR` (formato, fecha futura, año fuera de 2000-2100, nombre vacío o >120), `404 NOT_FOUND` (caso ajeno o inexistente).
- Produce: `setCycleStartDate(caseId: string, date: string, byName: string): Promise<CaseDetail>` en `src/lib/api.ts`.
- Modifica: `caseToDetail` expone `cycleStartDate: string | null`, `cycleStartDateByName: string | null`, `cycleStartDateAt: string | null`.

- [ ] **Paso 2.1** Escribe la migración: cuatro columnas en `cases` (`cycle_start_date date`, `cycle_start_date_by uuid references auth.users(id)`, `cycle_start_date_at timestamptz`, `cycle_start_date_by_name text`), `IF NOT EXISTS`, con `COMMENT ON COLUMN` explicando que la fecha es dato humano y no evidencia. No toques RLS.
- [ ] **Paso 2.2** Escribe `scripts/migration-checks/20261008090000_case-cycle-start-date-human.checks.json` con las comprobaciones, siguiendo la estructura del archivo de `origin-country-channel`.
- [ ] **Paso 2.3** Pruebas que fallan: endpoint. `400` con `"21/08/2026"`; `400` con una fecha futura; `400` con nombre vacío o de más de 120 caracteres; `404` con un caso ajeno; `200` y el `case` devuelto trae la fecha, el autor y la marca de tiempo; y **escribir dos veces no duplica nada**: la segunda escritura pisa fecha, autor y nombre, y devuelve una sola fila.
- [ ] **Paso 2.4** Ejecuta las pruebas del endpoint y confirma que fallan.
- [ ] **Paso 2.5** Implementa `setCaseCycleStartDate` en `src/server/cases.ts` y el método `PATCH` en `api/cases/[caseId]/index.ts`: `requiredUuid`, `readJsonBody`, Zod para validar antes de escribir, `getScopedCaseOr404` + `assertCaseOwner`, y `methodNotAllowed(req, res, 'GET, PATCH')`. Usa `updated_at` en la escritura.
- [ ] **Paso 2.6** Expón los campos en `caseToDetail` y añade `setCycleStartDate` a `src/lib/api.ts`.
- [ ] **Paso 2.7** Ejecuta las pruebas del endpoint y `node_modules/.bin/tsc.cmd --noEmit`.
- [ ] **Paso 2.8** Verifica que `api/` sigue con 12 archivos: `(Get-ChildItem api -Recurse -Filter *.ts).Count` → 12.
- [ ] **Paso 2.9** Commit: `git add api/cases migrations scripts/migration-checks src/server/cases.ts src/server/dto.ts src/lib/api.ts tests && git commit -m "feat(casos): fecha de inicio de ciclo capturada con autor y fecha"`

## Tarea 3 — La fecha entra al dictamen y las invariantes lo admiten

**Archivos**
- Modificar: `src/server/audit-service.ts` (`buildAuditInputs`), `src/skills/audit/instructions.ts`, `src/skills/audit/schema.ts` (`schema.ts:426-476`)
- Tests: `tests/cycle-start-date.test.ts`, `tests/execute.test.ts`

**Interfaces**
- Consume: `setCaseCycleStartDate` y las columnas de la Tarea 2.
- Produce: `HUMAN_CYCLE_START_DATE_RULES` en `src/skills/audit/instructions.ts`, inyectado junto a `CYCLE_START_DATE_RULES` (`:210`) y listado en el bloque de contrato de salida.
- Produce: `buildAuditInputs` incluye la fecha humana cuando existe, como valor ISO validado en el expediente.

- [ ] **Paso 3.1** Pruebas que fallan: (a) existe `cases.cycle_start_date` → el expediente enviado al modelo la incluye; (b) no existe → no aparece; (c) la fecha no puede portar texto (se rechaza en el endpoint, no aquí); (d) assessment con `cycleStartDate` afirmada **sin** columna existente → rechazado; (e) assessment con la fecha afirmada y columna existente → aceptado, con `cycleStartEvidenceIds` vacío y `cycleStartEvidenceText` declarando el origen humano; (f) el fact `cycle_start_date` sigue exigiéndose, con `confidence < 1`; (g) el modelo afirma una fecha **distinta** de la capturada → se corrige a la capturada y se registra la discrepancia, sin lanzar error; (h) columna existente pero assessment con `cycleStartDate` en `null` y `relationToCycleStart` `NO_DETERMINABLE` → **aceptado**, porque la captura no se hereda automáticamente.
- [ ] **Paso 3.2** Ejecuta `node_modules/.bin/vitest.cmd run tests/cycle-start-date.test.ts tests/execute.test.ts` y confirma los fallos.
- [ ] **Paso 3.3** Reescribe las reglas de `schema.ts:430-439` según la tabla del spec §4.4: la evidencia deja de ser la única vía de acreditación cuando la columna existe. **No** elimines la exigencia de `confidence < 1` ni la del fact.
- [ ] **Paso 3.4** Implementa la corrección con registro de la divergencia en `schema.ts`: cuando el modelo afirme otra fecha, sobrescribe con la capturada y deja rastro en el detalle del error o en el log del servidor. Sin `console.log` de la fecha completa: registra ruta y valores comparados.
- [ ] **Paso 3.5** Añade `HUMAN_CYCLE_START_DATE_RULES` a `instructions.ts` con el texto del spec §4.3, e inyecta la fecha en `buildAuditInputs` (`audit-service.ts`).
- [ ] **Paso 3.6** Ejecuta las pruebas de los pasos 3.1 y `node_modules/.bin/tsc.cmd --noEmit`.
- [ ] **Paso 3.7** Commit: `git add src/skills/audit src/server/audit-service.ts tests && git commit -m "feat(auditoria): la fecha de inicio aportada por el equipo sustenta el analysis temporal"`

## Tarea 4 — La ventana de captura en el expediente

**Archivos**
- Crear: `src/components/CycleStartDateCapture.tsx`, `tests/CycleStartDateCapture.test.tsx`
- Modificar: `src/components/CaseDetailPage.tsx` (montaje tras `AreaQuickComments`, `:507-513`), `src/lib/api.ts` (tipos del `case`)

**Interfaces**
- Consume: `setCycleStartDate` (Tarea 2), los campos del DTO y `resultJson.temporalAnalysis` del dictamen vigente.
- Produce: `CycleStartDateCaptureProps { caseId: string; assessment: { cycleStartDate: string | null; relationToCycleStart: string } | null; cycleStartDate: string | null; cycleStartDateByName: string | null; cycleStartDateAt: string | null; onSaved: () => void | Promise<void> }`.

- [ ] **Paso 4.1** Pruebas que fallan: aparece con dictamen `NO_DETERMINABLE` y sin fecha capturada; **no** aparece si el dictamen ya tiene fecha; **no** aparece si ya hay fecha capturada; al guardar llama al `PATCH` una vez y **no** llama a `startAudit`; el aviso de "Volver a auditar" enfoca el botón "Auditar con IA"; con fecha capturada se muestra "capturada por {nombre}" y permite corregirla; nombre vacío bloquea el guardado.
- [ ] **Paso 4.2** Ejecuta `node_modules/.bin/vitest.cmd run tests/CycleStartDateCapture.test.tsx` y confirma los fallos.
- [ ] **Paso 4.3** Implementa el componente con la copy del spec §4.5: ventana inline (sin modal), `label` asociado, región `aria-live`, foco al abrir, botones "Guardar" / "Ahora no", y contador/validación de longitud del nombre (máx. 120, igual que `reviewer_name`).
- [ ] **Paso 4.4** "Volver a auditar" **enfoca** el botón existente (`CaseDetailPage.tsx:724`); no crea una segunda vía de re-auditoría.
- [ ] **Paso 4.5** Monta el componente en el `aside` de `CaseDetailPage.tsx`, justo después de `AreaQuickComments`.
- [ ] **Paso 4.6** Ejecuta las pruebas y `node_modules/.bin/tsc.cmd --noEmit`.
- [ ] **Paso 4.7** Commit: `git add src/components src/lib/api.ts tests && git commit -m "feat(expediente): ventana para capturar la fecha de inicio de clases"`

## Tarea 5 — Que el fallo de referencias sea diagnosticable

**Archivos**
- Modificar: `src/skills/audit/execute.ts` (`:68-99`), `src/skills/audit/schema.ts` (`:479-503`), `src/server/openrouter.ts` (`:386`, `:394-412`), `src/server/audit-observability.ts` (`:211-224`), `src/server/dto.ts`
- UI: panel de error del dictamen en `src/components/CaseDetailPage.tsx`
- Tests: `tests/openrouter.test.ts` (`:396-427`), `tests/execute.test.ts`

**Interfaces**
- Produce: un código de fallo estable, no un regex sobre el mensaje. `INVALID_EVIDENCE_REFERENCE` se decide por el **código** del error que lanza `validateAssessmentReferences`, no por su texto.
- Produce: `AttemptFailure` incluye `detail` (saneado) y `path`; `provider_metadata.openrouterAttempts[]` los persiste.
- Produce: en ERROR, el detalle queda visible en el panel del dictamen.

- [ ] **Paso 5.1** Pruebas que fallan: un `evidenceId` inexistente produce un error cuyo detalle incluye la ruta y el id; `provider_metadata` de un intento fallido conserva `failureCategory`, `path` y `detail`; renombrar el mensaje del error **no** cambia la categoría (ese es el acoplamiento frágil de `openrouter.ts:386`); el detalle aparece en el panel de error del dictamen.
- [ ] **Paso 5.2** Ejecuta `node_modules/.bin/vitest.cmd run tests/openrouter.test.ts tests/execute.test.ts` y confirma los fallos.
- [ ] **Paso 5.3** Mueve el lanzamiento de `validateAssessmentReferences` al interior del `try` de `parseWithInvalidAiError`, o propaga el detalle por otra vía, para que deje `sanitizedDetail` (el comentario de `schema.ts:501` documenta hoy que no lo deja).
- [ ] **Paso 5.4** Reemplaza el regex de `openrouter.ts:386` por el código de error estable. Actualiza `tests/openrouter.test.ts:399-425`, que hoy fija el acoplamiento.
- [ ] **Paso 5.5** Persiste `failureCategory`, `path` y `detail` en `provider_metadata.openrouterAttempts[]`, y amplía la allowlist de `audit-observability.ts:211-224` para exponerlos en el DTO. **Nunca** copies texto crudo del modelo.
- [ ] **Paso 5.6** Añade en el panel de error del dictamen: categoría, ruta y detalle saneado.
- [ ] **Paso 5.7** Ejecuta las pruebas y `node_modules/.bin/tsc.cmd --noEmit`.
- [ ] **Paso 5.8** Commit: `git add src/skills/audit src/server src/components tests && git commit -m "fix(auditoria): el detalle del fallo por referencia de evidencia queda persistido y visible"`

---

## Verificación final (la corro yo, no el implementador)

- [ ] `npm run verify:release` completo: secretos, contraste, typecheck, contrato, suite entera, build.
- [ ] `api/` sigue con 12 archivos.
- [ ] `git status` limpio y los 5 commits presentes.
- [ ] QA manual de los cinco casos del Review Focus.

## Fuera de alcance

- Capturar la fecha desde la pantalla de nuevo caso (solo en el expediente).
- Re-auditoría automática al capturar.
- Relajar el fail-closed de referencias.
- Persistir la salida cruda del modelo.
- Arreglar el `DeprecationWarning: url.parse()` de una dependencia: documentado como ruido conocido.
- Cambios en la política oficial o en `Dictamen.pdf`.