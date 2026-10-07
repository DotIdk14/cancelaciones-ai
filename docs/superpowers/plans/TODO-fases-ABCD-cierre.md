# TODO — Cierre de fases A/B/C/D (rechazo, vocabulario humano, comentarios BO/HelpDesk)

Última actualización: 2026-10-07 12:20 (hora local). Tracking de trabajo, no parte del producto.

## Fases de la feature (YA COMPLETADAS)

- [x] **A — `TICKET_RECHAZADO` (IA)** · types/schema/instructions/labels TR + `rejectionReason` (obligatorio iff TR), contrato `rejected` en dashboard, `AuditResultPanel` muestra la razón, EvolutionChart 4ª serie.
- [x] **B — Dictamen humano en 6 opciones** · `HUMAN_RESOLUTIONS` lista propia, etiqueta "Cancelación por promesa no cumplida", tests de contrato 6 + tsc limpio.
- [x] **C — Bug 401/404 al registrar resolución** · diagnóstico read-only cerrado: causa raíz determinística (404 = `assertCaseOwner`, 401 = sesión expirada), decisión del usuario: mantener solo-dueño, cero cambios.
- [x] **D — Comentarios BO/HelpDesk en subida de evidencias** · `AreaQuickComments` (2 áreas, UPSERT), inyección only BACK_OFFICE/HELPDESK cercados con `wrapUntrusted`, sección `AREA_COMMENTS_ARE_NOT_POLICY` en system prompt, snapshot `areaComments` en `result_json` (armado por servidor), lectura **best-effort** (fallo de lectura ≠ dictamen caído), pista re-auditar, invariante AGENTS.md matizada.

## Validación en cascada (COMPLETADA, todo verde)

- [x] Tests específicos D: 64/64 (execute, instructions, schema, area-context-inputs, AreaQuickComments).
- [x] Suite completa: **674 passed, 3 skipped** (53+1 archivos) — incluye fix de regresión latente de B (`human-review.test.ts`: POST duplicado usaba `DICTAMINACION`, ya fuera del vocabulario de 6 → ahora usa `BAJA`).
- [x] `tsc --noEmit` EXIT=0.
- [x] `node scripts/check-no-public-secrets.mjs` EXIT=0.
- [x] `node scripts/contrast.mjs` EXIT=0 (WCAG 2.2 AA).
- [x] `vite build` EXIT=0 (tsc + bundle de producción con componente nuevo).
- [x] Plan oficial `docs/plans/2026-10-06-rechazo-vocabulario-comentarios.md` marcado completo.
- [x] gitleaks (trigger encendido): 1 finding = **falso positivo documentado** (`packages/shared/src/logger.test.ts` en historial legacy: valores de ejemplo `sk-live-12345`/`sk-anidada-999` usados por el test del redactor de secretos; archivo no existe en el working tree actual). Sin `.gitleaks.toml` en repo ni home → no se silencia; queda reportado.

## Revisión (COMPLETADA — 2026-10-07 12:48)

- [x] Revisión independiente `revisor-codigo` del diff A+B+D → **`APPROVED WITH NOTES`**: 0 BLOCKER, 3 IMPORTANT, 6 MINOR.
- [x] Incorporado IMP-2: los comentarios de área **cuentan en el presupuesto** `MAX_AUDIT_TEXT_CHARS`; si desbordan el total, se omiten con `console.warn` sin tumbar el dictamen (best-effort coherente) + test nuevo.
- [x] Incorporado MIN-4: comentario dashboard.ts "3 categorías" → 4.
- [x] Incorporado MIN-5: typo AuditResultPanel "emidió" → "emitió".
- [x] Incorporado MIN-6: typo instructions.ts "Los únicas reglas" → "Las únicas reglas".
- [x] Incorporado MIN-8: `AreaQuickComments` limpia el aviso al editar (el aviso describía el último guardado).
- [x] Decisión NO implementar IMP-1 (validar conteos de 5.2 en `rejectionReason` con regex sobre texto libre → anti-patrón frágil; el contrato lo pide el prompt, el schema exige no-vacío) → queda en RISKS.
- [x] Decisión NO implementar IMP-3 / MIN-7 / MIN-9 (contrato legacy `rejectionReason` en parse, hardening opcional de backticks en `wrapUntrusted`, flag de fallo de lectura en snapshot) → documentados como RISKS abiertos.

## Re-validación tras la revisión

- [x] Tests afectados por la ronda de hallazgos: 116/116 (area-context-inputs, AreaQuickComments, instructions, dashboard, AuditResultPanel).
- [x] `tsc --noEmit` EXIT=0.
- [x] Suite completa final: **675 passed, 3 skipped**.

## Pendiente

- [ ] Reporte final al usuario: IMPLEMENTED / VALIDATED / SECURITY / AGENTS USED / PREMIUM / RISKS + ROUTING SUMMARY.
- [ ] Nota de honestidad pendiente: prompts del modelo describen el resultado como "petición del cliente" (fuente normativa) mientras la etiqueta UI dice "promesa no cumplida" — no se tocó `instructions.ts` ahí por POLICY_IS_IMMUTABLE; **requiere decisión del usuario**.

## Riesgos abiertos (para el reporte final)

- `HumanReviewPanel` y `src/skills/review-schema.ts` son código muerto (no tocados).
- `CaseDetailPage`/dashboard mantienen superset `AUDIT_RESULTS` para display legacy (intencional).
- Diferenciación snapshot: un fallo de lectura de comentarios queda en `[]` (indistinguible de "no había") salvo el `console.warn` — diseño aceptado como best-effort.