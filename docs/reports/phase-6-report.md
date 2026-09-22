# Phase 6 Report

## Estado

PASS_WITH_WARNINGS. Existe un motor puro version-aware con evaluación de cuatro
estados, fingerprints, trazabilidad, datos faltantes y conflictos. La cobertura
productiva inicial está limitada a 5.2 y 5.8; las ramas dependientes de anexos
faltantes permanecen bloqueadas.

## Arquitectura y versiones

`@cancelaciones/policy-engine` no importa React, Next.js, InsForge, filesystem ni
servicios de IA. V2 y V5 tienen funciones aisladas y cada regla conserva su
versión de fuente. El fingerprint se genera sobre el conjunto efectivo de reglas
y los hechos.

## Evidencia, conflictos y revisión

UNKNOWN nunca se convierte en FALSE. Los datos faltantes incluyen severidad,
reglas afectadas y motivo. Resultados incompatibles se exponen como
`CONFLICTED` y requieren revisión; no se creó precedencia OWNER automática.

## Persistencia

La migración aditiva `20260922110000_phase-6-policy-engine.sql` crea `engine_runs`
y `engine_rule_results`, con unicidad para idempotencia y RLS por auditoría.

## Tests y limitaciones

Se cubren aislamiento V2/V5, faltantes, distribución 70/30 y días hábiles.
No se ejecutó expediente real ni se genera Dictamen.pdf: eso pertenece a Phase 7.

## API y UI

Se agregaron `POST/GET /api/audits/{auditId}/policy` y
`GET /api/audits/{auditId}/policy/{engineRunId}` con validación de sesión,
auditoría y persistencia idempotente. La vista de auditoría incluye un panel
mínimo de evaluación y exploración de reglas, mostrando estado, cita, faltantes
y conflictos. Los hechos enviados por el panel son deliberadamente vacíos
hasta que exista un Fact Run congelado; no se inventan hechos.

## Normative shadow evaluation

`compareHistoricalOutcome` implementa `MATCH`, `DIFFERENT`,
`HUMAN_OUTCOME_MISSING`, `AI_INDETERMINATE`, `AI_CONFLICTED` y
`NOT_COMPARABLE`, incluyendo clasificación por `POLICY_VERSION_MISMATCH`.
