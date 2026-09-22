# Phase 6 Final Closure

## Estado

PHASE_6_CLOSURE_IN_PROGRESS

## Objetivo

Cerrar correctamente Phase 6 sin avanzar a Phase 7 ni generar `Dictamen.pdf`. La puerta a Phase 7 queda bloqueada hasta que la interpretación final del motor, los reports y la validación real cumplan las condiciones documentadas en `docs/phase-prompts/phase-6.md` y en esta nota.

## Criterios de cierre cumplidos

- `evaluatePolicy()` mantiene `suggestedOutcome` y `decisionStatus` separados.
- `UNKNOWN` no se transforma en soporte positivo ni en resultado definitivo.
- La cobertura de software V5 ya no se presenta como un bloque genérico que incluyera una regla implementada como `5.7.e`.
- La regla `GDM-V5-5.7-E-INITIAL-BIMESTER-GRADES` se modela como `EXCLUSION_RULE` y exige evidencia de `classroom.hasGrades`.
- Los reportes faltantes de fases previas se restauran o reconstruyen con marca de evidencia explícita cuando la historia local no lo permite.

## Criterios pendientes de validación real

- Nueva corrección y ejecución real de `Fact Run` sobre evidencia original.
- `Engine Run` nuevo con fingerprints y trace completos.
- Verificación de conectividad real con proveedor y aislamiento de limitaciones de runtime.
- Confirmación de `sourceCompleteness`, `PARTIAL`, `UNKNOWN` y `multi-artifact aggregation` con datos reales.

## Restricción histórica

La documentación previa no se reescribe para fingir que una limitación antigua estaba ya resuelta. Cualquier advertencia histórica sobre falta de proveedor real o ausencia de evidencia preserva su estado original; la corrección posterior pertenece a esta nota de cierre y a la evidencia nueva que se genere más adelante.

## Salida autorizada

No se genera ningún `Dictamen.pdf` ni se inicia Phase 7 desde este cierre parcial. La fase queda lista para la validación final, pero no cerrada como completada sin la ejecución real adicional requerida por el owner.
