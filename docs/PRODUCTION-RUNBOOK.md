# Runbook de producción

> **Vigente pero consolidado.** Los procedimientos detallados de cutover,
> variables de entorno, migraciones, provisión de usuarios, checks post-deploy y
> rollback viven ahora en [`docs/DEPLOYMENT.md`](DEPLOYMENT.md).
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

Ver [`docs/TROUBLESHOOTING.md`](TROUBLESHOOTING.md) para diagnóstico de errores comunes.
