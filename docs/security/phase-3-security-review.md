# Phase 3 Security Review

## Estado

PASS.

## Autenticacion

Las rutas HTTP de jobs requieren usuario autenticado con `getCurrentUser()`.

## Autorizacion

La lectura de jobs usa RLS via auditorias visibles. El encolado desde API valida que la auditoria exista y sea visible antes de llamar `enqueue_job`.

## RLS

`jobs`, `job_attempts` y `job_artifacts` tienen RLS habilitado. Las policies permiten `SELECT` solo para auditorias visibles por creador u owner.

## Funciones SQL

Las transiciones se concentran en funciones `SECURITY DEFINER`. La app no implementa claim con leer-primero/actualizar-despues.

## PII

Los mensajes de error persistidos deben ser sanitizados y se truncan a 500 caracteres en SQL. No se deben guardar payloads con evidencia sensible innecesaria.

## Riesgos residuales

- Las funciones `SECURITY DEFINER` deben mantenerse pequenas y revisadas porque concentran permisos de escritura.
- Phase 3 incluye un endpoint manual de procesamiento; antes de produccion debe protegerse con autorizacion operativa especifica o scheduler controlado.
