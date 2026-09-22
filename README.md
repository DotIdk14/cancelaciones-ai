# Cancelaciones AI

Cancelaciones AI sera un asistente interno de auditoria de cancelaciones. El flujo objetivo es que el auditor cree una auditoria, suba evidencias, presione `Auditar`, revise el dictamen sugerido y genere el `Dictamen.pdf` final.

## Estado actual

Phase 0 completada con advertencias. Se identificaron la fuente normativa principal, la plantilla canonica y cuatro casos historicos privados. Faltan anexos y documentos de referencia oficiales, por lo que algunas reglas quedan bloqueadas para formalizacion productiva.

## Estado de cierre de Phase 6

Phase 6 sigue bloqueada por falta de evidencia real del gate requerido por Phase 7: OpenRouter no esta validado con una key valida en el runtime efectivo y el backend vinculado no contiene actualmente expediente/evidencias para ejecutar una nueva Fact Run congelada, Engine Run, trace, sourceCompleteness, comments isolation e historical isolation. La migracion de manual comments en InsForge real ya fue verificada como resuelta. Ver `docs/reports/phase-6-report.md` como reporte canonico.

## Principios

- La politica oficial decide.
- La IA extrae evidencia, no inventa reglas.
- El motor normativo decide con hechos estructurados.
- Toda decision debe ser trazable a evidencia y fuente normativa.
- Los historicos y el legacy no son politica.

## Documentacion inicial

- `docs/reports/phase-0-report.md`
- `docs/phase-prompts/phase-1.md`
- `docs/architecture/overview.md`
- `docs/policy/rule-inventory.md`
- `docs/reporting/dictamen-template.md`
- `docs/legacy/assessment.md`
