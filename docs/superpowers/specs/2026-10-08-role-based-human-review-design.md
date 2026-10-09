# Roles, vistas y revisión humana secuencial

## Estado

Diseño aprobado por el usuario; pendiente de revisión del documento antes de crear el plan de implementación.

## Objetivo

Habilitar vistas diferenciadas para Asesor, Coordinador y Gerente, con autorización real en el servidor, revisión humana secuencial y clasificación explícita de casos de prueba frente a casos reales. El desarrollo se realizará en una rama separada y se mostrará en un navegador local conectado al backend real.

## Roles y permisos

| Rol | Visibilidad | Capacidades |
|---|---|---|
| Asesor | Solo casos propios | Crear y gestionar sus casos; registrar su revisión y resolución propuesta. |
| Coordinador | Todos los casos | Consultar y registrar la decisión final, conservando o cambiando la resolución propuesta por el Asesor. |
| Gerente | Todos los casos | Solo lectura; no puede mutar casos ni dictámenes. |

La autorización se aplica en cada endpoint server-side. El gating de UI es solo presentación. Un recurso fuera del alcance de lectura del Asesor conserva la respuesta 404 para no revelar su existencia.

## Flujo y persistencia

1. El Asesor registra una decisión y resolución propuesta.
2. El Coordinador registra la decisión final y puede mantener o cambiar la resolución.
3. La decisión del Coordinador completa el flujo y el caso se presenta como finalizado.

Las dos decisiones se conservan separadamente; la revisión del Coordinador no sobrescribe la del Asesor. El estado final se deriva del flujo de revisión, sin reutilizar `cases.status = COMPLETED`, que hoy representa que terminó la auditoría de IA. `audits.result_json` permanece como dictamen de IA, separado de las decisiones humanas.

La persistencia debe ser durable en Postgres/InsForge y conservar actor y timestamp establecidos por servidor. El nombre de revisor no se acepta como atribución confiable desde el cliente. Se debe aprovechar o evolucionar el almacenamiento vivo de revisiones, no implementar contra el módulo/tablas de revisión legacy sin uso. La estrategia de migración debe ser forward-only, idempotente y compatible con membresías ya existentes.

## Casos de prueba

Cada caso tendrá clasificación explícita y persistente como prueba o real. La clasificación será validada en el servidor, visible en lista y detalle, y los casos de prueba quedarán excluidos de métricas operativas reales. Las pruebas automatizadas y la validación del flujo usarán datos sintéticos clasificados como prueba; no mutarán casos reales existentes.

Se solicita habilitar tres usuarios demo, uno por rol. La provisión debe usar el mecanismo administrado de identidades/membresías existente, no almacenar contraseñas o tokens en código, documentación versionada ni logs. Antes de aprovisionarlos en la DB real, se determinará el mecanismo seguro disponible y se confirmará el impacto de las escrituras. La autenticación sigue siendo Google OAuth; no se introducen credenciales locales ni signup.

## Arquitectura afectada

- `src/server/auth.ts`: vocabulario de roles y capacidades fail-closed.
- `src/server/cases.ts`, `reviews.ts`, `comparison-service.ts`: scope por rol y flujo humano secuencial.
- DTOs y dashboard: estado/classificación, filtros, agregaciones sin casos de prueba.
- `api/auth/[action].ts`: comunicar el rol a la SPA a través de la ruta existente; no añadir una Function nueva.
- SPA: navegación y vistas por rol, revisión por etapas, indicadores de estado y tipo.
- Migraciones y sus checks: roles, flujo y tipo de caso, cuidando membresías y datos existentes.
- Tests: matriz rol × acción en API, secuencia de revisiones, aislamiento de casos, clasificación y exclusión de métricas.
- Documentación: permisos y procedimiento de aprovisionamiento.

El repositorio está en el límite de 12/12 Vercel Functions: no se añadirá ningún archivo endpoint sin consolidar una familia en el mismo cambio.

## Entorno de trabajo y demo

- Implementar en rama separada, sin descartar cambios concurrentes o ajenos.
- Levantar la SPA local y abrirla en un navegador para revisión visual.
- La API local apuntará a InsForge real según la petición del usuario; las escrituras intencionadas se consideran escrituras reales.
- No ejecutar smoke tests que creen/modifiquen casos reales. Verificar cookie segura en localhost y evitar confundir el preview DEMO sin login con la UI integrada real.
- No mostrar, guardar ni enviar secretos de entorno en código, navegador, logs o documentación.

## Seguridad y validación

La superficie es HIGH_RISK por autorización, cambios persistentes y datos reales. Aplicar revisión de APIs/auth y OWASP, revisión obligatoria independiente del diff, pruebas server-side de la matriz de permisos, y revisión de migraciones. Mantener fail-closed, CSRF, validación Zod antes de efectos y respuestas 404 para recursos ajenos. No confiar en RLS como único límite porque el servidor opera con privilegios elevados.

Validación en cascada: tests de módulos/endpoints afectados, después tests del paquete y, al cierre, typecheck/lint/build según scripts disponibles. Verificar el diff, estado Git y rama antes y después. No ejecutar ni aceptar pruebas que puedan alterar datos reales sin datos sintéticos identificados.

## Riesgos y cuestiones para el plan

- `case_reviews` actualmente permite una sola revisión por caso; la secuencia requiere nueva representación o historial sin perder la decisión inicial.
- Membresías reales tienen constraint de rol actual; la migración debe considerar los registros existentes y conservar denegación fail-closed.
- Varios endpoints comparten guard de ownership; una relajación accidental habilitaría mutación cross-tenant.
- El scope de dashboards hoy ocurre en memoria después de un límite de filas y las opciones de filtros no reciben auth; corregirlo para no filtrar ni subcontar datos.
- La herramienta de migraciones ejecuta sentencias individualmente y no aplica el bloque verify SQL original; diseñar checks compatibles y recuperación ante fallo parcial.
- Las cuentas demo sobre el backend real requieren aprovisionamiento controlado y no deben introducir passwords compartidos ni cuentas OAuth ficticias.

## Fuera de alcance

- Cambiar Google OAuth/PKCE, añadir signup o credenciales locales.
- Modificar el dictamen generado por IA o reintroducir un rules/policy engine.
- Desplegar a producción, modificar infraestructura o hacer commit/push como parte de la fase de diseño.
