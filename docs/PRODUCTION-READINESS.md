# Revisión de preparación para producción

Fecha: 9 de octubre de 2026. Revisión de `main` y del backend InsForge vinculado,
con lecturas no mutantes a través de Vercel CLI e InsForge CLI. No se hizo deploy,
push, escritura de datos ni cambio remoto de configuración o esquema.

## Dictamen

**No desplegar todavía.** La verificación local está verde, pero hay un bloqueo
funcional de esquema, permisos RPC amplios en el backend y configuración de
autenticación que no coincide con las invariantes del producto. La producción
actual continúa sirviendo el deployment anterior.

## Bloqueos de release

### 1. Código actual requiere una columna que producción no tiene

El catálogo de producción no contiene `public.cases.student_name`, pero
`POST /api/cases` escribe esa columna desde `src/server/cases.ts`. La migración
`20261009120000_case-student-name.sql` está en el checkout pero no figura en el
ledger remoto. Un despliegue previo a una conciliación y aplicación aprobada
rompería la creación de expedientes nuevos. La sección de relectura en
[`MIGRATION-RECONCILIATION.md`](MIGRATION-RECONCILIATION.md) contiene el estado de
migraciones observado y el plan vigente.

### 2. Funciones `SECURITY DEFINER` ejecutables por roles cliente

El catálogo contiene 49 funciones públicas `SECURITY DEFINER` ejecutables por
`anon` o `authenticated`: 41 ejecutables por `anon` y 49 por `authenticated`.
El asesor de InsForge reportó 48 hallazgos críticos `dangerous-function` y dos
`rls-no-policy`; además, el chequeo `slow-query` no terminó. La consulta de
catálogo confirmó que funciones de jobs como `enqueue_job`, `claim_next_job`,
`claim_next_audit_job`, `record_job_artifact`, `complete_job` y
`renew_job_lease` aceptan ejecución de `anon` y `authenticated`. Algunas
operaciones usan un `worker_id` que aporta el cliente y no autentican la
identidad del llamador. Esto requiere inventariar consumidores externos y
ensayar en staging un cierre granular de grants; revocarlos en bloque podría
romper consumidores legacy.

Los dos resultados `rls-no-policy` afectan `request_admissions` y
`app_memberships`. RLS está habilitada y los roles cliente no tienen privilegio
de `SELECT` en esas tablas; ese hallazgo está actualmente contenido por la
denegación directa. No apliqué las políticas genéricas que propone el asesor.

### 3. Autenticación de InsForge no refleja Google-only / sin signup

La metadata remota informa `disableSignup: false` y proveedores OAuth `github` y
`google`. La app solo implementa Google OAuth y no ofrece signup. Aunque la
autorización de la aplicación exige una fila en `app_memberships`, esta
configuración permite superficies de autenticación que el producto no usa y
debe reconciliarse en InsForge antes del lanzamiento.

En la tabla `app_memberships` hay 2 filas `coordinator` y 1 `manager`, sin rol
`user` (Asesor) en el snapshot de esta revisión. No se consultaron identidades.
Si se espera operación de Asesores, hay que habilitar el alta por el proceso
administrativo autorizado y probar ese flujo antes de lanzar.

## Estado verificado

- `npm run verify:release`: completó correctamente: lint, typecheck, contratos
  (101), suite completa (1,015 aprobadas, 3 omitidas) y build Vite. Lint conserva
  dos warnings de dependencias de hooks en `CaseDetailPage.tsx` y
  `EvidencePane.tsx`.
- La comprobación de contraste confirma WCAG 2.2 AA para los pares de texto y
  series de gráficas revisados.
- La raíz de producción respondió HTTP 200 y entregó HSTS, CSP,
  `X-Content-Type-Options: nosniff` y `X-Frame-Options: DENY`. El endpoint público
  `/api/health/ai` respondió `status: ok`; sin sesión, esta respuesta solo
  confirma que la clave y el modelo principal están configurados, no prueba una
  generación ni la compatibilidad completa del proveedor.
- Vercel muestra un deployment de producción `Ready` creado hace unas cuatro
  horas. Su metadata no incluye `gitSource`; no es evidencia de que contenga el
  `main` local actual. El checkout tiene cambios locales sin publicar y no hay
  una correlación verificable entre este checkout y ese deployment.
- `api/` tiene 12 archivos de función, el límite Hobby documentado para este
  proyecto. No queda margen para añadir otro archivo sin consolidar rutas.
- La lista de variables de producción contiene las claves server-side
  requeridas (`INSFORGE_*`, `OPENROUTER_*`, `ASSEMBLYAI_API_KEY`, `APP_URL`) y no
  mostró nombres `VITE_*` o `NEXT_PUBLIC_*`. No se leyeron ni copiaron valores.
- Los buckets de evidencia observados están privados. Las tablas core tienen
  RLS habilitada; `cases.created_by` sigue nullable por compatibilidad histórica,
  aunque los 29 casos actuales no tienen `created_by` nulo.
- El scan del asesor de InsForge contó 296 resultados (80 críticos, 173 warnings
  y 43 informativos); el detalle recuperado contenía 50 hallazgos, incluidos los
  críticos de funciones. El asesor incluye objetos legacy que no usa la app,
  pero los grants públicos en funciones de escritura no se pueden descartar sin
  identificar sus consumidores.

## Antes de autorizar un deploy

1. Conciliar y ensayar en staging la migración `20261009120000` con respaldo
   restaurable; confirmar la creación de caso y el flujo de lista/detalle contra
   el esquema resultante.
2. Inventariar workers o consumidores externos de los 49 RPC, revisar cada
   `SECURITY DEFINER` y sus grants, y ensayar las revocaciones precisas sin
   retirar permisos que necesiten funciones RLS, triggers o workers vigentes.
3. Alinear `disableSignup`, proveedores OAuth y redirects con Google-only; probar
   el rechazo de usuarios sin membership y confirmar el alta del rol Asesor por
   el proceso administrativo.
4. Reconciliar el ledger de 54 migraciones remotas con los 20 archivos locales.
   No descargar ni reejecutar en lote las migraciones legacy y no tocar
   `system.custom_migrations` manualmente.
5. Tras esos cambios aprobados, volver a ejecutar el asesor de InsForge y
   `npm run verify:release`; desplegar primero a Preview y verificar sesión,
   creación de caso, carga de evidencias, auditoría, revisión humana y dashboards
   antes de promover a producción.

No se ejecutó `test:ai-smoke` porque llama al proveedor externo y puede generar
costo; la revisión del healthcheck no sustituye esa prueba pagada.
