# Entrega a producción · 23/10/2026

El usuario autorizó completar lo necesario y subir a producción después de la auditoría documental.

## Alcance

Publicación de README, arquitectura, guías, informes y correcciones documentales. Se conserva el código de src/, api/, Policy, scripts productivos, dependencias, configuración Vercel y SQL. docs/, tests/ y migrations/ no forman parte del sitio según .vercelignore; no se altera el diseño ni comportamiento.

El mapa generado tenía cambios locales antes de la auditoría: se conserva fuera del commit de entrega. No se suben archivos de tmp/, credenciales ni evidencias privadas.

## Corrección de migraciones

Las 34 migraciones están versionadas y sus versiones están en el ledger remoto. human-resolution tiene blob en HEAD y hash protegido; .gitignore no la elimina de Git. La supuesta migración ausente del informe inicial fue un error de diagnóstico y está corregido en README, arquitectura, operación, informe y Notion. No hay SQL que recuperar ni aplicar por esta publicación.

## Gate y comprobaciones

- Revisión de salida: lint y TypeScript aprobados; 112 pruebas de contrato aprobadas. verify:release encontró dos timeouts locales con el paralelismo por defecto.
- Suite completa repetida con `npx vitest run --maxWorkers=2 --minWorkers=1`: 1321 aprobadas, cuatro omitidas y ningún fallo, conservando los límites originales de los tests. Build de producción posterior aprobado.
- Se registra la incidencia de timeout sin modificar código, configuración de pruebas ni umbrales.
- 372 hashes de archivos protegidos sin diferencias y verificación de destinos Markdown locales.
- Comprobación del diff excluyendo el mapa generado que conserva cambios locales previos.
- Lectura del ledger remoto: 34 versiones, sin pendientes locales.
- Smoke previo en alias productivo: GET /api/health/ai responde 200 con status ok; GET /api/cases sin sesión responde 401 UNAUTHENTICATED, conforme a fail-closed.

## Publicación y cierre

La entrega se publica mediante avance normal de main, sin force push; la integración GitHub/Vercel genera el deployment productivo. Se comprueba READY, commit, doce Functions, alias, frontend, health/ai y rechazo de API sin sesión. El identificador de commit/deployment y resultado final se comunican al cerrar la entrega y se registran en Notion después de verificarlos.

Si la rama remota cambia, no se sobrescribe: se incorpora la evolución antes de publicar. Si el deployment falla, se consulta el log; no se aplica SQL ni se relajan permisos para corregir un fallo de build.

## Límites

Sin inferencias IA reales, carga de datos personales, cambios de credenciales ni modificación de la base. El smoke sin sesión no verifica Google OAuth completo ni permisos de una sesión autenticada. El ensayo de instalación desde cero y la precisión del modelo con muestra representativa siguen como mantenimiento adicional, no como cambios necesarios para entregar esta reorganización documental.
