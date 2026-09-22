# Phase 6 Security Review

## Alcance

Revisión de los nuevos endpoints de policy, persistencia de `engine_runs` y
superficie mínima de UI. No cubre generación de PDF de Phase 7.

## Controles implementados

- Los endpoints requieren sesión autenticada.
- Se comprueba que la auditoría exista y pertenezca al usuario antes de leer o
  crear corridas.
- La persistencia usa RLS por auditoría y la migración no modifica migraciones
  previas.
- Se persisten fingerprints y resultados append-only desde la perspectiva de
  la UI; la decisión de máquina no se sobrescribe por una corrección humana.
- El motor no recibe credenciales ni accede directamente a servicios externos.
- Los facts y referencias se conservan como datos de evaluación; no se
  interpreta un upload privado como registro normativo oficial.

## Riesgos y límites conocidos

La ruta acepta facts estructurados enviados por el cliente y actualmente no
está conectada a un Fact Run congelado en la UI. Antes de producción debe
restringirse a facts cargados desde el run autorizado y validar esquema,
provenance y ownership de cada referencia. Debe revisarse también la carrera
entre solicitudes concurrentes frente al índice único de idempotencia y
registrarse el actor en un audit log específico de evaluación.

No se ejecutó un expediente real ni una validación de despliegue InsForge en
esta documentación.

## Resultado

PASS_WITH_WARNINGS para el alcance de Phase 6 implementado; no es una
certificación de seguridad de producción.
