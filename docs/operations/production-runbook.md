> Referencia operativa con antecedentes históricos. Estado remoto del 23/10/2026: [informe vigente](../audits/cleanup-report.md). Para adquisición actual usar [Flokzu directo](../architecture/flokzu.md); no usar instrucciones retiradas de Excel o revisión administrativa.

# Runbook de producción

> **Vigente pero consolidado.** Los procedimientos detallados de cutover,
> variables de entorno, migraciones, provisión de usuarios, checks post-deploy y
> rollback viven ahora en [`docs/guides/deployment.md`](../guides/deployment.md).
> Este archivo conserva solo la guía de promoción/release.

## Promoción a producción

1. Validar localmente:

```powershell
npm.cmd ci
npm.cmd run verify:release
```

2. Crear preview en Vercel:

```powershell
npx vercel deploy
```

3. Healthcheck del preview:

```
GET https://<preview>/api/health/ai
```

Debe responder `status: "ok"` o `"degraded"`, con el modelo esperado y sin exponer secrets.

4. Canary sintética con variables del preview:

```powershell
npx vercel env pull .env.preview.local --environment=preview
npm.cmd run test:ai-smoke:preview
```

El smoke llama OpenRouter directamente con el código de preview; puede generar coste.

5. Promover solo si ambos checks pasan:

```powershell
npx vercel deploy --prod
```

6. Repetir healthcheck y smoke en producción.

## Smoke test post-deploy

1. `GET /api/health/ai` → `status: "ok"`, sin campos secretos.
2. Login con usuario que tenga `app_memberships` → debe autenticar.
3. Login con usuario sin `app_memberships` → 403.
4. `GET /api/cases` anónimo → 401.
5. Crear caso, subir PDF/TXT/imagen → evidencia `READY`.
6. Ejecutar auditoría → fila `audits` `COMPLETED`, referencias válidas.
7. Verificar `audits.provider_metadata.openrouterAttempts` sin contenido de prompt/evidencias.
8. Registrar revisión humana → `case_reviews` + `case_comparisons`.
9. Aislamiento: con una segunda cuenta, `GET /api/cases/:caseId` ajeno → 404.

## Nota de seguridad

No almacenar ni imprimir connection strings, API keys o tokens. Las credenciales
se consumen únicamente desde entornos server-side o desde la configuración segura
de las plataformas.

Ver [`docs/guides/troubleshooting.md`](../guides/troubleshooting.md) para diagnóstico de errores comunes.

## Procedimientos conservados de entrega

Revalidar permisos, proyecto y entorno antes de ejecutar; esta auditoría no ejecutó estos pasos.

## Provisión de `app_memberships`

**MANUAL**. El producto no tiene signup público; el owner designa usuarios.

1. Crea las cuentas de usuario en InsForge Auth (o asegúrate de que ya existan en `auth.users`).
2. Inserta una fila por usuario en `public.app_memberships`:

```sql
INSERT INTO public.app_memberships (user_id, role) VALUES
  ('<uuid-del-asesor>', 'user'),
  ('<uuid-del-coordinador>', 'coordinator'),
  ('<uuid-del-gerente>', 'manager');
```

Roles (vocabulario cerrado, `CHECK` en la base desde `20261008100000`):

- `user` (**Asesor**): lee cualquier caso; crea, muta y registra la decisión de asesor en los propios.
- `coordinator` (**Coordinador**): lee cualquier caso y finaliza cualquiera; crea y muta los suyos. En casos ajenos solo puede aprobar sin comentario; no cambia resolución ni agrega comentarios.
- `manager` (**Gerente**): solo lectura global; no crea, no muta, no revisa ni finaliza (un `POST` suyo es `403`).

Los permisos los decide `capabilitiesForRole` (`src/server/capabilities.ts`), no la RLS: el servidor escribe como `project_admin` y para él las políticas no aplican. Un rol fuera del vocabulario, o sin fila, recibe `403` (fail-closed).

Hasta que un usuario tenga fila en `app_memberships`, podrá autenticarse pero recibirá **403**.

## Gate de Storage

**MANUAL**. Antes de habilitar login, verifica la política del bucket `evidencias`:

```bash
insforge storage buckets list
insforge storage policies list --bucket evidencias
```

- **No debe existir** una política que otorgue `SELECT` directo a `authenticated` ni a `anon`.
- El único acceso permitido al bucket es desde el servidor mediante `INSFORGE_API_KEY` (rol `project_admin`).
- Si existe una política pública o para `authenticated`, corrígela antes de cutover.

## Rollback

**MANUAL**.

- No se hace rollback a una versión sin autenticación: eso expondría los casos a usuarios anónimos.
- El rollback seguro es **revertir el tráfico a una imagen que también exija sesión + `app_memberships`**.
- Si la app debe quedar offline, deshabilita el acceso desde InsForge/Vercel antes de degradar.
- La aplicación es **fail-closed por diseño**: si algo falla, responde 401/403/503; nunca 200 anónimo.

## Rotación de `INSFORGE_API_KEY`

**MANUAL**.

Si la clave se expuso:

1. Genera una nueva `INSFORGE_API_KEY` en el panel de InsForge.
2. Actualízala en Vercel (`npx vercel env add INSFORGE_API_KEY`).
3. Redespliega.
4. Revoca la clave anterior desde InsForge.
5. Verifica que el healthcheck y una auditoría de prueba funcionan.
