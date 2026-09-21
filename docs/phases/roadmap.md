# Roadmap definitivo inicial

## Phase 0 - Discovery y arquitectura

Completada con advertencias.

## Phase 1 - Fundacion tecnica, auth y persistencia real

Monorepo, tooling, decision final de arquitectura, TypeScript strict, Tailwind, InsForge adapter, auth baseline, DB baseline, migraciones reproducibles, persistencia minima de auditorias, env validation y pruebas utiles.

## Phase 2 - Ingesta de evidencia

Uploads privados, hashes, metadata, validacion MIME/tamano, storage paths, evidencia original preservada y provenance inicial sobre la fundacion real de Phase 1.

## Phase 3 - Durabilidad e idempotencia del procesamiento

Convertir el procesamiento en jobs durables e idempotentes: estados persistidos, worker simple, reintentos, progreso recuperable, claves idempotentes y audit log.

## Phase 4 - Audio y transcripcion

AssemblyAI server-side, diarizacion, segmentos, player con timestamps y roles inferidos corregibles.

## Phase 5 - Extraccion IA y fact model

OpenRouter, structured outputs, model routing, facts normalizados, cost accounting.

## Phase 6 - Formalizacion normativa

Rule engine puro, matriz de trazabilidad, tests de politica y manejo UNKNOWN.

## Phase 7 - Faltantes, conflictos y precedencias

Missing data severity, conflictos visibles, OWNER_OPERATIONAL_PRECEDENCE versionada.

## Phase 8 - UI de auditoria y revision

Flujo auditorias, subir, auditar, procesando, resultado, evidencia, razonamiento y correccion humana.

## Phase 9 - Dictamen.pdf

Generador de draft/final, fidelidad visual, evidencias relevantes y preview.

## Phase 10 - Validacion historica y hardening

Anonimizacion, golden candidates validados, seguridad, performance y readiness produccion.
