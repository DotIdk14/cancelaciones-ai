# ADR 012: Motor normativo puro

## Estado

Aceptado para Phase 6, con cobertura parcial documentada en
`docs/policy/v5-coverage.md`.

## Contexto

La IA extrae hechos observables, pero no debe decidir el resultado normativo.
Las evaluaciones deben ser reproducibles, trazables y fijadas a una versión
explícita de `GDM_GAM_PRD_MLG_003`.

## Decisión

El paquete `@cancelaciones/policy-engine` implementa un núcleo síncrono,
determinista y sin dependencias de React, Next.js, InsForge, filesystem o
proveedores de IA. `evaluatePolicy` recibe `policyCode`, `policyVersion` y
facts. Evalúa reglas como datos, conserva citas de documento/sección/página y
agrega el resultado sólo después de evaluar todas las reglas.

Las condiciones distinguen `TRUE`, `FALSE`, `UNKNOWN` y `NOT_APPLICABLE`.
`UNKNOWN` nunca se transforma en `FALSE`. Cada corrida expone fingerprints de
reglas y facts, datos faltantes, conflictos y una cadena de trace hacia las
referencias de evidencia.

V2 y V5 permanecen aisladas. La cobertura productiva actual formaliza una
porción de 5.2 y 5.8; las ramas no sustentadas por fuentes disponibles quedan
fuera o explícitamente bloqueadas.

## Consecuencias

El runtime puede persistir una evaluación en `engine_runs` sin que el motor
conozca la base de datos. Cambiar el resultado humano no sobrescribe la
decisión de máquina. La cobertura incompleta exige revisión antes de presentar
un resultado como dictamen oficial.
