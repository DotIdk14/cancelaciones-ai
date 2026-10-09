# Diseño — Extracción de PAÍS y CANAL de origen

- **Fecha:** 2026-10-05
- **Path:** ARCHITECTURAL
- **Estado:** implementado. Se conserva como registro de diseño; la arquitectura vigente está en `AGENTS.md` y `docs/ARCHITECTURE.md`.
- **Alcance:** Assessment del Audit Skill → columnas de dimensión → filtros de Calidad → visualizaciones de Resumen

---

## 1. Objetivo

Hoy el país y el canal de origen de cada cancelación **existen solo como texto libre**
dentro de las evidencias que lee el modelo. No se extraen, no se persisten y no se pueden
filtrar. Este trabajo los convierte en datos estructurados, verificables y filtrables.

Tres entregables:

1. El modelo extrae `country` y `channel` durante el dictamen, con evidencia citada.
2. Resumen muestra **dos distribuciones** (por país, por canal) y **dos columnas nuevas**
   en "Casos recientes".
3. Calidad acepta **ambos como filtros**.

---

## 2. Decisiones tomadas

| Decisión | Elección | Motivo |
|---|---|---|
| Quién escribe el valor | La IA, sobre la evidencia | El dato está en la evidencia; pedirlo a un humano duplica la captura |
| Vocabulario | **Cerrado**: 11 países, 7 canales | Un `SELECT DISTINCT` sobre texto libre produce basura en los filtros |
| Casos ya auditados | **Solo casos nuevos** | No se gasta OpenRouter ni cuota en un backfill |
| Visualización en Resumen | 2 distribuciones + 2 columnas en Casos recientes | Cubre la pregunta de negocio y el detalle por cancelación |

---

## 3. La contradicción con la migración existente, y por qué se resuelve así

`migrations/20260930120000_case-metadata-and-human-reviews.sql:48-50` dice textualmente:

> `guideline` (Lineamiento) NO es `audit.rule`: ese es texto libre que genera el
> modelo y no es una dimensión confiable. Derivar el filtro de ahí sería
> exactamente lo que hay que evitar.

Y el `COMMENT` de `cases.country` (`:60-61`):

> Dimension del caso (pais). NULL hasta que exista el catalogo real. **NO se infiere
> ni se deriva de texto generado por la IA.**

Este trabajo hace exactamente lo que esas notas prohíben. La diferencia que lo hace
legítimo, y que debe quedar escrita en el código:

- `audit.rule` es **texto libre**: el modelo puede emitir cualquier cadena, así que un
  `GROUP BY` sobre ella no agrupa nada confiable.
- `origin.country` / `origin.channel` son **enums cerrados validados por Zod**
  (`.strict()`), igual que `AUDIT_RESULTS` o `TEMPORAL_RELATIONS`. Si el modelo emite
  un valor fuera de catálogo, `SCHEMA_VALIDATION_ERROR` y el caso no se dictamina.
- Cada valor viaja con `evidenceIds` + `evidenceText`, y queda **dentro de
  `result_json`**, que es inmutable. La trazabilidad (`TRACE_EVERY_DECISION`) está
  garantizada de por vida en el dictamen.
- Las columnas de `cases` son una **proyección desnormalizada** para poder filtrar.
  La fuente de verdad sigue siendo el assessment.

**Acción:** actualizar el `COMMENT ON COLUMN` de `cases.country` y añadir el de
`cases.channel` para que digan la verdad nueva, reemplazando la prohibición anterior.

---

## 4. Vocabularios cerrados

Nuevos en `src/skills/audit/types.ts`, siguiendo el patrón de `AUDIT_RESULTS:10`.

```ts
/** Mercados donde opera el programa. */
export const EVIDENCE_COUNTRIES = [
  'MX', 'CO', 'AR', 'CL', 'PE', 'BR', 'EC', 'PA', 'PR', 'DO', 'GT',
] as const;
export type EvidenceCountry = (typeof EVIDENCE_COUNTRIES)[number];

/** Vía por la que el estudiante expresa la cancelación. */
export const EVIDENCE_CHANNELS = [
  'WHATSAPP', 'CRM', 'I6', 'SIU', 'FLOKZU', 'EMAIL', 'CALL',
] as const;
export type EvidenceChannel = (typeof EVIDENCE_CHANNELS)[number];
```

Etiquetas en español en `src/lib/labels.ts`, **una sola copia** (ver §11).

---

## 5. Schema del assessment

`src/skills/audit/schema.ts` — bloque hermano de `temporalAnalysis` (`:109`), que es
el precedente exacto: campo de nivel raíz, requerido, con su `.strict()`.

```ts
export const OriginSchema = z.object({
  country: z.enum(EVIDENCE_COUNTRIES).nullable(),
  channel: z.enum(EVIDENCE_CHANNELS).nullable(),
  evidenceIds: z.array(z.string().min(1)),
  evidenceText: z.string().nullable(),
}).strict();
```

y en `AiAuditAssessmentSchema`:

```ts
origin: OriginSchema,
```

**Requerido, no `.optional()`**, igual que `temporalAnalysis`. El contrato es fuerte a
propósito: si el modelo omite `origin`, el caso termina en `ERROR` con
`SCHEMA_VALIDATION_ERROR`. Es `FAIL_CLOSED` consistente con el resto del Skill.

**Regla de los valores `null`:** `null` significa "no determinable con esta evidencia".
`null` es un valor legítimo y NO obliga a `NEEDS_INPUT`: el dictamen no depende del país.
`NEEDS_INPUT` sigue reservada para falta de evidencia que afecta la **clasificación**.

Si un valor es no-null, `evidenceIds` debe ser no vacío. Se valida en
`validateBusinessRules` (`schema.ts`), no en el shape.

---

## 6. Instrucciones del prompt

`src/skills/audit/instructions.ts` — nueva sección `ORIGIN_RULES`, modelada sobre
`CYCLE_START_DATE_RULES:71`, porque el defecto que corrige es el mismo: hoy el prompt
**nombra** los canales como ejemplo (`instructions.ts:78`) y nunca los canaliza.

Debe exigir:

- Recorrer **todas** las evidencias buscando el país de operación y la vía de contacto,
  con independencia del sistema y del formato.
- El canal es el medio por el que el estudiante **expresó la cancelación**. Distinguir
  el canal de origen del canal administrativo: una cancelación puede originarse en
  WhatsApp y registrarse después en CRM o SIU, y eso NO cambia el canal de origen.
- **Nunca** deducir el país del código postal, del dominio del correo o de la
  moneda. Solo de evidencia explícita o inequívoca.
- Si no hay evidencia: `country: null`, `channel: null`, `evidenceIds: []`.

---

## 7. Proyección a las dimensiones del caso

Nuevo en `src/server/audit-service.ts`, **después** de que Zod valida el assessment.

Reglas de escritura:

1. Solo se escribe un valor **no-null**. Un `null` del modelo **nunca** borra un valor
   ya existente en `cases` (protege contra una re-auditación con evidencia más pobre).
2. Es idempotente: re-auditar el mismo caso con el mismo resultado no cambia nada.
3. Un fallo al escribir las dimensiones **no** invalida el dictamen ya persistido: el
   dictamen es la fuente de verdad; las dims son proyección. Se registra el error.

La evidencia de la extracción **no** se duplica en `cases`: vive en `result_json`.

---

## 8. Migración

Nueva, forward-only e idempotente, con bloque `$verify$` y GRANTS, siguiendo el patrón
de `20260930120000`.

1. `ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS channel text;`
2. `COMMENT ON COLUMN` de `channel`, y **reescribir** el de `country` (§3).
3. Recrear `public.audit_dashboard_metrics` projectionando `c.channel`
   (hoy `:239-244` proyecta `country` … `guideline`).
   **La vista se RECREA, no se modifica**: `CREATE OR REPLACE VIEW` no puede alterar la
   lista de columnas (ver el aviso en `:133`). Sigue el patrón `DROP` + `CREATE` que ya
   usa esa migración.
4. Repetir `REVOKE` a `anon` / `authenticated` / `PUBLIC` y `GRANT SELECT` a
   `project_admin` sobre la vista.

Se mantiene `text` y no FK, coherente con las 6 dims existentes: el catálogo del CRM
sigue sin existir (`LEGACY_IS_NOT_POLICY`).

La aplicación de esta migración queda sujeta a la conciliación oficial descrita
en [`docs/MIGRATION-RECONCILIATION.md`](../../MIGRATION-RECONCILIATION.md). No
aplicar SQL directamente con `db query`.

---

## 9. Filtros

`src/server/dashboard-filters.ts`:

- `ALL_DIMENSIONS` (`:184`) += `channel`.
- `CASE_DIMENSIONS` (`:99`), `CASE_DIMENSION_LABELS` (`:111`) y `CASE_DIMENSION_COLUMN`
  (`:121`) += `channel` → `'Canal'` / `'channel'`.
- `DashboardFiltersQuerySchema` (`:145-151`) += `channel: DimensionSchema.optional()`.
- **`SUPPORTED_DIMENSIONS` (`:198`) pasa de `[]` a `['country', 'channel']`.**

Las otras 4 dims (`campus`, `modality`, `project`, `responsible`) **siguen bloqueadas**:
no tienen escritor y quedarían permanentemente sin opciones.

El comentario de `:193-197` ("Actualmente ninguna está proyectada en la vista") está
**desactualizado** — la vista sí las proyecta. Se corrige.

Las opciones del dropdown siguen saliendo de `getDashboardFilterOptions`
(`dashboard.ts:131-161`, `SELECT DISTINCT ... WHERE col IS NOT NULL`). **No** se cambia
a "todo el enum": la migración (`:34-37`) lo justifica explícitamente para no ofrecer
valores ficticios en una dimensión vacía. Con datos reales, el DISTINCT ofrece solo lo
que existe.

`AI_QUALITY_COLUMNS` (`dashboard.ts:1905-1907`) ya incluye `country` y las otras 5
dims (`id, created_at, case_status, audit_status, confidence,
missing_evidence_count, country, campus, modality, project, responsible, guideline`).
Solo hay que **agregar `channel`** a esa lista: `country` ya viaja hoy, simplemente
llegan siempre en `NULL` porque nadie la escribe.

`getDashboardSummary` usa `.select('*')` (`dashboard.ts:631`), así que trae las dims sin
tocar su lista de columnas. Y `applyDimensionFilters` ya se aplica ahí (`:636`).

Conclusión: **una sola vista recreada sirve a los tres consumidores** (summary, quality
y filter options). El trabajo en `dashboard.ts` se limita a la constante, el DTO y los
agregadores.

---

## 10. Resumen

`aggregateSummary` (`dashboard.ts:479`) y su DTO:

- `byCountry: Array<{ value: string; label: string; count: number }>`
- `byChannel: Array<{ value: string; label: string; count: number }>`
- `recentCases[]` += `country`, `channel` (nullable, con `label` resuelto en cliente)

UI (`src/components/dashboard/OverviewPage.tsx`):

- Dos gráficos nuevos calcados del patrón de "Distribución de resoluciones" (`:140`).
- Dos columnas en "Casos recientes" (`:169`), mostrando `«Sin determinar»` cuando es
  `null` — nunca una celda vacía, que se lee como dato faltante y no como no aplicable.

---

## 11. Etiquetas: una sola fuente

Hoy la lista de dimensiones está **quintuplicada**:

1. `src/lib/dashboard.ts:45-55` — `DASHBOARD_DIMENSIONS` (origen del tipo `DashboardDimension`)
2. `src/lib/dashboard-shared.ts:21-26` — `DashboardFilters` repite las 6 como props opcionales
3. `src/server/dashboard-filters.ts:99-128` — `CASE_DIMENSIONS` + etiquetas + mapa de columna
4. `src/server/dashboard.ts:101-108` — `DASHBOARD_DIMENSIONS` (runtime, para `applyDimensionFilters` y opciones)
5. `src/components/dashboard/DashboardFilters.tsx:20-27` — `DIMENSION_LABELS`

Agregar país/canal como sexto consumidor sería la prueba de que esto ya no escala.

**Consolidación:** `src/lib/dashboard-shared.ts` es el módulo correcto — no importa nada
y lo cargan cliente y servidor (`dashboard.ts:1-13` documenta exactamente por qué
`lib/dashboard.ts` no sirve: arrastra `local-dashboard-preview`, que es código de navegador).
Ahí queda la lista, el tipo, las etiquetas y `DashboardFilters` derivado de la lista:

```ts
export const DASHBOARD_DIMENSIONS = [
  'country', 'channel', 'campus', 'modality', 'project', 'responsible', 'guideline',
] as const;
export type DashboardDimension = (typeof DASHBOARD_DIMENSIONS)[number];
export const DIMENSION_LABELS: Record<DashboardDimension, string>;
export type DashboardFilters = { from: string; to: string; result: string|null; status: string|null }
  & Partial<Record<DashboardDimension, string | null>>;
```

`lib/dashboard.ts` lo reexporta, así que los imports del cliente no cambian. Las 4
consumidoras restantes pasan a leer de ahí.

Además, el dropdown de `DashboardFilters.tsx:201` pinta el valor **tal cual**: con el
código ISO en la base, el filtro se vería "MX" en vez de "México". Se resuelve en el
render con `originLabel()`, sin cambiar `DashboardFilterOptions` (sigue siendo
`Record<DashboardDimension, string[]>`) ni la API.

---

## 12. Compatibilidad hacia atrás

Auditorías ya persistidas **no** tienen `origin`. `result_json` es inmutable y no se
reescribe.

**No hace falta un helper de lectura tolerante, y esa es la mejor noticia del diseño.**
El país y el canal que se muestran y filtran salen de las **columnas de la vista**
(`cases.country` / `cases.channel`), no de leer `origin` dentro de `result_json`. Para
un caso viejo esas columnas están en `NULL` por construcción, sin ninguna lectura
defensiva: es el mismo `null` que representa "no determinable", y la UI lo muestra
como "Sin determinar" (`originLabel`). El único punto donde `origin` se lee es
`audit-service.ts`, recién emitido por el modelo, donde el tipo garantiza que existe.

Confirmado además que `result_json` nunca se reparsea con `AuditResultSchema`: `dto.ts:227`
y `:332` lo leen con `parseJsonField` → `unknown`. El schema exigido solo aplica a la
respuesta fresca del modelo.

- Un `origin` ausente en un dictamen viejo **no** es `NEEDS_INPUT` ni obliga a
  re-dictaminar: el dictamen es histórico y su contrato era el de su época.

### Bump de `AUDIT_PIPELINE_VERSION`

`audit-service.ts:267` pasa de `'audit-v5-pipeline-1'` a `'audit-v5-pipeline-2'`.

Sin este bump, `computeEvidenceFingerprint` (`:289`) no cambia, un caso viejo re-ejecutado
**reutiliza** un dictamen emitido bajo el contrato anterior (sin `origin`) y el schema
nuevo queda sin validar. El bump es el mecanismo que registra el cambio de contrato.

**Consecuencia asumida:** si alguien re-ejecuta un caso viejo con la misma evidencia, se
re-audita y se vuelve a pagar. No se dispara automáticamente; solo ocurre por acción
explícita. Consistente con el comentario de `:262-266`.

---

## 13. Tests

**A reescribir** (afirman el comportamiento que cambia a propósito):

| Archivo | Qué cambia |
|---|---|
| `tests/dashboard-filters.test.ts:135-141` | Afirma el 400 con `country: 'MX'` y el mensaje literal `"from, to, result y status"`. Se reescribe para afirmar que `country`/`channel` ahora **pasan**, y que `campus` **sigue** dando 400 |
| `tests/dashboard-db.test.ts:244-267` | `toEqual` de la lista **exacta** de columnas de quality. Se actualiza **solo** agregando `channel` (`country` ya estaba) |

**A actualizar:**

- `tests/fixtures/audit-result.ts` — agregar `origin`.
- `tests/schema.test.ts` — `origin` requerido; enum inválido rechazado; `null` aceptado.

**A agregar:**

- assessment sin `origin` → `SCHEMA_VALIDATION_ERROR` (fail-closed).
- `country` no-null con `evidenceIds` vacío → rechazado por reglas de negocio.
- `origin` ausente en un dictamen legado → las columnas quedan `NULL` y la UI muestra
  "Sin determinar" sin romperse (cubierto por la columna `null` de Casos recientes).
- dims no-null se escriben en `cases`; `null` **no** borra un valor existente.
- Filtro `country=XX` y `channel=YY` reducen la vista de Calidad.
- Filtro `country=ZZ` (fuera de catálogo) **no** es 400: devuelve 0 filas. `country` es
  `text` sin `CHECK` en la base; el vocabulario cerrado se aplica al modelo, no al filtro.
- `getLocalDashboardPreviewSummary` sigue compilando con los campos nuevos requeridos.

---

## 14. Invariantes que este cambio toca

| Invariante | Cómo se preserva |
|---|---|
| `TRACE_EVERY_DECISION` | `evidenceIds` + `evidenceText` en `result_json`, inmutable |
| El dictamen ES el assessment | El backend no reclasifica: proyecta, no decide |
| `FAIL_CLOSED` | Enum inválido → `SCHEMA_VALIDATION_ERROR`; `origin` ausente → error |
| `DO_NOT_REPROCESS_AI_UNNECESSARILY` | Solo casos nuevos; sin backfill automático |
| `NULL` ≠ `0` | `null` se muestra como "Sin determinar", nunca como 0 ni celda vacía |
| `HOBBY_FUNCTION_BUDGET` | **12 archivos en `api/`**: no se agrega ninguna Function |
| `KEEP_IT_SIMPLE` | Sin capa de compatibilidad; sin microservicios |
| `LEGACY_IS_NOT_POLICY` | No se anticipa el catálogo del CRM: `text`, no FK |

**`HOBBY_FUNCTION_BUDGET` confirmado:** este cambio no necesita endpoint nuevo. La
proyección se escribe dentro del flujo de auditoría que ya existe.

---

## 15. Fuera de alcance

- Poblado manual de `campus`, `modality`, `project`, `responsible` (siguen sin escritor).
- Backfill de casos ya auditados.
- Corregir `cases.country` a mano desde la UI.
- Catálogo del CRM con IDs reales (`country_id uuid REFERENCES`).
- Migración de `guideline` a catálogo.

---

## 16. Riesgos

| Riesgo | Mitigación |
|---|---|
| El modelo no emite `origin` → casos en `ERROR` | Es intencional (fail-closed), pero es el riesgo operativo #1 de este cambio. Mitigable con `scripts/run-ai-smoke.mjs` antes de desplegar |
| 11 países pueden quedar cortos si el programa entra a otro mercado | Editar `EVIDENCE_COUNTRIES` en `types.ts`. **No** requiere `npm run policy:generate`: la política se serializa desde `policy/*.md` y es independiente de estas constantes |
| Reescribir `COMMENT ON COLUMN country` **contradice** la nota original | Es deliberado y queda documentado en el propio SQL, con la justificación de §3 |
| `SELECT DISTINCT` sobre 5000 filas por request | Comportamiento preexistente. No se empeora: se agrega una dimensión más al mismo fetch |
| Los filtros de `Quality` ignoran `country`/`channel` si la vista no se recrea | `$verify$` en la migración comprueba la proyección |
