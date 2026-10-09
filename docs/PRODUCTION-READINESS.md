# Revisión de preparación para producción

Fecha: 9 de octubre de 2026. Se revisó `main`, el backend de producción y una
rama full de InsForge. No se hicieron escrituras de datos de expedientes ni
pruebas visuales con información real.

## Estado

El commit `6c4e694` está publicado en `main` y el frontend está desplegado en
Vercel Production. El deployment `dpl_DJBzRrAaEja4AJwMbMb88WEuhT3y` quedó en
estado `READY` y sirve el alias `cancelaciones-ai.vercel.app`. InsForge ya tiene
aplicadas las migraciones `20261009120000_case-student-name` y
`20261009212142_restrict-security-definer-rpc-execution`; `disable_signup` está
configurado en `true`.

## Cambios de preparación aplicados

- `cases.student_name` fue añadida como columna `text` nullable. La migración no
  actualiza filas existentes; se verificó que los 29 expedientes permanecieran.
- Se revocó `EXECUTE` para `PUBLIC`, `anon` y `authenticated` en las funciones
  públicas `SECURITY DEFINER`. Solo seis helpers invocados desde políticas RLS
  conservan permiso para `authenticated`. Producción reporta 0 ejecutables por
  `anon`, 0 helpers ajenos a RLS para `authenticated` y los 6 helpers de política
  disponibles. `admit_or_reject_quota` sigue reservado a `project_admin`.
- `disable_signup=true` coincide con el alta administrativa en InsForge.
- `.vercelignore` evita enviar al deployment el historial local de Aider, las
  capturas de revisión, las pruebas, migraciones y documentos internos. El dry
  run de Vercel ya no incluye esos archivos.

Las dos migraciones se aplicaron primero en la rama aislada
`cancelaciones-predeploy-20261009`; el esquema, la columna, las políticas/grants
y los permisos efectivos se comprobaron allí. La copia contenía 27 expedientes;
producción tenía 29 en la aplicación, por lo que el staging no se usó para
validar datos de negocio ni para la revisión visual. Las migraciones no escriben
ni reclasifican expedientes.

## Verificaciones

- `npm run verify:release`: lint y typecheck, 101 pruebas de contrato, 1,016
  pruebas aprobadas y 3 omitidas, y build Vite correcto. ESLint terminó sin
  warnings.
- `npm run lint:contrast`: todos los pares de texto y series de gráficas
  revisados cumplen WCAG 2.2 AA.
- El deployment respondió HTTP 200 en `/` (título `Auditoría de Cancelaciones · UTEL`)
  y `/api/health/ai` (`status: ok`). El healthcheck sin sesión valida
  configuración, no una generación real del proveedor.
- `vercel deploy --dry` identificó Vite, 12 funciones y el paquete después de
  aplicar `.vercelignore`.
- El asesor de InsForge reportó antes 296 hallazgos (80 críticos, 173 warnings,
  43 informativos); su chequeo `slow-query` no concluyó. Los RPC expuestos por
  grants quedaron cerrados con la migración comprobada en staging y producción.

## Riesgos y comprobaciones pendientes

- InsForge aún enumera `github` junto con `google` como proveedor OAuth. La app
  solo presenta e inicia Google OAuth, exige membresía en el servidor y tiene el
  signup desactivado; la eliminación del proveedor GitHub requiere el panel de
  proveedores de InsForge y no se administra con `insforge.toml` ni con el CLI
  disponible.
- El rol `user` (Asesor) tiene 0 membresías en el snapshot leído; había 2
  `coordinator` y 1 `manager`. No se consultaron identidades ni se inventó un
  usuario para el smoke.
- No se ejecutó `npm run test:ai-smoke`: llama al proveedor de pago. Tampoco se
  pudieron ejecutar flujos autenticados contra la cuenta productiva sin usar
  una identidad/caso real.
- InsForge permite un único backup manual y la cuota ya estaba ocupada por un
  backup `completed` de las 16:58 UTC. No se borró ese punto de recuperación. La
  rama full proporcionó staging aislado, pero una restauración del backup no se
  ensayó; el backup es anterior a los dos casos que hoy elevan producción de 27
  a 29 expedientes.
- El ledger remoto tenía 54 migraciones antes del cambio y ahora tiene 56; el
  checkout contiene 21 archivos SQL. El baseline local no representa la base
  existente, así que `up --to` fue rechazado por InsForge sin escribir. Los dos
  destinos se aplicaron en orden con `db migrations up <archivo>` y aparecen en
  el ledger. No se tocaron manualmente tablas `system.*`.
- El límite Hobby sigue en 12 funciones (12 archivos en `api/`); no hay margen
  para añadir un endpoint como archivo nuevo sin consolidar rutas.

El deployment quedó observado en `READY` después del push a `main`. La
configuración y los checks de este documento no sustituyen los flujos
autenticados y la restauración de backup que siguen pendientes arriba.
