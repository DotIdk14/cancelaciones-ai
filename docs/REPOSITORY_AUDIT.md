# Auditoría del repositorio

**Revisión:** 2026-10-07. **Alcance:** árbol de trabajo local, rutas, servicios, configuración, scripts, migraciones, pruebas, documentación, lockfile y CI. Se revisó el código presente; no se inspeccionaron Vercel, InsForge ni otros servicios productivos.

## Executive Summary

El repositorio presenta una arquitectura modular coherente con el producto AI-native descrito en `AGENTS.md`: SPA React/Vite, Functions de Vercel, persistencia server-side en InsForge, OpenRouter como único proveedor de generación y AssemblyAI para transcripción. La inteligencia normativa está localizada en `src/skills/audit/`, el output del modelo se valida con Zod y referencias, y el flujo duradero de auditoría queda en base de datos.

Las defensas de código más relevantes están implementadas y cubiertas: autenticación remota más membership, CSRF, comprobación de propietario, 404 para recursos ajenos, cuotas fail-closed, límites y firma de archivos antes de efectos, cercado de evidencia no confiable y persistencia de estado terminal. Durante esta revisión se corrigió el registro de mensajes de excepciones no controladas, que podía incluir información del proveedor o del expediente.

La cadena `npm run verify:release` pasó después de los cambios: lint de secretos, contraste, TypeScript, pruebas de contrato, suite completa y build. `npm audit` reportó **24 vulnerabilidades en el árbol completo de desarrollo** y **0 en dependencias de producción**. No se aplicaron upgrades mayores automáticamente. El estado efectivo de producción, las migraciones, las políticas de Storage y la rotación de credenciales no se pueden confirmar desde el repositorio y permanecen **NO VERIFICADO**.

El checkout tenía cambios staged antes de comenzar esta auditoría. Se conservaron; por ello este informe describe el estado observado, no atribuye esos cambios a esta tarea ni certifica que el estado previo fuera limpio.

## Critical

No se confirmó una vulnerabilidad crítica explotable en el runtime de producción durante esta auditoría.

### C1 — Advisories críticos en herramientas de desarrollo

- **Hallazgo:** `npm audit` informa 3 advisories críticos dentro de 23 hallazgos restantes del árbol completo. El paquete directo `vitest@2.1.9` está afectado; la cadena también contiene paquetes transitivos de tooling. Son dependencias de desarrollo, no se reportan en `npm audit --omit=dev`.
- **Archivos:** `package.json`, `package-lock.json`.
- **Riesgo e impacto:** vulnerabilidad en entornos de desarrollo/CI que ejecuten herramientas afectadas bajo condiciones de exposición especificadas por cada advisory. No equivale a una vulnerabilidad observada en el runtime desplegado. El informe automático no valida por sí solo si las precondiciones de explotación se cumplen.
- **Estado:** **PENDIENTE**. Resolver Vitest requiere salir del rango major 2 y revisar compatibilidad/configuración. No se ejecutó un upgrade mayor automáticamente.
- **Verificación:** `npm audit` tras `npm ci`; producción: 0 advisories.

## High

### H1 — Quince advisories altos en dependencias de desarrollo

- **Hallazgo:** el mismo `npm audit` contabiliza 14 advisories altos, incluyendo herramientas directas/transitivas de build y estilos (`@vercel/node`, Tailwind CSS y cadenas de build asociadas). Se reportaron 0 advisories al auditar solo dependencias de producción.
- **Archivos:** `package.json`, `package-lock.json`.
- **Riesgo e impacto:** comprometer una estación de desarrollo o el pipeline de build puede afectar el código producido. No se verificó que esos paquetes formen parte del bundle desplegado; Vite build genera el frontend separado.
- **Estado:** **PENDIENTE**. Revisar avisos y actualizar dentro de rangos compatibles, eliminando solo dependencias cuya falta de uso se confirme. Cambios mayores deben ir acompañados de migración y suite completa.

### H2 — Seguridad operativa de producción no comprobada

- **Hallazgo:** la app depende de memberships, migraciones, RLS/grants y privacidad del bucket; el servidor usa credencial administrativa y complementa RLS con controles de propietario en aplicación.
- **Archivos relacionados:** `migrations/`, `scripts/verify-rls-grants.sql`, `src/server/auth.ts`, `src/server/cases.ts`, `api/evidence/[evidenceId]/download.ts`.
- **Riesgo e impacto:** una configuración incompleta o distinta del código podría bloquear el acceso legítimo o exponer datos/objetos. El código local no prueba la configuración remota.
- **Estado:** **NO VERIFICADO**. No se consultó ni modificó producción ni se ejecutaron migraciones.
- **Acción operativa:** revisar en una sesión autorizada la versión de migraciones, memberships, grants/RLS y política privada owner-scoped de Storage. No incluir filas ni secretos en reportes.

### H3 — Estado de una credencial previamente reportada no comprobado

- **Hallazgo:** un informe previo del repositorio reportó una credencial presente en historia Git. Esta auditoría no confirmó la validez, alcance ni rotación del valor, y no reproduce el secreto.
- **Riesgo e impacto:** borrar un valor del árbol actual no revoca copias históricas.
- **Estado:** **NO VERIFICADO**.
- **Acción operativa:** el propietario del servicio debe comprobar revocación/rotación en el proveedor. Si seguía activa, rotarla y revisar su alcance. No hace falta reescribir la historia como sustituto de rotar la credencial.

## Medium

### M1 — Errores no controlados podían filtrar detalles en logs

- **Hallazgo:** `sendError` y el camino no tipado de comparación imprimían `error.message`. Excepciones de SDK/proveedores pueden incluir contenido de respuesta, URL o datos del expediente.
- **Archivos:** `src/server/http.ts`, `src/server/comparison-service.ts`, `tests/http.test.ts`.
- **Riesgo e impacto:** exposición de información sensible a quien tenga acceso a logs, pese a que el cliente recibía un error genérico.
- **Estado:** **CORREGIDO Y PROBADO**. Se registra solamente el tipo de excepción en esos caminos. Se añadió prueba que verifica que el mensaje sensible no se loguea ni devuelve.

### M2 — No hay licencia en el repositorio

- **Hallazgo:** no existe archivo `LICENSE`.
- **Riesgo e impacto:** el repositorio no comunica permisos de reutilización y no debe presentarse como open source bajo una licencia concreta.
- **Estado:** **PENDIENTE DE DECISIÓN DEL OWNER**. No se eligió una licencia por cuenta del propietario.

### M3 — Procedimiento fuente owner-supplied no es reconstruible desde Git

- **Hallazgo:** `policy/` contiene la serialización versionada por secciones y su manifest; el documento normativo fuente se conserva fuera de Git conforme a los invariantes.
- **Riesgo e impacto:** una persona sin acceso a la fuente del owner no puede comprobar desde este repo que la serialización coincide con el documento oficial completo.
- **Estado:** restricción documentada; la autorización para distribuir la fuente es **NO VERIFICADO**. No se buscó política normativa externa ni se modificó el criterio.

## Low

### L1 — Migración/despliegue reproducibles dependen de tareas operativas

- **Hallazgo:** el repo tiene scripts, checks y documentación de despliegue, pero no puede garantizar que las migraciones y políticas declarativas hayan sido aplicadas al proyecto InsForge real.
- **Riesgo e impacto:** discrepancia de esquema durante deploy.
- **Estado:** documentación existente en `docs/DATABASE.md`, `docs/DEPLOYMENT.md` y `docs/PRODUCTION-RUNBOOK.md`; ejecución y estado remoto **NO VERIFICADOS**.

### L2 — Sin herramientas separadas de lint y formato

- **Hallazgo:** el control de calidad se apoya en TypeScript, un validador de contraste/secretos, Vitest y build; no hay ESLint o Prettier configurados.
- **Riesgo e impacto:** menor uniformidad estática y de formato, sin ser por sí sola un defecto de seguridad o build.
- **Estado:** observado. No se añadió una herramienta nueva sin una necesidad concreta.

## Áreas revisadas

| Área | Resultado de revisión del código |
|---|---|
| API | 12 archivos de Function; wrappers `handleRoute`, métodos explícitos, validación/delegación y cuota donde corresponde. No se añadieron endpoints. |
| Autenticación | Google OAuth PKCE server-side; cookies `httpOnly`, `Secure`, `SameSite=Lax`; verificación remota y membership en `app_memberships`. |
| Autorización | Control server-side por rol y propietario; `404` para caso ajeno; coordinación puede leer globalmente, escritura del propietario. |
| CSRF | Mutaciones protegidas por `Origin` propio y `X-App-Request: 1`. No se encontraron handlers mutantes que acepten `PUT`. |
| Secretos | `.env.local` está ignorado; `.env.example` contiene nombres y defaults sin valores de claves; `lint:secrets` pasó. La validez de los secretos configurados en proveedores no fue comprobada. |
| Base de datos | Acceso centralizado server-side, parámetros estructurados del SDK, migraciones SQL versionadas; no se detectó SQL dinámico en las rutas revisadas. Configuración remota/RLS **NO VERIFICADA**. |
| Evidencias | Límite, MIME, magic bytes, nombre normalizado y cuota antes de Storage; originales inmutables con hash; descarga valida acceso mediante caso/evidencia. Política efectiva del bucket **NO VERIFICADA**. |
| IA | Separación system/user, cercado mecánico, schema estricto, validación de referencias y metadata técnica agregada en servidor. Los modelos aún pueden equivocarse: el schema valida forma/coherencia, no verdad factual. |
| Errores | Respuestas API desconocidas genéricas; mensajes crudos dejaron de escribirse en logs HTTP y de comparación. Diagnósticos de auditoría construidos por allowlist. |
| Timeouts/costos | Timeouts y deadline en proveedores; cuota persistente; fingerprint/resultados durables evitan reprocesar contenido sin cambios. Smoke live separado porque puede facturar. |
| GitHub | CI con permisos de solo lectura y acciones fijadas por SHA; Dependabot y plantillas presentes. No se verificó ejecución remota reciente del workflow. |
| Functions | Conteo local: 12 archivos bajo `api/`, el límite operativo documentado por el proyecto; sin margen para otro archivo sin consolidar. |

## Verificaciones ejecutadas

- `npm ci`: completó. Emitió avisos de paquetes deprecados y de scripts de instalación pendientes de aprobación con el npm local.
- `npm run verify:release`: pasó (lint de secretos, contraste, TypeScript, contract tests, suite, build).
- Pruebas: **676 pasaron, 3 omitidas**, en 54 archivos. Las omitidas son smoke tests que requieren credenciales y pueden generar coste.
- Build: Vite 6.4.3 terminó y emitió el bundle de `dist/`.
- `npm audit`: inicialmente 24 advisories (6 moderados, 15 altos, 3 críticos). Se aplicó la corrección no-major disponible con `npm audit fix`, que actualizó `source-map-js` de 1.2.1 a 1.2.2. El resultado final fue 23 (6 moderados, 14 altos, 3 críticos); `npm audit --omit=dev` reportó 0.
- Servicios productivos, estado de despliegue, datos, migraciones y políticas remotas: **NO VERIFICADO**.

## Archivos cambiados por esta auditoría

- `src/server/http.ts`: deja de imprimir mensajes crudos de excepciones no controladas.
- `src/server/comparison-service.ts`: deja de registrar mensajes crudos de excepciones de comparación.
- `tests/http.test.ts`: cubre la redacción de logs y la respuesta genérica.
- `docs/ARCHITECTURE.md`: arquitectura, límites de confianza y flujo real de auditoría.
- `docs/REPOSITORY_AUDIT.md`: reemplaza resultados de auditorías antiguas con el estado comprobado el 2026-10-07.
- `README.md` y `docs/migration-ai-native.md`: actualizan referencias al documento de arquitectura.
