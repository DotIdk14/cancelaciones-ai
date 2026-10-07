# Plan — Ticket rechazado, vocabulario humano (6), bug 401/404, comentarios BO/HelpDesk

Aprobado por el usuario el 2026-10-06. Path: bounded. Sin subagentes (pedido explícito).

## C) Diagnóstico bug 401/404 — COMPLETADO (2026-10-06, sin cambios de código)

- [x] C1+C2. BD: caso `9e012c6e` existe (COMPLETED, sin revisión), creador `ianidk1@gmail.com`;
  caso `c78560e8` creado hoy por `ijarquiher@utel.edu.mx`; 5 membresías, todas `coordinator`.
- [x] C5. **Causa raíz (determinística)**: único camino del 404 = `assertCaseOwner` (`cases.ts:168`) —
  sesión ≠ creador del caso. 401 = sesión expirada (fail-closed, retry con refresh).
  `chrome-extension://invalid` = ruido de extensión, sin relación.
- [x] Decisión de producto del usuario: **mantener solo-dueño** (cero cambios de código;
  usar la cuenta que creó el caso). Invariantes intactos.

## A) `TICKET_RECHAZADO` (IA)

- [x] A1. `src/skills/audit/types.ts`: `AUDIT_RESULTS += TICKET_RECHAZADO`; `audit.rejectionReason: string`; `ProvisionalResolution` excluye TICKET_RECHAZADO
- [x] A2. `src/skills/audit/schema.ts`: 5.2 incumplida/no determinable → obliga TICKET_RECHAZADO; exige `rejectionReason` + missingEvidence bloqueante "Intentos mínimos de contacto"; `supportingEvidenceIds` puede ser `[]`; `provisionalResolution` solo para EVIDENCIA_INSUFICIENTE (excluir TR también del resultado provisional)
- [x] A3. `src/skills/audit/instructions.ts`: bloque 5.2 (L25-39) → TICKET_RECHAZADO + rejectionReason con números exactos; reglas EI (L217-218, 263-265, 278, 297) → EI solo con 5.2 acreditada
- [x] A4. `src/lib/labels.ts`: etiqueta/tono/descripción TICKET_RECHAZADO; grupo `RECHAZADOS` (+ color, verificar `scripts/contrast.mjs`); `RESULT_TO_GROUP`
- [x] A5. UI: `AuditResultPanel` muestra `rejectionReason` junto al dictamen
- [x] A6. Dashboards/dto: absorber código nuevo en `Record<AuditResultType, …>`

## B) Dictamen humano — 6 opciones

- [x] B1. `src/skills/review/types.ts`: `HUMAN_RESOLUTIONS` lista propia: CANCELACION_VENTA, CANCELACION_VENTA_PETICION_CLIENTE, BAJA, CANCELACION_VENTA_OPERATIVA, TICKET_RECHAZADO, EVIDENCIA_INSUFICIENTE (comment: dominios divergen, comparación por igualdad)
- [x] B2. Renombre global de etiqueta: CANCELACION_VENTA_PETICION_CLIENTE → "Cancelación por promesa no cumplida"
- [x] B3. Verificar cascada: schema review, instructions comparación, api.ts comentario L127, tests
- [x] B4. Sin migración BD (verificado: sin CHECK en `case_reviews.result`)

## D) Comentarios BO/HelpDesk en el flujo de subida

- [x] D1. UI: campos BACK_OFFICE y HELPDESK en la zona "Adjuntar evidencias" de `CaseDetailPage` (opcionales, UPSERT actual `saveAreaComment`)
- [x] D2. `buildAuditInputs` (audit-service): inyectar solo BACK_OFFICE/HELPDESK envueltos con `wrapUntrusted` (`src/skills/sanitize.ts`)
- [x] D3. `instructions.ts` audit: sección "contexto no normativo de otras áreas" — no política, no evidencia, no dicta resultado
- [x] D4. Snapshot de comentarios usados en `result_json` (armado por servidor)
- [x] D5. Pista "re-auditar" si cambian comentarios tras auditar (sin reprocesar solo)
- [x] D6. Actualizar invariante `AREA_COMMENTS_ARE_HUMAN_NOT_POLICY` en `AGENTS.md`

## Validación (cascada)

- [x] V1. Tests específicos afectados (audit/schema, review/schema, labels, sanitize/input auditoría)
- [x] V2. `typecheck` + `lint` + `build`
