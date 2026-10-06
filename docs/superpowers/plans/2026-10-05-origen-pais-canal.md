# ExtracciÃ³n de PAÃS y CANAL de origen â€” Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el modelo extraiga `country` y `channel` de cada cancelaciÃ³n con evidencia citada, que se persistan como dimensiones del caso, y que se vean y filtren en Resumen y Calidad.

**Architecture:** Un bloque `origin` nuevo en el assessment del Audit Skill (enum cerrado + `evidenceIds` + `evidenceText`, validado por Zod, fail-closed). El backend lo **proyecta** a `cases.country` / `cases.channel` despuÃ©s de validar; la fuente de verdad sigue siendo `result_json`. Una migraciÃ³n recrea `audit_dashboard_metrics` proyectando `channel` (una sola vista sirve a los tres consumidores). Los filtros `country`/`channel` salen de una allowlist que hoy estÃ¡ vacÃ­a.

**Tech Stack:** TypeScript 5.8 estricto, Zod 3.25, React 19, Recharts 3, Vitest 2, InsForge/PostgREST, Vercel Functions.

**Spec:** `docs/superpowers/specs/2026-10-05-origen-pais-canal-design.md` â€” el spec viaja con este plan.

## Global Constraints

- Vocabulario **cerrado**, exactos: `EVIDENCE_COUNTRIES = ['MX','CO','AR','CL','PE','BR','EC','PA','PR','DO','GT']`, `EVIDENCE_CHANNELS = ['WHATSAPP','CRM','I6','SIU','FLOKZU','EMAIL','CALL']`.
- `origin` es **requerido** en `AiAuditAssessmentSchema` (no `.optional()`), igual que `temporalAnalysis`.
- `null` = "no determinable". `null` **nunca** se cuenta como `0` ni borra un valor ya escrito.
- Solo casos nuevos: **sin backfill**.
- Solo se escriben dimensiones **no-null**.
- `HOBBY_FUNCTION_BUDGET`: `api/` queda en **12 archivos**. Ninguna tarea de este plan aÃ±ade una Function (verificado: hoy son exactamente 12).
- Los catÃ¡logos de `types.ts` **no** requieren `npm run policy:generate`: la polÃ­tica se serializa desde `policy/*.md` y es independiente.
- Nada de texto nuevo en el Assessment es criterio normativo (`POLICY_IS_IMMUTABLE`): `country`/`channel` son metadatos descriptivos, no reglas del Procedimiento V5.
- EspaÃ±ol en documentaciÃ³n y UI. CÃ³digo tÃ©cnico en inglÃ©s cuando mejora claridad.
- `DashboardFilters` y `DashboardDimension` pasan a vivir en `src/lib/dashboard-shared.ts` (mÃ³dulo sin imports). `src/lib/dashboard.ts` los reexporta; los imports de los componentes **no cambian**.

## Review Focus

Cinco modos de fallo que el spec implica y que hay que fijar con un test cada uno:

1. **El modelo no emite `origin`** â†’ todo caso nuevo cae a `ERROR` con `SCHEMA_VALIDATION_ERROR`. Es intencional (fail-closed), pero es el riesgo operativo #1. Test en Task 3; verificaciÃ³n en vivo en Task 11.
2. **`origin.country` no-null con `evidenceIds: []`** â†’ un valor sin trazabilidad, que es exactamente lo que `TRACE_EVERY_DECISION` prohÃ­be. Test en Task 3.
3. **Un `null` del modelo borra un `cases.country` ya escrito** â†’ una re-auditaciÃ³n con evidencia mÃ¡s pobre destruirÃ­a el dato. Test en Task 6.
4. **Filtro `?country=ZZ` con un valor fuera de catÃ¡logo** â†’ debe devolver 0 filas (dato), no 400 (error de validaciÃ³n), porque `country` es `text` en la base sin `CHECK`. El vocabulario cerrado se aplica al modelo, no al filtro. Test en Task 8.
5. **Un dictamen legado sin `origin`** (auditorÃ­as ya persistidas) â†’ el detalle del caso debe renderizar sin romperse. Test en Task 10.

---

## File Structure

| Archivo | Responsabilidad | Tarea |
|---|---|---|
| `src/skills/audit/types.ts` | Vocabulario cerrado: paÃ­ses y canales | 1 |
| `src/lib/labels.ts` | Etiquetas en espaÃ±ol + `originLabel()` | 1 |
| `src/lib/dashboard-shared.ts` | **Ãšnica** lista de dimensiones, tipo, etiquetas, `DashboardFilters` | 2 |
| `src/lib/dashboard.ts` | Reexporta lo de arriba; DTOs de las nuevas distribuciones | 2, 9 |
| `src/server/dashboard.ts` | AgregaciÃ³n `byCountry`/`byChannel`; `channel` en `AI_QUALITY_COLUMNS` | 2, 9 |
| `src/server/dashboard-filters.ts` | Allowlist: `SUPPORTED_DIMENSIONS = ['country','channel']` | 2, 8 |
| `src/skills/audit/schema.ts` | `OriginSchema`, regla de negocio `validateOrigin` | 3 |
| `src/skills/audit/instructions.ts` | `ORIGIN_RULES` en el system prompt | 4 |
| `src/skills/audit/execute.ts` | `checkIds` sobre `origin.evidenceIds` | 5 |
| `src/server/audit-service.ts` | Bump de `AUDIT_PIPELINE_VERSION`; llamada a la proyecciÃ³n | 5, 6 |
| `src/server/cases.ts` | `updateCaseDimensions()` | 6 |
| `migrations/20261005120000_origin-country-channel.sql` | Columna `channel`, vista recreada, GRANTS, `$verify$` | 7 |
| `src/components/dashboard/charts/OriginBreakdownChart.tsx` | **Un** grÃ¡fico de barras, reutilizado por paÃ­s y canal | 10 |
| `src/components/dashboard/RecentCasesTable.tsx` | Dos columnas nuevas | 10 |
| `src/components/dashboard/OverviewPage.tsx` | Dos `ChartFrame` nuevos | 10 |
| `src/components/dashboard/DashboardFilters.tsx` | Etiqueta de opciÃ³n legible (`MX` â†’ `MÃ©xico`) | 2, 10 |

---

### Task 1: Vocabulario cerrado y etiquetas

**Files:**
- Modify: `src/skills/audit/types.ts` (append tras `EVIDENCE_KINDS:60`)
- Modify: `src/lib/labels.ts`
- Test: `tests/origin-vocabulary.test.ts` (crear)

**Interfaces:**
- Consumes: nada.
- Produces: `EVIDENCE_COUNTRIES: readonly ['MX','CO','AR','CL','PE','BR','EC','PA','PR','DO','GT']`, `EvidenceCountry`, `EVIDENCE_CHANNELS: readonly ['WHATSAPP','CRM','I6','SIU','FLOKZU','EMAIL','CALL']`, `EvidenceChannel`, `COUNTRY_LABELS: Record<EvidenceCountry,string>`, `CHANNEL_LABELS: Record<EvidenceChannel,string>`, `UNDETERMINED_LABEL = 'Sin determinar'`, `originLabel(kind: 'country'|'channel', value: string|null): string`.

- [x] **Step 1: Escribir el test que falla**

Crear `tests/origin-vocabulary.test.ts`:

```ts
import { describe, expect, it } from 'vitest';
import {
  EVIDENCE_CHANNELS, EVIDENCE_COUNTRIES,
} from '../src/skills/audit/types';
import { CHANNEL_LABELS, COUNTRY_LABELS, originLabel, UNDETERMINED_LABEL } from '../src/lib/labels';

describe('vocabulario de origen', () => {
  it('tiene los 11 paÃ­ses y los 7 canales exactos', () => {
    expect([...EVIDENCE_COUNTRIES]).toEqual(['MX','CO','AR','CL','PE','BR','EC','PA','PR','DO','GT']);
    expect([...EVIDENCE_CHANNELS]).toEqual(['WHATSAPP','CRM','I6','SIU','FLOKZU','EMAIL','CALL']);
  });

  it('tiene etiqueta en espaÃ±ol para cada valor del catÃ¡logo', () => {
    for (const country of EVIDENCE_COUNTRIES) expect(COUNTRY_LABELS[country]).toBeTruthy();
    for (const channel of EVIDENCE_CHANNELS) expect(CHANNEL_LABELS[channel]).toBeTruthy();
  });

  it('etiquetas en espaÃ±ol exactas', () => {
    expect(COUNTRY_LABELS.MX).toBe('MÃ©xico');
    expect(COUNTRY_LABELS.DO).toBe('RepÃºblica Dominicana');
    expect(CHANNEL_LABELS.WHATSAPP).toBe('WhatsApp');
    expect(CHANNEL_LABELS.EMAIL).toBe('Correo electrÃ³nico');
    expect(CHANNEL_LABELS.CALL).toBe('Llamada');
  });

  it('un valor null se muestra como Sin determinar, nunca vacÃ­o', () => {
    expect(originLabel('country', null)).toBe(UNDETERMINED_LABEL);
    expect(originLabel('channel', null)).toBe(UNDETERMINED_LABEL);
  });

  it('un valor fuera de catÃ¡logo cae al valor crudo en vez de romperse', () => {
    expect(originLabel('country', 'ZZ')).toBe('ZZ');
  });
});
```

- [x] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run tests/origin-vocabulary.test.ts`
Expected: FAIL â€” los exports no existen.

- [x] **Step 3: Implementar los catÃ¡logos**

En `src/skills/audit/types.ts`, despuÃ©s de `EVIDENCE_KINDS` (lÃ­nea 60), aÃ±adir los dos arrays const y sus tipos, cada uno con un docstring que aclare que es vocabulario **cerrado** y que un valor fuera de catÃ¡logo es un error del modelo, no un dato.

En `src/lib/labels.ts`, aÃ±adir `COUNTRY_LABELS` (11 entradas: MÃ©xico, Colombia, Argentina, Chile, PerÃº, Brasil, Ecuador, PanamÃ¡, Puerto Rico, RepÃºblica Dominicana, Guatemala), `CHANNEL_LABELS` (7 entradas: WhatsApp, CRM, I6, SIU, Flokzu, Correo electrÃ³nico, Llamada), `UNDETERMINED_LABEL`, y `originLabel(kind, value)` que devuelve `UNDETERMINED_LABEL` si el valor es `null` o vacÃ­o, y en cualquier otro caso la etiqueta del catÃ¡logo **con fallback al valor crudo**.

El fallback es deliberado: si la base tuviera un valor de un catÃ¡logo anterior, la UI lo muestra tal cual en vez de mostrar "Sin determinar", que serÃ­a un dato falso.

- [x] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run tests/origin-vocabulary.test.ts`
Expected: PASS, 5 tests.

- [x] **Step 5: Gate de tarea**

Run: `npx tsc --noEmit`
Expected: sin errores.

---

### Task 2: Consolidar las dimensiones del dashboard en un solo mÃ³dulo

Esta tarea existe porque la lista de dimensiones estÃ¡ **quintuplicada** (`lib/dashboard.ts:45`, `lib/dashboard-shared.ts:21`, `server/dashboard-filters.ts:99`, `server/dashboard.ts:101`, `DashboardFilters.tsx:20`). Agregar `channel` a cinco sitios es como la lista deja de describir la realidad.

**Files:**
- Modify: `src/lib/dashboard-shared.ts:15-27`
- Modify: `src/lib/dashboard.ts:45-78`
- Modify: `src/server/dashboard-filters.ts:99-128,183-198`
- Modify: `src/server/dashboard.ts:101-108`
- Modify: `src/components/dashboard/DashboardFilters.tsx:20-27`
- Test: `tests/dashboard-dimensions.test.ts` (crear)

**Interfaces:**
- Consumes: nada de Task 1.
- Produces, desde `src/lib/dashboard-shared.ts`: `DASHBOARD_DIMENSIONS: readonly ['country','channel','campus','modality','project','responsible','guideline']`, `DashboardDimension`, `DIMENSION_LABELS: Record<DashboardDimension,string>`, `CASE_DIMENSION_COLUMN: Record<DashboardDimension,string>`, y `DashboardFilters` (igual que hoy, mÃ¡s `channel`).

- [x] **Step 1: Escribir el test que falla**

Crear `tests/dashboard-dimensions.test.ts`:

```ts
it('la lista de dimensiones incluye channel exactamente una vez', () => {
  expect([...DASHBOARD_DIMENSIONS]).toEqual(['country','channel','campus','modality','project','responsible','guideline']);
});

it('toda dimensiÃ³n tiene etiqueta y columna', () => {
  for (const dimension of DASHBOARD_DIMENSIONS) {
    expect(DIMENSION_LABELS[dimension]).toBeTruthy();
    expect(CASE_DIMENSION_COLUMN[dimension]).toBe(dimension);
  }
});
```

- [x] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run tests/dashboard-dimensions.test.ts`
Expected: FAIL â€” `channel` no estÃ¡ en la lista.

- [x] **Step 3: Mover la fuente de verdad a `dashboard-shared.ts`**

En `src/lib/dashboard-shared.ts`, aÃ±adir `DASHBOARD_DIMENSIONS` con los 7 valores, `DashboardDimension`, `DIMENSION_LABELS` (`country: 'PaÃ­s'`, `channel: 'Canal'`, mÃ¡s las 5 existentes) y `CASE_DIMENSION_COLUMN` (mapa identidad). Reescribir el tipo `DashboardFilters` de props explÃ­citas a:

```ts
export type DashboardFilters = {
  from: string;
  to: string;
  result: string | null;
  status: string | null;
} & Partial<Record<DashboardDimension, string | null>>;
```

Es exactamente equivalente a las props explÃ­citas de hoy, mÃ¡s `channel`.

- [x] **Step 4: Convertir a reexportaciÃ³n las otras cuatro copias**

- `src/lib/dashboard.ts`: borrar el `DASHBOARD_DIMENSIONS`, el tipo `DashboardDimension` y `DIMENSION_LABELS` locales; reexportarlos desde `./dashboard-shared`. AÃ±adir `channel` a `EMPTY_DASHBOARD_FILTER_OPTIONS`.
- `src/server/dashboard-filters.ts`: borrar `CASE_DIMENSIONS`, `CaseDimension`, `CASE_DIMENSION_LABELS` y `CASE_DIMENSION_COLUMN`; importarlos de `../lib/dashboard-shared.js` y reexportar los que ya exponÃ­a. Borrar el `ALL_DIMENSIONS` local y usar `DASHBOARD_DIMENSIONS`. Corregir el docstring de `SUPPORTED_DIMENSIONS` (`:193-197`): ya no afirmar que "ninguna estÃ¡ proyectada en la vista", porque es falso.
- `src/server/dashboard.ts`: borrar `DASHBOARD_DIMENSIONS` (`:101-108`) e importarlo de `../lib/dashboard-shared.js`.
- `src/components/dashboard/DashboardFilters.tsx`: borrar `DIMENSION_LABELS` (`:20-27`) e importarlo de `../../lib/dashboard`.

**Por quÃ© `dashboard-shared.ts` y no `lib/dashboard.ts`:** `lib/dashboard.ts:23` importa `local-dashboard-preview`, que es cÃ³digo de NAVEGADOR. Si el servidor lo importara en runtime, la build pasarÃ­a y la Function reventarÃ­a al invocarse con `ERR_MODULE_NOT_FOUND` â€” el fallo exacto que el header de `dashboard-shared.ts:1-13` documenta.

- [x] **Step 5: Correr el test y la suite del dashboard**

Run: `npx vitest run tests/dashboard-dimensions.test.ts tests/dashboard-filters.test.ts tests/dashboard-db.test.ts`
Expected: PASS. Los tests existentes **no** se tocan en esta tarea: siguen afirmando el comportamiento viejo (dimensiones rechazadas), que es correcto hasta la Task 8.

- [x] **Step 6: Gate de tarea**

Run: `npx tsc --noEmit`
Expected: sin errores. Si algÃºn import de `DashboardDimension` quedÃ³ apuntando al archivo viejo, el compilador lo seÃ±ala.

---

### Task 3: `origin` en el contrato del assessment

**Files:**
- Modify: `src/skills/audit/schema.ts` (`OriginSchema` tras `TemporalAnalysisSchema:33`; `origin:` en `AiAuditAssessmentSchema` tras `temporalAnalysis:109`; `ValidatedAssessment:155`; `validateOrigin` + llamada en `validateBusinessRules:307`; import en la lÃ­nea 2)
- Modify: `tests/fixtures/audit-result.ts` (aÃ±adir `origin` tras `temporalAnalysis:52`)
- Test: `tests/origin-schema.test.ts` (crear)

**Interfaces:**
- Consumes: `EVIDENCE_COUNTRIES`, `EVIDENCE_CHANNELS` de Task 1.
- Produces: `OriginSchema`; tipo `origin = { country: EvidenceCountry|null; channel: EvidenceChannel|null; evidenceIds: string[]; evidenceText: string|null }`.

- [x] **Step 1: Escribir los tests que fallan**

En `tests/fixtures/audit-result.ts`, aÃ±adir tras el bloque `temporalAnalysis`:

```ts
origin: {
  country: 'MX',
  channel: 'WHATSAPP',
  evidenceIds: ['ev-1'],
  evidenceText: 'Estudiante en MÃ©xico pide cancelar por WhatsApp',
},
```

Crear `tests/origin-schema.test.ts` con seis casos sobre `parseAuditResult`:

1. `validAuditResult` pasa y `.origin.country` es `'MX'`.
2. Assessment **sin** `origin` (borrando la clave de una copia del fixture) lanza `ApiError` `INVALID_AI_RESPONSE` con mensaje que contiene `origin`. â†’ Review Focus #1.
3. `origin.country: 'ZZ'` lanza error cuyo mensaje contiene `origin.country`.
4. `origin.channel: 'SMS'` lanza error cuyo mensaje contiene `origin.channel`.
5. `origin: { country: 'MX', channel: null, evidenceIds: [], evidenceText: null }` **lanza** error. â†’ Review Focus #2.
6. `origin: { country: null, channel: null, evidenceIds: [], evidenceText: null }` **pasa**.

- [x] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run tests/origin-schema.test.ts`
Expected: FAIL â€” `origin` no estÃ¡ en el schema.

- [x] **Step 3: Implementar `OriginSchema`**

Definir `OriginSchema` con `country: z.enum(EVIDENCE_COUNTRIES).nullable()`, `channel: z.enum(EVIDENCE_CHANNELS).nullable()`, `evidenceIds: z.array(z.string().min(1))`, `evidenceText: z.string().nullable()`, y `.strict()`.

AÃ±adir `origin: OriginSchema,` en `AiAuditAssessmentSchema` inmediatamente despuÃ©s de `temporalAnalysis: TemporalAnalysisSchema,`.

- [x] **Step 4: Implementar `validateOrigin`**

Declarar en `ValidatedAssessment` el campo `origin: { country: string | null; channel: string | null; evidenceIds: string[] }`.

AÃ±adir la funciÃ³n con el estilo de `validateContactAttemptsMinimum` (`ApiError(502,'INVALID_AI_RESPONSE','INVALID_AI_RESPONSE: origin.â€¦')`): lanza si `country !== null && evidenceIds.length === 0`, y tambiÃ©n si `channel !== null && evidenceIds.length === 0`.

Llamarla desde `validateBusinessRules`, junto a las otras dos llamadas de `:306-307`.

**Por quÃ© en reglas de negocio y no en el shape:** el shape no puede expresar "si country es no-null entonces evidenceIds tiene al menos un elemento"; sÃ­ puede una regla de negocio, y ese archivo ya es el sitio de las imposibilidades internas (`validateTemporalCoherence:334`).

- [x] **Step 5: Correr los tests para verificar que pasan**

Run: `npx vitest run tests/origin-schema.test.ts tests/schema.test.ts tests/cycle-start-date.test.ts`
Expected: PASS. `cycle-start-date.test.ts` comprueba que aÃ±adir un campo requerido no rompiÃ³ las reglas temporales.

- [x] **Step 6: Gate de tarea**

Run: `npx tsc --noEmit`
Expected: sin errores.

---

### Task 4: Instrucciones del prompt

**Files:**
- Modify: `src/skills/audit/instructions.ts` (`ORIGIN_RULES` antes de `buildSystemPrompt:126`; inyectarlo junto a `${CYCLE_START_DATE_RULES}` en `:162`; un punto mÃ¡s en "Reglas de trazabilidad" `:168-195`)
- Test: `tests/origin-instructions.test.ts` (crear)

**Interfaces:**
- Consumes: `EVIDENCE_COUNTRIES`, `EVIDENCE_CHANNELS` de Task 1 (para volcar los valores permitidos en el prompt).
- Produces: `buildSystemPrompt(): string` incluye la secciÃ³n de origen.

- [x] **Step 1: Escribir el test que falla**

Crear `tests/origin-instructions.test.ts`:

```ts
it('el system prompt declara el vocabulario cerrado de paÃ­s y canal', () => {
  const prompt = buildSystemPrompt();
  for (const country of EVIDENCE_COUNTRIES) expect(prompt).toContain(country);
  for (const channel of EVIDENCE_CHANNELS) expect(prompt).toContain(channel);
});

it('el system prompt prohÃ­be deducir el paÃ­s del cÃ³digo postal, el dominio o la moneda', () => {
  const prompt = buildSystemPrompt();
  expect(prompt).toContain('cÃ³digo postal');
  expect(prompt).toContain('dominio del correo');
  expect(prompt).toContain('moneda');
});

it('el system prompt exige el bloque origin aunque no haya evidencia', () => {
  const prompt = buildSystemPrompt();
  expect(prompt).toContain('origin');
  expect(prompt).toContain('evidenceIds: []');
});

it('distingue el canal de origen del canal administrativo', () => {
  expect(buildSystemPrompt()).toContain('canal administrativo');
});
```

- [x] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run tests/origin-instructions.test.ts`
Expected: FAIL â€” el prompt no menciona los catÃ¡logos.

- [x] **Step 3: Escribir `ORIGIN_RULES` y inyectarlo**

Nueva constante exportada `ORIGIN_RULES`, con el mismo tono imperativo de `CYCLE_START_DATE_RULES` y estas obligaciones:

- Recorrer **todas** las evidencias buscando el paÃ­s de operaciÃ³n y la vÃ­a por la que el estudiante expresÃ³ la cancelaciÃ³n, con independencia del sistema y del formato.
- El canal de origen es el medio por el que el estudiante **expresÃ³** la cancelaciÃ³n; distinguirlo del canal administrativo. Una cancelaciÃ³n puede originarse en WhatsApp y registrarse despuÃ©s en CRM o SIU, y eso **no** cambia el canal de origen.
- **Nunca** deducir el paÃ­s del cÃ³digo postal, del dominio del correo ni de la moneda: solo de evidencia explÃ­cita o inequÃ­voca.
- Los Ãºnicos valores admitidos son los del catÃ¡logo, listados explÃ­citamente interpolando `EVIDENCE_COUNTRIES` y `EVIDENCE_CHANNELS`. Cualquier otro valor es un error, no un dato.
- Si no hay evidencia: `country: null`, `channel: null`, `evidenceIds: []`. Se completa **siempre**, incluso con ambos en `null`; dejarlo vacÃ­o para ahorrar tokens incumple el contrato.
- Si se afirma un valor, `evidenceIds` debe traer las evidencias que lo acreditan y `evidenceText` la cita textual.
- Un `null` en `country` o `channel` **no** obliga a `EVIDENCIA_INSUFICIENTE` ni a `missingEvidence`: son metadatos descriptivos y no afectan la clasificaciÃ³n.

Insertar `${ORIGIN_RULES}` en `buildSystemPrompt` justo despuÃ©s de `${CYCLE_START_DATE_RULES}` (lÃ­nea 162), antes de `${CONTACT_ATTEMPTS_RULES}`.

- [x] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run tests/origin-instructions.test.ts tests/execute.test.ts`
Expected: PASS.

- [x] **Step 5: Gate de tarea**

Run: `npx tsc --noEmit`
Expected: sin errores.

---

### Task 5: Referencias a evidencia y bump del pipeline

**Files:**
- Modify: `src/skills/audit/execute.ts:82` (`checkIds` sobre `origin.evidenceIds`)
- Modify: `src/server/audit-service.ts:267` (`AUDIT_PIPELINE_VERSION`)
- Test: `tests/execute.test.ts`, archivo de fingerprint (buscar con `glob tests/*fingerprint*`; si no existe, crearlo)

**Interfaces:**
- Consumes: `origin` del assessment (Task 3).
- Produces: nada nuevo exportado.

- [x] **Step 1: Escribir el test que falla**

En `tests/execute.test.ts`, aÃ±adir un test que ejercite la validaciÃ³n de referencias con `origin.evidenceIds: ['ev-inexistente']` y afirme que lanza `ApiError` con mensaje que contiene `origin.evidenceIds` y el id inventado. Reusa el arnÃ©s de los tests de referencias existentes de `facts`/`timeline`.

- [x] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run tests/execute.test.ts`
Expected: FAIL â€” la referencia inventada no se detecta.

- [x] **Step 3: Implementar la comprobaciÃ³n**

Junto a las dos lÃ­neas de `temporalAnalysis` (`:80-81`), aÃ±adir:

```ts
checkIds(assessment.origin.evidenceIds, 'origin.evidenceIds');
```

- [x] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run tests/execute.test.ts`
Expected: PASS.

- [x] **Step 5: Subir `AUDIT_PIPELINE_VERSION`**

En `audit-service.ts:267`, cambiar `'audit-v5-pipeline-1'` a `'audit-v5-pipeline-2'` y **conservar** el docstring de `:261-266`, que ya explica por quÃ© existe. AÃ±adirle una lÃ­nea que diga que el bump 2 corresponde a la incorporaciÃ³n del bloque `origin` en el contrato.

- [x] **Step 6: Fijar el efecto del bump con un test**

AÃ±adir el caso: el mismo conjunto de evidencias con distinta versiÃ³n de pipeline produce huellas distintas. Si no hay archivo de fingerprint, crear `tests/audit-fingerprint.test.ts` con ese Ãºnico test.

Run: `npx vitest run tests/audit-fingerprint.test.ts`
Expected: PASS.

- [x] **Step 7: Gate de tarea**

Run: `npx tsc --noEmit`
Expected: sin errores.

---

### Task 6: ProyecciÃ³n a las dimensiones del caso

**Files:**
- Modify: `src/server/cases.ts` (nueva `updateCaseDimensions` tras `updateCaseStatus:445`)
- Modify: `src/server/audit-service.ts` (llamada tras el `updateAuditResult` COMPLETED de `:408-415`; import de la nueva funciÃ³n)
- Test: `tests/case-dimensions.test.ts` (crear)

**Interfaces:**
- Consumes: `result.origin` (Task 3).
- Produces: `updateCaseDimensions(client: InsForgeClient, caseId: string, dimensions: { country?: string | null; channel?: string | null }): Promise<void>`.

- [x] **Step 1: Escribir los tests que fallan**

Crear `tests/case-dimensions.test.ts` con un cliente InsForge falso que registre la llamada, siguiendo el patrÃ³n de `fakeClient` que ya usan los tests de dashboard. Cuatro casos:

1. `updateCaseDimensions(client, 'case-1', { country: 'MX', channel: 'WHATSAPP' })` â†’ un `update` sobre `cases` con `{ country: 'MX', channel: 'WHATSAPP' }` filtrado por `id`.
2. `updateCaseDimensions(client, 'case-1', { country: 'MX', channel: null })` â†’ el patch es `{ country: 'MX' }`: **`channel` no aparece**. â†’ Review Focus #3.
3. `updateCaseDimensions(client, 'case-1', { country: null, channel: null })` â†’ **no** se ejecuta ninguna consulta.
4. El patch nunca contiene claves cuyo valor sea `null` ni `undefined`.

- [x] **Step 2: Correr el test para verificar que falla**

Run: `npx vitest run tests/case-dimensions.test.ts`
Expected: FAIL â€” la funciÃ³n no existe.

- [x] **Step 3: Implementar `updateCaseDimensions`**

Siguiendo el estilo de `updateCaseStatus:442-445`: construir el patch con solo las claves cuyo valor no sea `null`/`undefined`; si el patch queda vacÃ­o, **volver sin tocar la base**; si no, `update(patch).eq('id', caseId)` y `dbError(error)` si hay error.

Documentar en el docstring la regla que protege contra el borrado: un `null` del modelo significa "no determinable", nunca "borrar lo que ya se sabÃ­a".

- [x] **Step 4: Correr el test para verificar que pasa**

Run: `npx vitest run tests/case-dimensions.test.ts`
Expected: PASS, 4 tests.

- [x] **Step 5: Llamar desde el flujo de auditorÃ­a**

En `audit-service.ts`, tras el `updateAuditResult(... 'COMPLETED' ...)` de `:408-415`, aÃ±adir la proyecciÃ³n con el patrÃ³n `.catch(() => undefined)` de `updateCaseStatus(client, caseId, 'ERROR')` (`:451`):

```ts
await updateCaseDimensions(client, caseId, {
  country: result.origin.country,
  channel: result.origin.channel,
}).catch(() => undefined);
```

Con un comentario que aclare por quÃ© el fallo se traga: el dictamen ya estÃ¡ persistido en `result_json` y es la fuente de verdad; las dimensiones son proyecciÃ³n para filtrar, y perderlas no invalida el dictamen.

- [x] **Step 6: Gate de tarea**

Run: `npx tsc --noEmit && npx vitest run tests/case-dimensions.test.ts`
Expected: sin errores y PASS.

---

### Task 7: MigraciÃ³n

**Files:**
- Create: `migrations/20261005120000_origin-country-channel.sql`

**Interfaces:**
- Consumes: nada de TypeScript.
- Produces: `cases.channel` (text, NULL-able) y `audit_dashboard_metrics.channel`. **Tarea bloqueante de la 8, la 9 y la 10**: hasta que se aplique, la vista no proyecta `channel` y el filtro no puede funcionar.

- [x] **Step 1: Escribir el archivo**

Idempotente, forward-only, sin `BEGIN`/`COMMIT`, con bloque `DO $verify$` al final, siguiendo la estructura y el tono de `20260930120000_case-metadata-and-human-reviews.sql`. Secciones:

1. **Cabecera** explicando el porquÃ©: la IA extrae paÃ­s y canal como **vocabulario cerrado validado por Zod** y se proyecta a las dimensiones del caso para poder filtrar. Mencionar explÃ­citamente que esto **reemplaza** la prohibiciÃ³n del `COMMENT` anterior de `cases.country`, y por quÃ© la diferencia es que un enum no es texto libre (mismo argumento que ya usa `20260930120000:97-101`: "La base acepta el texto; la API no").
2. **`ALTER TABLE public.cases ADD COLUMN IF NOT EXISTS channel text;`**
3. **`COMMENT ON COLUMN`** de `channel`, y **`COMMENT ON COLUMN` de `country` reemplazado** por uno que diga que el valor lo extrae el modelo contra el vocabulario cerrado de `src/skills/audit/types.ts` y que la trazabilidad vive en `audits.result_json`.
4. **Recrear la vista**: copiar el `CREATE OR REPLACE VIEW public.audit_dashboard_metrics` completo de `20260930120000:147-252` (el CTE `att` completo, los joins, `human_outcome`) y aÃ±adir `c.channel` a la lista de dimensiones. Las columnas existentes conservan nombre, tipo y posiciÃ³n. Si el motor rechaza insertarla en medio, aÃ±adirla al final y decirlo en el `$verify$`.
5. **`COMMENT ON VIEW`** actualizado.
6. **Permisos**: repetir `REVOKE` a `anon`/`authenticated`/`PUBLIC` y `GRANT SELECT ... TO project_admin` sobre la vista.
7. **`DO $verify$`** que falle si: `cases.channel` no existe como `text` NULL-able; `cases.country` dejÃ³ de ser NULL-able; la vista no proyecta `channel`; y si `anon`/`authenticated` hubieran recuperado algÃºn privilegio sobre la vista.

- [x] **Step 2: Verificar la idempotencia por lectura**

Comprobar que toda sentencia lleva su guarda: `IF NOT EXISTS` en el `ALTER`, y que `COMMENT ON` / `REVOKE` / `GRANT` pueden repetirse sin efecto.

- [x] **Step 3: Aplicarla**

Run: `node scripts/apply-migration.mjs migrations/20261005120000_origin-country-channel.sql`
Expected: aplica y el `$verify$` no lanza. Si el `$verify$` falla, **para**: significa que la vista quedÃ³ sin proyectar `channel` y las tareas siguientes darÃ­an error en runtime.

- [x] **Step 4: Comprobar la idempotencia de verdad**

Run: el mismo script otra vez.
Expected: aplica de nuevo sin error.

---

### Task 8: Filtros por paÃ­s y canal

**Files:**
- Modify: `src/server/dashboard-filters.ts:198` (`SUPPORTED_DIMENSIONS`), `:139-151` (schema de query), `:204-211` (mensaje de error)
- Modify: `tests/dashboard-filters.test.ts:135-141` (**reescribir**)

**Interfaces:**
- Consumes: `DASHBOARD_DIMENSIONS`, `DIMENSION_LABELS` de Task 2; `cases.channel` + vista de Task 7.
- Produces: `parseDashboardFilters` acepta `country` y `channel`; rechaza `campus`, `modality`, `project`, `responsible` y `guideline`.

- [x] **Step 1: Reescribir el test que afirma el comportamiento viejo**

Sustituir el test de `:135-141` por tres:

1. `country: 'MX'` y `channel: 'WHATSAPP'` **parsean** sin lanzar y devuelven esos valores.
2. `campus: 'CDMX'` sigue lanzando 400 `VALIDATION_ERROR`, y el mensaje nombra `campus` y lista `country, channel` como soportadas.
3. `country: 'ZZ'` **parsea sin lanzar** y conserva el valor. â†’ Review Focus #4.

- [x] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run tests/dashboard-filters.test.ts`
Expected: FAIL â€” `country` sigue rechazado.

- [x] **Step 3: Habilitar las dos dimensiones**

`SUPPORTED_DIMENSIONS` pasa a `['country', 'channel']`. Actualizar su docstring para que diga la verdad actual: estas dos estÃ¡n proyectadas en la vista y tienen escritor (la proyecciÃ³n del assessment); las otras cinco no lo tienen.

El mensaje de `rejectUnsupportedDimensions` (`:204-211`) ya se arma desde `SUPPORTED_DIMENSIONS`, asÃ­ que emite las correctas. Actualizar la cola del mensaje: hoy promete "Puedes filtrar por from, to, result y status", y debe ofrecer tambiÃ©n `country` y `channel`.

Comprobar que `DashboardFiltersQuerySchema` (`:139-151`) acepta `channel` explÃ­citamente: el `.strict()` rechaza cualquier clave que no estÃ© declarada, asÃ­ que si no estÃ¡, el filtro se rechaza.

- [x] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run tests/dashboard-filters.test.ts`
Expected: PASS, con los tres casos nuevos.

- [x] **Step 5: Gate de tarea**

Run: `npx tsc --noEmit && npx vitest run tests/dashboard-filters.test.ts tests/dashboard-db.test.ts`
Expected: sin errores y PASS.

---

### Task 9: AgregaciÃ³n del resumen y columnas de calidad

**Files:**
- Modify: `src/lib/dashboard.ts` (tipos nuevos; `DashboardSummary` += `byCountry`, `byChannel`; `RecentCaseRow` += `country`, `channel`)
- Modify: `src/server/dashboard.ts` (`aggregateSummary:479`, `AI_QUALITY_COLUMNS:1905-1907`)
- Modify: `src/lib/local-dashboard-preview.ts:17-83` (**el preview construye un `DashboardSummary` completo**: sin estos campos, `tsc` falla)
- Test: `tests/dashboard-summary-origin.test.ts` (crear), `tests/dashboard-db.test.ts:244-267` (actualizar), `tests/local-dashboard-preview.test.ts` (revisar)

**Interfaces:**
- Consumes: `originLabel` de Task 1; la vista recreada de Task 7.
- Produces:

```ts
export interface OriginBreakdownPoint {
  value: string;   // cÃ³digo crudo ('MX', 'WHATSAPP') o UNDETERMINED_LABEL
  label: string;   // etiqueta en espaÃ±ol
  count: number;
}
export interface OriginDistribution { points: OriginBreakdownPoint[]; totalWithOrigin: number; }
```

En `DashboardSummary`: `byCountry: OriginDistribution`, `byChannel: OriginDistribution`. En `RecentCaseRow`: `country: string | null`, `channel: string | null`.

- [x] **Step 1: Escribir los tests que fallan**

Crear `tests/dashboard-summary-origin.test.ts`, construyendo filas sintÃ©ticas de `DashboardMetricRow` y llamando a `aggregateSummary`:

1. Tres filas terminales con `country: 'MX'`, una con `'CO'` y una con `country: null` â†’ `byCountry.points` = `[{MX, MÃ©xico, 3}, {CO, Colombia, 1}, {Sin determinar, Sin determinar, 1}]`, ordenado por `count` descendente y con "Sin determinar" al final.
2. `totalWithOrigin` cuenta solo las no-null: en el caso anterior, 4.
3. Una distribuciÃ³n vacÃ­a (todas `null`) â†’ `points` con **un solo** punto `{Sin determinar, Sin determinar, N}`, no `[]`. Un `[]` harÃ­a que el grÃ¡fico se vaciara sin poder distinguir "no hay datos" de "todo indeterminado".
4. Las filas NO terminales (`RUNNING`) no cuentan para la distribuciÃ³n; `recentCases` sÃ­ las incluye.
5. `recentCases[].country` y `.channel` propagan el valor crudo.

- [x] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run tests/dashboard-summary-origin.test.ts`
Expected: FAIL â€” los campos no existen.

- [x] **Step 3: Implementar el tipo y la agregaciÃ³n**

En `src/lib/dashboard.ts`, aÃ±adir las dos interfaces, los dos campos en `DashboardSummary`, y `country`/`channel` en `RecentCaseRow`.

En `dashboard.ts`, escribir un helper puro junto a las otras utilidades puras:

```ts
export function aggregateOrigin(rows: DashboardMetricRow[], dimension: 'country' | 'channel'): OriginDistribution
```

que cuenta sobre las auditorÃ­as **terminales** (mismo criterio que `terminal` en `aggregateSummary:498`, no `current`), normaliza `null`/vacÃ­o a `UNDETERMINED_LABEL`, resuelve la etiqueta con `originLabel`, ordena por `count` descendente y coloca `UNDETERMINED_LABEL` al final. AÃ±adir ambos resultados al objeto devuelto por `aggregateSummary` (`:581-593`).

AÃ±adir `country` y `channel` al `.map` de `recentCases` (`:554-562`).

**El preview local tambiÃ©n tiene que compilar.** `getLocalDashboardPreviewSummary` (`local-dashboard-preview.ts:17`) devuelve un `DashboardSummary` literal, y sus `recentCases` (`:55-83`) son `RecentCaseRow`. Como los campos nuevos son **requeridos**, sin tocar este archivo `npx tsc --noEmit` falla. AÃ±adir `byCountry` y `byChannel` con valores de demo (reparto en 2 paÃ­ses y 2 canales, mÃ¡s un punto "Sin determinar" para que se vea el caso indeterminado) y `country`/`channel` en las tres filas demo: `MX`/`WHATSAPP`, `CO`/`CRM` y `null`/`null`. Revisar `tests/local-dashboard-preview.test.ts` por si afirma la forma exacta del objeto.

- [x] **Step 4: Correr los tests para verificar que pasan**

Run: `npx vitest run tests/dashboard-summary-origin.test.ts`
Expected: PASS, 5 tests.

- [x] **Step 5: AÃ±adir `channel` a las columnas de Calidad**

En `AI_QUALITY_COLUMNS` (`:1905-1907`) aÃ±adir `channel` al final de la lista de dimensiones. `country` ya estÃ¡.

En `tests/dashboard-db.test.ts:251-265`, aÃ±adir `'channel'` al array esperado. **No cambiar nada mÃ¡s** de ese `toEqual`: el test existe porque las dims se piden aunque no se devuelvan, para que el filtro se aplique en SQL.

- [x] **Step 6: Gate de tarea**

Run: `npx tsc --noEmit && npx vitest run tests/dashboard-summary-origin.test.ts tests/dashboard-db.test.ts tests/local-dashboard-preview.test.ts`
Expected: sin errores y PASS.

---

### Task 10: UI â€” distribuciones, columnas y etiquetas

**Files:**
- Create: `src/components/dashboard/charts/OriginBreakdownChart.tsx`
- Modify: `src/components/dashboard/OverviewPage.tsx:120-178`
- Modify: `src/components/dashboard/RecentCasesTable.tsx`
- Modify: `src/components/dashboard/DashboardFilters.tsx:185-206`
- Test: `tests/origin-breakdown-chart.test.ts` (crear), `tests/origin-ui.test.ts` (crear)

> Nota de ejecuciÃ³n: el `include` de Vitest es `tests/**/*.test.ts`, asÃ­ que los
> archivos `.tsx` NO se recogen. Los dos tests de UI se crearon como `.ts` con el
> pragma `// @vitest-environment jsdom`, igual que los tests de UI existentes.

**Interfaces:**
- Consumes: `OriginDistribution`, `OriginBreakdownPoint` de Task 9; `originLabel` de Task 1; `DASHBOARD_DIMENSIONS`, `DIMENSION_LABELS` de Task 2.
- Produces: `OriginBreakdownChart({ data, dimension }: { data: OriginBreakdownPoint[]; dimension: 'country'|'channel' }): ReactNode`.

- [x] **Step 1: Escribir los tests que fallan**

`tests/origin-breakdown-chart.test.tsx` (Testing Library):

1. Renderiza un punto por fila, con la etiqueta en espaÃ±ol: `MÃ©xico` y `4`.
2. Incluye el texto accesible que nombra el total y el reparto, como el `sr-only` de `ResultsBreakdownChart:104`. Es el requisito 1.1.1(A) y no puede faltar solo porque el `LabelList` ya escriba los nÃºmeros.
3. Con un Ãºnico punto `Sin determinar`, muestra "Sin determinar" y **no** un espacio vacÃ­o.

`tests/origin-ui.test.tsx`:

4. `RecentCasesTable` con una fila `country: 'MX', channel: 'WHATSAPP'` muestra `MÃ©xico` y `WhatsApp`.
5. `RecentCasesTable` con `country: null, channel: null` muestra `Sin determinar` en ambas celdas. â†’ Review Focus #5.
6. `DashboardFilters` con `options.channel = ['WHATSAPP']` renderiza un `<option>` cuyo texto es `WhatsApp` y cuyo `value` es `WHATSAPP`.

- [x] **Step 2: Correr los tests para verificar que fallan**

Run: `npx vitest run tests/origin-breakdown-chart.test.tsx tests/origin-ui.test.tsx`
Expected: FAIL â€” los componentes no existen.

- [x] **Step 3: Crear `OriginBreakdownChart`**

Un **Ãºnico** componente para las dos distribuciones: paÃ­s y canal tienen idÃ©ntica forma, asÃ­ que separarlos duplicarÃ­a el `sr-only`, el `Cell` y el `maxBarSize`. RÃ©plica de `ResultsBreakdownChart.tsx` (`layout="vertical"`, `LabelList` a la derecha, `isAnimationActive={false}`, `AXIS_TICK_STYLE`/`GRID_STROKE`/`TOOLTIP_STYLE` de `chartTheme`), con:

- `data` normalizado a las filas con `count > 0`.
- `title` y `desc` en el `BarChart`, y un `<p className="sr-only">` con la frase del reparto (patrÃ³n `:95-98`).
- Color fijo por dimensiÃ³n, **no** un gradiente por fila: el color debe poder repetirse entre puntos sin sugerir un orden.

- [x] **Step 4: Montar los dos grÃ¡ficos en Resumen**

En `OverviewPage.tsx`, aÃ±adir un `div` con `grid gap-6 lg:grid-cols-2` despuÃ©s de la fila 2 (`:150`) con dos `ChartFrame`: "DistribuciÃ³n por paÃ­s" y "DistribuciÃ³n por canal". Ambos con `isEmpty` cuando `points` estÃ¡ vacÃ­o o cuando el Ãºnico punto es "Sin determinar", y `height={320}` como el donut. Leer `byCountry`/`byChannel` de `data`.

- [x] **Step 5: Las columnas de Casos recientes**

En `RecentCasesTable.tsx`, aÃ±adir `<th scope="col">PaÃ­s</th>` y `<th scope="col">Canal</th>`, y las dos celdas con `originLabel('country', row.country)` y `originLabel('channel', row.channel)`.

Ajustar el `colSpan` del mensaje de tabla vacÃ­a si lo hay, para que siga cuadrando con el nÃºmero de columnas nuevo.

- [x] **Step 6: La etiqueta legible en el filtro**

En `DashboardFilters.tsx`, el `<option>` de `:201` imprime hoy `option` como texto. Cambiar el texto a `originLabel(dimension === 'country' ? 'country' : 'channel', option)` **solo** para esas dos dimensiones, conservando `value={option}` para que el filtro viaje con el cÃ³digo crudo. Para las otras cinco, el texto sigue siendo el valor tal cual.

- [x] **Step 7: Correr los tests para verificar que pasan**

Run: `npx vitest run tests/origin-breakdown-chart.test.tsx tests/origin-ui.test.tsx tests/audit-result-panel.test.tsx`
Expected: PASS. El Ãºltimo comprueba que el detalle del caso no se rompiÃ³.

- [x] **Step 8: Gate de tarea**

Run: `npx tsc --noEmit`
Expected: sin errores.

---

### Task 11: VerificaciÃ³n de cierre

**Files:** ninguno. Es la cascada de validaciÃ³n.

- [x] **Step 1: Suite del dashboard y del skill**

Run: `npx vitest run tests/dashboard-dimensions.test.ts tests/dashboard-filters.test.ts tests/dashboard-db.test.ts tests/dashboard.test.ts tests/dashboard-execution.test.ts tests/dashboard-human-review-query.test.ts tests/local-dashboard-preview.test.ts tests/dashboard-summary-origin.test.ts tests/origin-vocabulary.test.ts tests/origin-schema.test.ts tests/origin-instructions.test.ts tests/origin-breakdown-chart.test.tsx tests/origin-ui.test.tsx tests/schema.test.ts tests/execute.test.ts tests/cycle-start-date.test.ts tests/case-dimensions.test.ts tests/audit-fingerprint.test.ts`
Expected: todo PASS.

- [x] **Step 2: Suite completa**

Run: `npm test`
Expected: todo PASS. Si algo falla y no estÃ¡ en la lista de archivos tocados, es dependencia de la consolidaciÃ³n de Task 2.

- [x] **Step 3: Typecheck, secretos y build**

Run: `npm run lint:secrets && npm run typecheck && npm run build`
Expected: los tres en 0. `build` corre `prebuild` â†’ `policy:generate` + `check-no-public-secrets`.

- [x] **Step 4: Contraste de accesibilidad**

Run: `npm run lint:contrast`
Expected: 0.

- [x] **Step 5: Smoke contra el modelo real**

Run: `npm run test:ai-smoke`
Expected: el assessment emitido incluye `origin` con valores del catÃ¡logo y no falla validaciÃ³n. **Este paso verifica Review Focus #1 en la prÃ¡ctica**: si el modelo no obedece, todos los casos nuevos caen a `ERROR`, y eso se ve aquÃ­ antes de desplegar, no en producciÃ³n.

Si falla: **no subir**. Revisar `ORIGIN_RULES` (Task 4) â€” el defecto mÃ¡s probable es que el prompt no sea lo bastante explÃ­cito sobre que el bloque es obligatorio aunque ambos valores sean `null`.

- [x] **Step 6: RevisiÃ³n de seguridad del diff**

Sobre el diff de estas 11 tareas, checklist manual de `seguridad-apis` (superficie: validaciÃ³n de query params en `dashboard-filters.ts`):

- Â¿`channel` entra por query param a una `.eq()` sin pasar por el schema? No: `DashboardFiltersQuerySchema` es `.strict()` y `DimensionSchema` limita a 200 caracteres.
- Â¿Se expone `result_json` o `provider_metadata` al navegador con este cambio? No: la vista sigue siendo solo escalares y `GRANT SELECT` solo a `project_admin`.
- Â¿La proyecciÃ³n escribe en `cases` desde datos del modelo sin validar? No: `updateCaseDimensions` solo se llama con valores que Zod ya validÃ³ contra el enum cerrado.
- Â¿Se registran el expediente, las transcripciones o PII? No: el cambio no toca `buildAuditFailureLog`.
- Â¿La migraciÃ³n mantiene la vista inaccesible desde el navegador? Verificar que el `$verify$` de Task 7 lo comprobÃ³.

- [x] **Step 7: Reporte**

Informar: quÃ© se implementÃ³, quÃ© comando de validaciÃ³n corriÃ³ y quÃ© dio, quÃ© gates de seguridad se aplicaron, y **declarar explÃ­citamente** que los dictÃ¡menes anteriores a este deploy no tienen `origin` y por lo tanto no aparecen en los filtros de paÃ­s o canal hasta ser re-auditados.