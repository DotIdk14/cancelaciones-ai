# Phase 0 Report

## Estado

PASS_WITH_WARNINGS

## Objetivo del producto

Cancelaciones AI es un asistente de auditoria. El auditor sube evidencias, presiona `Auditar`, revisa el resultado y obtiene `Dictamen.pdf` final.

## Flujo operativo

Archivos crudos -> ingesta -> clasificacion -> extraccion/transcripcion/vision -> hechos estructurados -> normalizacion -> motor normativo -> faltantes/conflictos -> dictamen sugerido -> plantilla oficial -> revision humana -> PDF final.

## Fuente normativa

`GDM_GAM_PRD_MLG_003 Procedimiento Deserción De Estudiantes`, version 2, fecha publicacion 19/02/2025, 19 paginas.

## Hash

`773BECABE81E6FE8812167F9316EFEFEC5CAB5ABBA5C142FC9E1C170510B0C6F`

## Template oficial

`templates/Dictamen.pdf`, hash `E5C62E10BA0A603081D84C601E4E9844FFA53128C276E1AB88E8A0757435D751`, 5 paginas.

## Casos historicos

Cuatro PDFs privados: CaVe-30318, CaVe-30330, CaVe-30344 y CaVe-30354. Todos son historicos de `07 Alumno Ilocalizable` y no son politica ni golden cases validados.

## Fuentes normativas disponibles

Solo la fuente principal `GDM_GAM_PRD_MLG_003`.

## Fuentes faltantes

Anexos 1-7, documentos de ingreso, matriz de casos extemporaneos, `GCE_GCE_PRD_MXL_001`, `GDM_GAM_PRO_MXL_001` y enlaces Drive de actividades/diagrama. Ver `docs/policy/normative-dependencies.md`.

## Reglas encontradas

Se creo inventario inicial en `docs/policy/rule-inventory.md` con reglas candidatas de 5.1 a 5.14. Varias estan listas para formalizacion; otras quedan ambiguas o bloqueadas por fuente faltante.

## Outcomes

Inventariados: Cancelacion de venta, Baja definitiva, Cancelacion de venta operativa, Baja/cancelacion operativa, Cancelacion de matricula, No aplica CV y Retencion.

## Facts

Se creo `docs/policy/fact-inventory.md` con facts estrictamente vinculados a reglas observadas.

## Evidence Model

Definido en `docs/evidence/evidence-model.md` y `docs/evidence/provenance.md`.

## Ambiguedades

Documentadas en `docs/policy/ambiguities.md`.

## Conflictos

Documentados en `docs/policy/conflicts.md`, incluyendo conflictos historicos CaVe-30344 y CaVe-30354.

## Template Analysis

`Dictamen.pdf` analizado pagina por pagina en `docs/reporting/dictamen-template.md`.

## Historical Comparison

Comparacion en `docs/reporting/template-vs-historical-cases.md` y registro en `docs/testing/historical-case-register.md`.

## Legacy Repository

Repo clonado temporalmente desde GitHub. Commit analizado: `3eb970850b4fc205b72939a1ee744b5c70410688`.

## REUSE_AS_IS

Ningun componente aprobado como REUSE_AS_IS.

## REUSE_WITH_CHANGES

EvidenceViewer, CallPlayer, CallTranscript, OpenRouter client, jobs router, auth InsForge, algunas migraciones y tests de jobs.

## REWRITE

Setup aplicacion, AssemblyAI client server-side, arquitectura de paquetes, generador PDF final.

## DISCARD

Motor/reglas legacy como fuente normativa, mocks y golden cases no validados.

## Arquitectura

Monorepo TypeScript, monolito modular, Next.js/Vercel como candidato preferido, InsForge para auth/db/storage, jobs durables persistidos.

## Data Model

Audits, evidences, artifacts, facts, engine_runs, human_reviews, policy_sources, operational_precedences, ai_usage y audit_log.

## AI Strategy

IA solo extrae y estructura. Structured output validado antes de facts.

## Model Routing

Parser determinista -> vision/LLM economico -> modelo superior si falla validacion -> fallback alta capacidad solo si necesario.

## AssemblyAI

Usar server-side para transcripcion, diarizacion, timestamps y segmentos. Separar speaker provider de rol inferido.

## OpenRouter

Usar cliente server-side con schemas, cost accounting y routing por operacion.

## Provenance

Toda afirmacion debe mapear dictamen -> regla -> condicion -> hecho -> evidencia -> ubicacion.

## Cost Accounting

Definido en `docs/ai/cost-accounting.md`.

## Background Processing

Definido en `docs/architecture/background-processing.md`.

## PDF Generation

ADR provisional: reconstruccion HTML/CSS controlada o overlay si pruebas demuestran mejor fidelidad. No reporte alternativo.

## Frontend

Español, Tailwind, flujo simple: Auditorias, Nueva auditoria, Subir archivos, Auditar, Procesando, Resultado.

## Security

Auth, roles minimos, storage privado, signed URLs, secrets server-side, validacion MIME/tamano, no PII en Git.

## Testing

Estrategia en `docs/testing/testing-strategy.md`.

## Roadmap

Roadmap simplificado a 10 fases en `docs/phases/roadmap.md`.

## Archivos creados

AGENTS.md, README.md, `.gitignore` y documentos en `docs/` requeridos por Phase 0.

## Archivos modificados

Ninguno preexistente modificado salvo adicion de `.gitignore` si no existia.

## Comandos ejecutados

- `Get-FileHash -Algorithm SHA256 ...`
- `git clone --depth 1 https://github.com/DotIdk14/Auditor-Cancelaciones.git ...`
- `git rev-parse HEAD`

## Tests ejecutados

No aplica: Phase 0 documental, sin codigo productivo.

## Build

No aplica: no existe aplicacion scaffold en este repositorio.

## Typecheck

No aplica: no existe proyecto TypeScript local aun.

## Riesgos

- Anexos faltantes bloquean formalizacion completa.
- Historicos contienen PII y no deben versionarse.
- Algunos historicos contradicen reglas aparentes o comentarios de BO.
- La fidelidad PDF requiere prueba tecnica posterior.

## Blockers

No bloquea Phase 1 tecnica. Bloquea formalizar reglas dependientes de anexos faltantes.

## Technical Debt Accepted

Inventario normativo inicial no es implementacion productiva. Reglas con estado AMBIGUOUS o BLOCKED no deben implementarse sin remediacion/fuente.

## ADRs

- `docs/adr/001-application-architecture.md`
- `docs/adr/002-ai-vs-policy-engine.md`
- `docs/adr/003-dictamen-pdf-strategy.md`

## Siguiente fase

`docs/phase-prompts/phase-1.md`
