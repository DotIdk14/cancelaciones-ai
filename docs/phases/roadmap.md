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

## Phase 6 - Formalizacion normativa (bloqueada por gate real)

Existe un motor puro version-aware, evaluación de cuatro estados, fingerprints,
traces, datos faltantes, conflictos, persistencia de engine runs, endpoints y
un explorador mínimo. La cobertura normativa productiva actual es parcial
(principalmente V5 5.2 y 5.8). `audit_manual_comments` ya existe y su CRUD real
sin PII fue validado en InsForge, pero el cierre real sigue bloqueado por la
ausencia de evidencia operativa requerida: OpenRouter real con runtime valido,
expediente/evidencias reales en el backend vinculado, Fact Run nuevo congelado
desde original, Engine Run nuevo, trace real, sourceCompleteness real, comments
isolation e historical isolation.

## Phase 7 - Dictamen.pdf y revisión humana

Generación draft/final con la plantilla canónica, selección de evidencia,
aprobación humana separada y preservación de la decisión de máquina. Ver
`docs/phase-prompts/phase-7.md`.

## Phase 8 - Operación y hardening

Completar flujo de auditoría, revisión humana, validación histórica,
anonimización, seguridad, performance y readiness de producción.

## Phase 10 - Validacion historica y hardening

Anonimizacion, golden candidates validados, seguridad, performance y readiness produccion.
