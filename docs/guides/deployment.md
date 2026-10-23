# Despliegue seguro

## Configuración comprobada

Vercel: proyecto cancelaciones-ai, producción desde main. Commit publicado 38fe66f2eb6f81f49a79f72f5f90681b97f8d072, READY al inspeccionarlo el 23/10/2026; coincide con main remoto y HEAD inicial. La lista de deployments registra un ERROR anterior al arreglo del glob de Copilot; el build de la versión actual termina correctamente.

vercel.json usa framework vite, npm ci, npm run build y dist. El enlace local declara Node 24.x; CI usa 22 y package.json exige >=22.12.0. El log remoto confirma clonación de main, instalación, build y publicación. El glob incluye fuentes PDF y runtime Linux de Copilot. Hay 12 funciones Node: no añadir otro archivo de API sin consolidar una familia.

## Preparación

1. Revisar cambios, permisos y hashes de Policy; ejecutar npm ci si cambian dependencias y npm run verify:release.
2. Contrastar ledger y esquema, preparar backup y ensayar en un backend aislado. [Migraciones](../operations/migrations.md). Nunca aplicar el baseline a producción existente.
3. Revisar los **nombres** de variables con vercel env ls; no imprimir valores. [Entorno](../../README.md#variables-de-entorno). El listado auditado tiene 24 nombres, todos referenciados en código. OPENROUTER_REVIEW_MODEL usa default si no se declara; QUOTA_HMAC_KEY usa la clave administrativa como fallback. Esto describe código existente, no recomienda cambiar secretos durante un despliegue.
4. Preparar preview con entorno propio: las variables observadas están en Production, no se comprobó su disponibilidad efectiva para Preview o Development. No copiar automáticamente valores productivos.
5. Probar sesión Google, membresía, lectura y mutación con roles, adquisición sintética, evidencia, auditoría, revisión y dashboard en entorno de ensayo. Las pruebas unitarias no sustituyen este recorrido.
6. Solicitar aprobación del responsable para publicar o aplicar migraciones. Esta limpieza no hace push ni deploy.

## Después de publicar

Confirmar READY, commit, doce funciones, errores HTTP, sesión/CSRF y conectividad InsForge. health/ai es público pero no reemplaza una inferencia completa. Observar fallos por proveedor y mantener originales e historial. Ante regresión, volver a un deployment previamente validado; no revertir SQL destructivamente. [Runbook histórico](../operations/production-runbook.md).

La inspección no prueba valores efectivos de secretos, precisión del modelo, disponibilidad continua de proveedores ni experiencia de usuario de extremo a extremo.
