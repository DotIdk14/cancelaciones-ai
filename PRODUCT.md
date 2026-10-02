# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Dictaminador UTEL (personal administrativo que revisa deserción). Situación: expediente de cancelación, baja o deserción con evidencias heterogéneas (imágenes, PDF, audio, texto). Trabajo: crear caso, subir evidencias del expediente, solicitar auditoría y obtener un dictamen sostenido en evidencia y trazado a sección del procedimiento oficial.

## Product Purpose

Analizar expedientes de cancelación, baja y deserción de estudiantes UTEL y emitir un dictamen estructurado, trazable y auditable. Existe para sustituir revisión manual dispersa por un flujo AI-native donde el modelo lee el expediente completo junto al procedimiento oficial. Éxito: dictamen válido (uno de siete resultados) con cada conclusión enlazada a evidencia y sección del procedimiento, reutilizable sin reprocesar IA si la evidencia no cambia.

## Positioning

El dictamen lo produce un modelo que lee el procedimiento oficial completo `GDM_GAM_PRD_MLG_003` v5 inyectado íntegro en contexto y examina todas las evidencias en conjunto, con salida validada por Zod `strict` y validación de referencias. El código no dictamina: prepara evidencia, orquesta el run durable, valida y persiste. Ningún policy engine, rules engine ni evaluación en SQL decide negocio.

## Operating Context

Flujo: evidencias -> preparación técnica (MIME, firma real, hash, PDF->texto, imagen->data URI, audio transcrito con AssemblyAI) -> Audit Skill con V5 inyectado -> assessment validado -> metadata técnica real de OpenRouter -> resultado terminal. Rutas hash `#/`, `#/calidad`, `#/ia-costos`, `#/nuevo`, `#/casos`, `#/casos/:id` (sin react-router, sin rewrites en Vercel). Login por `POST /api/auth/session` con cookies `httpOnly` + CSRF (`Origin` + `X-App-Request`) y autorización por rol desde `app_memberships`; no hay sign-up en la SPA. InsForge solo server-side. Cuotas por RPC SQL `admit_or_reject_quota` con sujeto hasheado (HMAC), fail-closed en 503. Límites duros: MAX_AGENT_STEPS=12, MAX_TOOL_CALLS=20, MAX_REVIEW_ROUNDS=2, MAX_PROVIDER_ATTEMPTS=2. Re-auditoría por `evidence_fingerprint`; `EVIDENCIA_INSUFICIENTE` es dictamen válido con `missingEvidence` accionable.

## Capabilities and Constraints

Capacidades confirmadas: login/logout/refresh con sesión por cookie `httpOnly`, roles `user`/`coordinator`, alta de casos, subida binaria cruda (4 MB máx, MIME restringido y validado por magic bytes), visor de evidencia, transcripción audio bajo demanda con polling, auditoría con healing de RUNNING abandonados, revisión humana del dictamen, comparación entre casos, cuotas de admisión y de login, dashboards Resumen/Calidad/IA & Costos, descarga con `?preview=1`.
Restricciones duras: POLICY_IS_IMMUTABLE (policy/ no se edita, se serializa con SHA-256), ONLY_OWNER_PROVIDED_POLICY_SOURCES, TEMPLATE_IS_NOT_POLICY, HISTORICAL_CASES_ARE_NOT_POLICY, NO_RULES_ENGINE, TRACE_EVERY_DECISION, PRESERVE_EVIDENCE_PROVENANCE, NO_PII_IN_GIT, NO_PROCESS_LOCAL_DURABILITY, DO_NOT_REPROCESS_AI_UNNECESSARILY, KEEP_IT_SIMPLE (monolito modular). UI y docs en español. Código no reclasifica ni fabrica dictamen; `INVALID_AI_RESPONSE` si Zod falla tras la cascada.

## Brand Commitments

Nombre: Auditoría de Cancelaciones. Subtítulo: Cancelaciones, bajas y deserción · UTEL. Voz en español, tono administrativo preciso. Activo visual incumbente: SPA oscura (variables `--background`/`--surface-*`, tarjetas `rounded-2xl border-line`), primitivas `Panel/Badge/Button/StatCard/ChartFrame` en `src/components/ui.tsx`. Sin logo ni testimonios inventados.

## Evidence on Hand

Procedimiento `GDM_GAM_PRD_MLG_003` v5 en `policy/` (26 secciones, manifest con SHA-256) y `src/skills/audit/policy-v5.generated.ts` generado por `npm run policy:generate`. Esquema en `migrations/00000000000000_baseline.sql` (cases, evidence, audits) más 8 migraciones incrementales (auth, cuotas, revisión humana, comparaciones, derivados). API en `api/**`, UI en `src/components/`, `src/App.tsx`. Docs: `README.md`, `AGENTS.md`, `SECURITY.md`, `CONTRIBUTING.md`, `docs/`. Ausencias que no deben fabricarse: testimonios, clientes, benchmarks, pricing.

## Product Principles

1. Evidencia antes que afirmación: sin cita a evidencia y sección, no hay conclusión.
2. Procedimiento del owner como única norma: nada de internet ni historial como fuente.
3. IA propone, código valida y persiste: nunca aproximar un dictamen.
4. Trazabilidad durable y reutilizable: no reprocesar IA si nada cambió.
5. Simplicidad operativa: un paquete, hash routing, server-side para secretos.
