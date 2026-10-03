# Auditoría del repositorio

Auditoría actualizada: 2026-10-02. Ramas y worktrees revisados: `main`,
`integration/all`, `feature/dashboard-local` y `dashboard/verify`, además de las
ramas remotas visibles.

Alcance: arquitectura, API, autenticación/autorización, acceso a datos y
Storage, procesamiento de evidencias, pipeline de IA, dependencias, CI,
documentación y estado de las ramas. No se inspeccionaron ni modificaron
servicios de producción. No se corrigió código: este documento registra los
cambios recomendados y las verificaciones reproducibles.

---

## Estado vigente y cambios recomendados

### Resumen ejecutivo

La arquitectura de aplicación revisada tiene defensas importantes en el
servidor: `handleRoute` protege las rutas, la sesión se valida remotamente,
existe comprobación de membership, las mutaciones validan CSRF, las rutas de
casos aplican ownership, las cargas validan firma/tamaño antes de escribir y el
contrato de auditoría usa schemas Zod estrictos y cercado de contenido no
confiable. Esto es una buena base, pero **no demuestra que las políticas y
migraciones estén aplicadas en producción**.

La verificación del código varía por worktree. `dashboard/verify` pasa
`npm run verify:release` (282 pruebas aprobadas, 2 omitidas). En
`integration/all`, el árbol de trabajo tiene cambios parciales incompatibles y
`npm run verify:release` se detiene en `typecheck` con errores TS. El árbol
local asociado a `main` también contiene modificaciones sin guardar de otro
trabajo; no se incorporaron. Por tanto, **no se considera seguro mezclar ni
publicar todo el código de esas ramas como una sola unidad**.

### Hallazgos y plan de cambios

| Prioridad | Hallazgo | Evidencia/alcance | Cambio recomendado |
|---|---|---|---|
| P0 — seguridad | Una auditoría previa de este repositorio registra una credencial de proveedor en el historial Git (`SECURITY.md` y la sección histórica de este informe). | La validez y rotación actual de esa credencial están **NO VERIFICADAS**. Borrar una clave del árbol actual no la revoca ni la elimina del historial. | Confirmar con el dueño del servicio que fue revocada/rotada; revisar el alcance de uso y tratarla como expuesta hasta confirmarlo. No volver a incluir el valor en logs o documentación. |
| P1 — dependencias | `npm audit` encontró 11 hallazgos: 2 críticos, 3 altos y 6 moderados. Entre ellos: `tar` transitivo desde `@vercel/node`/`@mapbox/node-pre-gyp`; `vitest@2.1.9` con advisories críticos/altos; y `undici`/`ajv`/`vite` transitivos. | `npm audit --omit=dev` encontró 0 vulnerabilidades. Los paquetes señalados pertenecen a dependencias de desarrollo/build en el lockfile actual; los advisories de Vitest requieren exponer su servidor para explotar sus rutas afectadas. No se encontró evidencia de que esas versiones se incluyan en el runtime de producción. | Planear una actualización compatible de Vitest y `@vercel/node` (npm propone majors); después regenerar lockfile y ejecutar `verify:release` y auditoría otra vez. No ejecutar `npm audit fix --force` sin migración y pruebas. |
| P1 — release | Las modificaciones locales de `integration/all` no pasan `typecheck`: props incompatibles del dashboard, exports/tipos faltantes y una función `latestCompletedAudit` duplicada. | `npm run verify:release` falla antes de tests y build en ese worktree. No se afirma que esos cambios estén en el commit HEAD ni en `dashboard/verify`. | Conciliar la versión staged y unstaged de cada archivo, eliminar duplicados y validar el conjunto integrado con `npm run verify:release` antes de mergear/publicar. |
| P1 — operación | La aplicación depende de configuración de InsForge, memberships, RLS y permisos del bucket de evidencias. | La configuración efectiva, migraciones aplicadas, miembros autorizados, privacidad del bucket y políticas Storage de producción están **NO VERIFICADAS** en esta auditoría. El código server-side usa credenciales administrativas, por lo que sus checks de ownership son una frontera crítica. | Verificar, con acceso autorizado y sin exponer datos, el estado de migraciones, memberships, RLS/grants y que la descarga del bucket sea privada y esté limitada al servidor. No ejecutar migraciones ni cambios de configuración de producción durante la revisión. |
| P2 — datos | El historial de casos previos y el backfill de filas sin propietario requieren comprobación operativa. | No se consultaron datos reales ni se comprobó la integridad del backfill. | Antes de despliegues, preparar un inventario y plan de backfill revisable, con backup y sin tocar producción hasta su aprobación. |
| P2 — integridad de cambios | Hay ediciones staged y unstaged superpuestas; algunos archivos del árbol de trabajo contienen texto con codificación dañada. | Se observó en `README.md`, `scripts/dev-api.mjs` y módulos del dashboard en el worktree sucio; no se mezcló en `main`. | Resolver primero qué versión es la intencionada; guardar como UTF-8 y revisar `git diff --check`/`git diff` antes de hacer commits. |
| P2 — ramas | Hay ramas remotas de experimentos anteriores de policy foundation/engine, además de ramas locales de dashboard con historial no integrado. | Esas ramas no son equivalentes a cambios listos para release. Las de policy engine contradicen el invariante vigente `NO_RULES_ENGINE`. | No fusionarlas automáticamente. Revisar cada commit contra la arquitectura AI-native y los tests antes de considerar un merge. |
| P3 — observabilidad | El handler HTTP registra el mensaje de errores no controlados en logs; la sanitización de errores del proveedor no necesariamente cubre excepciones desconocidas de todos los adaptadores. | No se comprobó una filtración de secreto concreta por esta ruta. | Auditar los mensajes de excepciones externas y adoptar logging estructurado con redacción de credenciales/PII y un identificador de correlación, sin registrar cuerpos de evidencias. |
| P3 — apertura del proyecto | El reporte anterior ya señala ausencia de `LICENSE` y que la fuente normativa oficial no se distribuye en Git. | La licencia elegida y el permiso para redistribuir el procedimiento están **NO VERIFICADOS**. | Elegir una licencia con asesoría del propietario y documentar que las fuentes normativas son owner-supplied; no publicar documentos normativos sin autorización. |

### Estado de verificación

| Verificación | Resultado |
|---|---|
| `npm run verify:release` en `dashboard/verify` | **OK**: lint de secretos y contraste, typecheck, 57 tests de contrato, 282 tests aprobados, 2 omitidos y build Vite. |
| `npm run verify:release` en `integration/all` | **FALLA** en TypeScript antes de tests/build por incompatibilidades del árbol modificado; detalles arriba. |
| `npm audit` | **FALLA**: 11 advisories en dependencias transitivas/directas de tooling (2 críticas, 3 altas, 6 moderadas). |
| `npm audit --omit=dev` | **OK**: 0 vulnerabilidades reportadas en el árbol de dependencias de producción. |
| Servicios Vercel/InsForge/OpenRouter/AssemblyAI | **NO VERIFICADO**: no se consultaron despliegues, configuración ni datos de producción. |
| Aplicación de migraciones y políticas Storage/RLS en producción | **NO VERIFICADO**. |
| Estado de rotación de la credencial registrada en auditoría anterior | **NO VERIFICADO**. |

### Decisión de integración/publicación

Esta auditoría solo incorpora documentación. No se subió el conjunto de código
parcial del worktree `integration/all`: está sucio y su verificación falla. El
worktree local de `main` ya contenía ediciones de otro trabajo; se preservaron.
La publicación de este informe no equivale a aprobar ni desplegar los cambios
de producto que siguen pendientes de conciliación y verificación.

---

## Auditoría anterior — hallazgos corregidos y trabajo histórico

Las secciones siguientes conservan el inventario de cambios y pruebas de la
auditoría anterior. Sus descripciones de estado/cobertura son históricas y no
reemplazan la verificación vigente indicada arriba ni certifican el estado de
un despliegue real.

## 1. Veredicto anterior

| Dimensión | Estado | Nota |
|---|---|---|
| Seguridad de código | **Sólida** tras las correcciones | Los 4 hallazgos altos están cerrados con test de regresión |
| Correctitud | **Sólida** | Suite completa verde; corregidos dos bugs de producción (cuotas no cableadas, polling que no observaba el estado terminal) |
| Integridad de datos | **Pendiente de operación** | Requiere aplicar migraciones y backfill en la instancia real |
| Mantenibilidad | **Mejorada** | Ciclo de imports que colgaba la suite eliminado de raíz |
| Documentación | **Completada** | README, SECURITY, CONTRIBUTING, docs/ coherentes con el código |
| Preparación para open source | **Casi** | Falta `LICENSE` y decidir la política de datos normativos |

**Ningún hallazgo abierto en el código.** Lo que queda abierto está en el
entorno, no en el repositorio.

## 2. Hallazgos de seguridad corregidos

Ordenados por severidad. Todos con test de regresión.

### 2.1 CRÍTICA — MIME declarado sin validar el contenido real

**Antes:** la evidencia solo se validaba por el `content-type` declarado por el
cliente. Renombrar un `.exe` o un `.pdf` malicioso a `.txt` lo metía al
expediente como texto, y de ahí al prompt.

**Ahora:** `verifyFileSignature` (`src/server/evidence-prep.ts`) compara los
primeros bytes con la firma del formato declarado. Para `text/plain` se rechaza
si aparece un prefijo de binario (`PK`, `MZ`, `\x7fELF`, `#!`, `<!DO`, nulos).
La validación ocurre **antes** de la cuota y antes del upload.

**Tests:** `tests/evidence-upload-guard.test.ts` (8), `tests/evidence-prep.test.ts`.

### 2.2 CRÍTICA — Endpoints sin sesión resuelta en la frontera

**Antes:** los handlers llegaban a `createServerClient()` sin verificar sesión.
El scoping por dueño existía como filtro de resultado, no como barrera, y varias
rutas no lo tenían en absoluto.

**Ahora:** `handleRoute` resuelve la sesión **antes** del handler y falla cerrada
(`401`). Quedan 12 endpoints protegidos de 15 (los 3 públicos son
`POST`/`DELETE /api/auth/session`, `POST /api/auth/refresh` y `GET
/api/health/ai`). El scoping por dueño se aplica con `assertCaseOwner` /
`getScopedCaseOr404` en cada ruta que toca un caso, incluida la descarga binaria.

**Tests:** `tests/security-regressions.test.ts` (26 casos, incluye `401` en las 12
rutas).

### 2.3 ALTA — Cuotas con falso positivo `429`

**Antes:** si la RPC `admit_or_reject_quota` fallaba o devolvía `admitted` en un
tipo inesperado, se traducía a `429` "alcanzaste tu límite". El usuario veía un
límite que no existía y la caída de infraestructura quedaba oculta.

**Además:** la cuota no cubría el camino real de `runAudit`,
`startComparison` ni la transcripción de audio. Anyone podía auditar sin límite.

**Ahora:** respuesta malformada → `503 PROVIDER_UNAVAILABLE`. Cuotas cableadas en
los tres caminos. El sujeto se hashea con HMAC antes de persistirse.

**Tests:** `tests/quotas.test.ts` (9), `tests/paid-quota.test.ts` (11).

### 2.4 ALTA — Subida de audio dejaba filas y bytes huérfanos

**Antes:** al subir audio se insertaba la fila y se subía a Storage sin verificar
cuota. Un rechazo posterior dejaba un objeto en el bucket y una evidencia en
`UPLOADED` que **bloqueaba la auditoría del caso para siempre**.

Lo grave del síntoma: el caso quedaba en un limbo del que no se sale ni por UI
ni por API. No había ruta de recuperación.

**Ahora:** orden firma → cuota → Storage → insert. `updateCaseStatus` propaga su
fallo en vez de tragárselo; `deleteEvidence` propaga el fallo de Storage para no
dejar objetos sin dueño.

**Tests:** `tests/evidence-upload-guard.test.ts`, `tests/evidence-status.test.ts`
(24).

### 2.5 MEDIA — Prompt injection vía contenido no confiable

**Antes:** el bloque anti prompt-injection del system prompt era la única
defensa, y depende del modelo. El nombre del archivo se interpolaba crudo en el
encabezado del expediente.

**Ahora:** `src/skills/sanitize.ts` añade la capa que sí se puede testear.
`sanitizeTagDelimiters` neutraliza etiquetas de cierre que finjan cerrar un
bloque, `sanitizeFenceDelimiters` impide cerrar la región con una cerca de
código, y el nombre del archivo se sanea antes de aparecer en el encabezado.

**Tests:** `tests/integrity-untrusted.test.ts` (15), `tests/comparison-injection.test.ts`.

### 2.6 MEDIA —CSRF ausente

**Ahora:** todo método mutante exige `Origin` == `APP_URL` **y** `X-App-Request: 1`.

### 2.7 MEDIA — `404` vs `403` en recursos ajenos

Un `403` sobre un caso ajeno confirma que el identificador existe: la API se
convertía en oráculo de enumeración. Ahora `assertCaseOwner` y
`getScopedCaseOr404` devuelven `404`. Un test que esperaba `403` se corrigió
para que fije el comportamiento correcto, no el que se había escrito primero.

### 2.8 MEDIA — Transcripción sin timeout

AssemblyAI podía dejar la Function colgada. Ahora `fetchWithTimeout` con
`AbortController` y `ASSEMBLYAI_REQUEST_TIMEOUT_MS` (60 s, nueva variable de
entorno). Un fallo de submit deja `processing_status: 'ERROR'`, no `UPLOADED`
para siempre.

## 3. Correcciones de correctitud

### 3.1 Bucle de imports que colgaba la suite completa

**Síntoma:** la suite no terminaba. Tests aislados pasaban; la suite completa se
quedaba esperando sin fallar.

**Causa raíz:** ciclo `http.ts → auth.ts → insforge.ts`. Los tests sustituyen
`insforge` por el store en memoria; el store importaba `ApiError` desde `http.ts`;
`http.ts` importaba `auth.ts`; `auth.ts` volvía a importar `insforge` (mock).
La fábrica `vi.mock` esperaba un módulo que nunca terminaba de resolver.

**Solución:** `src/server/errors.ts` como módulo hoja con `ApiError` y
`mapProviderError`; `http.ts` los reexporta para no cambiar las importaciones
existentes. El store importa desde `errors`, que no importa nada del servidor.

El mismo patrón se repitió con `derivedExtractionOf`: se movió a
`src/server/derived.ts` por la misma razón. De ahí el invariante
`LEAF_MODULES_HAVE_NO_SERVER_IMPORTS`.

### 3.2 Orden de validación en la subida

El MIME se validaba **después** de escribir. Cualquier archivo con tipo no
permitido alcanzaba a tocar el bucket antes de ser rechazado.

### 3.3 Caché de derivados

El texto extraído de cada PDF se re-extraía en cada auditoría, con el coste de
`pdfjs` incluido. Ahora se persiste en `evidence.extracted_text` con su
`extraction_pipeline_version`; si la versión no coincide, se descarta y se vuelve
a extraer (`DO_NOT_REPROCESS_AI_UNNECESSARILY`).

### 3.4 Fingerprint canónico

El fingerprint de la auditoría incluía `processing_status` y `assemblyId`, que
son estado de control, no contenido del expediente. Un cambio de estado
invalidaba la conclusión y provocaba una llamada pagada de más. Ahora se
excluyen y se versiona con `AUDIT_PIPELINE_VERSION`.

### 3.5 El presupuesto de polling impedía observar el estado terminal

`refreshTranscriptions` comprobaba el deadline **antes** de leer el estado de
AssemblyAI. Con el presupuesto ya vencido la función hacía cero consultas: un
audio con transcripción en `ERROR` nunca se propagaba, `runAudit` lo veía
`TRANSCRIBING` y devolvía `202 pendingEvidence` indefinidamente. El caso quedaba
atascado sin ruta de recuperación por UI ni por API: la misma clase de limbo que
producía la subida huérfana (§2.4), y sin ningún error que explicara la espera.

El presupuesto acorta cuánto se **espera**, no si se **observa**: ahora el estado
se lee al menos una vez aunque la ventana haya vencido, y el deadline solo limita
las esperas entre lecturas.

El test de regresión fija el comportamiento con ventana `0`. Sin el fix falla.
La intermitencia que lo reveló no era del handler sino del reloj: el test usaba
una ventana de 1 ms y la lectura completaba en 0–2 ms, así que un solo `await`
que cruzara el milisegundo convertía el caso en `202` en vez de `400`.

## 4. Cobertura de pruebas

| Archivo | Casos | Qué fija |
|---|---|---|
| `tests/security-regressions.test.ts` | 26 | `401` en 12 rutas, CSRF, `404` de ownership, membership |
| `tests/integrity-untrusted.test.ts` | 15 | Prompt injection, cercado, orden de validaciones |
| `tests/paid-quota.test.ts` | 11 | Cuota no reutilizable, `429` sin fila |
| `tests/quotas.test.ts` | 9 | Fail-closed de cuotas, sujeto hasheado |
| `tests/evidence-upload-guard.test.ts` | 8 | Firmas, cuota antes del efecto |
| `tests/evidence-status.test.ts` | 25 | Ciclo de vida del dictamen según el tipo de evidencia, presupuesto vencido |

**Suite completa:** 32 archivos, 436 tests, 433 pasan y 3 se omiten
(`ai-smoke.live.test.ts`, que requiere credencial y puede facturar).

`npm run verify:release` verde: lint de secretos, typecheck, contract tests,
suite y build.

## 5. Archivos creados o modificados con motivo

### Nuevos (producto)

| Archivo | Motivo |
|---|---|
| `src/server/errors.ts` | Rompe el ciclo de imports que colgaba la suite |
| `src/server/derived.ts` | Módulo hoja para la regla de vigencia de derivados |
| `src/server/quotas.ts` | Cuotas fail-closed por RPC con sujeto hasheado |
| `src/server/auth.ts` | Sesión por cookie `httpOnly`, verificación remota, roles |
| `src/server/dashboard.human.ts` | Métricas de revisión humana |
| `src/skills/sanitize.ts` | Cercado mecánico de contenido no confiable |
| `api/auth/[action].ts` | Login, logout y rotación (una Function para `session` + `refresh`) |
| `api/dashboard/[view].ts` | Las cuatro vistas del dashboard (una Function) |
| `src/components/LoginScreen.tsx`, `src/lib/useSession.ts` | Login en la SPA |
| `migrations/2026100*.sql` (4) | Membership, cuotas, derivados, nombre del revisor |
| `.github/**` | CI, Dependabot, plantillas de issue y PR |
| `docs/AUDIT_PIPELINE.md`, `DATABASE.md`, `DEPLOYMENT.md`, `TROUBLESHOOTING.md` | Documentación operativa que faltaba |
| `SECURITY.md`, `CONTRIBUTING.md` | Requisitos para un proyecto público |
| `tests/*.test.ts` (5 nuevos), `tests/helpers/*` | Regresiones de seguridad |

### Modificados (producto)

| Archivo | Motivo |
|---|---|
| `src/server/http.ts` | Guards de sesión y CSRF en `handleRoute` |
| `src/server/evidence-prep.ts` | `verifyFileSignature` |
| `src/server/audit-service.ts` | Fingerprint canónico, caché de derivados, cuota |
| `src/server/comparison-service.ts` | Cuotas y `userId` desde la sesión |
| `src/server/cases.ts` | `getScopedCaseOr404`, `assertCaseOwner`, persistencia de derivados |
| `src/server/assemblyai.ts` | Timeout con `AbortController` |
| `api/cases/[caseId]/evidence/*` | Orden firma → cuota → Storage → insert |
| `api/**` (12 handlers) | Scoping por dueño |
| `src/skills/audit/{instructions,execute}.ts` | Encabezado saneado, `wrapUntrusted` |

### Modificados (documentación)

`README.md` (API real, seguridad, DB, deploy, estructura), `AGENTS.md`
(invariantes y estructura), `PRODUCT.md`, `docs/architecture.md`,
`docs/PRODUCTION-RUNBOOK.md`, `docs/MIGRATION-PLAN.md`, `.env.example`,
`.gitignore`.

## 6. Pendientes que no se resuelven desde el código

### Bloqueantes para producción

1. **Aplicar las 8 migraciones.** Sin `20261002000000_auth_core.sql` no existe
   `app_memberships` y **toda** petición devuelve `403`.
2. **Poblar `app_memberships`.** Sin filas, la app no tiene usuarios utilizables.
3. **Política de Storage owner-scoped.** La app valida el dueño, pero el bucket no.
   Con la política por defecto, conocer la ruta basta para descargar.
4. **Rotar el secreto `sk-…`** del commit `569d8ca`. Borrarlo del archivo no lo
   saca del historial. **Alta.**
5. **Backfill de los casos con `created_by IS NULL`** (~16). Bajo RLS son
   invisibles: existen pero nadie los ve.

### Para abrir el proyecto

6. **`LICENSE`.** Sin licencia, "open source" no es cierto legalmente.
7. **El procedimiento no es reconstruible desde el repo.** `policy/` sí está
   versionado (manifest, `_header.md` y las 26 secciones `.md`), pero el
   `.docx.pdf` binario no: `normative/` está en `.gitignore` y su SHA-256 queda
   registrado en `policy/manifest.json` como referencia normativa. Sin el PDF
   fuente, `npm run policy:generate` funciona pero nadie puede verificar que las
   secciones deserializadas correspondan al documento oficial. Hay que declararlo
   explícitamente en el README.
8. **Purgar las ramas `archive/*`.**
9. **`vitest` 2 → 4.1.11+.** Major sin aplicar, y con una corrección de
   seguridad CRITICAL detrás. Ver §6 bis: el fix no está en 3.x.

### Opcionales

10. **`AI_MAX_OUTPUT_TOKENS`**: comprobado y **no** es un problema. Tiene default
    `16_384`, que coincide exactamente con el `safeOutputLimit` de los dos perfiles
    soportados (`google`, `openai`). Pedir más que el tope de la aplicación falla
    con un error claro en `resolveOutputTokenBudget`, sin contactar al proveedor.
11. **`AI_MAX_OUTPUT_TOKENS_CONFIGURED` es un campo muerto.** Se calcula en
    `env.ts` y se declara en `ServerEnv`, pero nadie lo lee:
    `resolveOutputTokenBudget` lo recibe en la firma y lo ignora. Sugiere un
    comportamiento ("si el operador no configuró el presupuesto, haz algo
    distinto") que no existe. **No se cambió**: definir ese comportamiento sería
    inventar funcionalidad. Decidir entre borrarlo o darle uso.
12. Reescritura de historia para eliminar el secreto del historial (opcional; la
    rotación ya es obligatoria).

## 6 bis. Hallazgos de dependencias (`osv-scanner` sobre `package-lock.json`)

Escaneo ejecutado. **3 paquetes con advisories. Ninguno es explotable con la
configuración actual del repo**, pero dos requieren actualización.

| Paquete | Versión | Advisory | Severidad cvss | ¿Aplica aquí? |
|---|---|---|---|---|
| `vitest` (dev) | 2.1.9 | `GHSA-5xrq-8626-4rwp` | **9.8 CRITICAL** | **No** |
| `vitest` (dev) | 2.1.9 | `GHSA-82fw-gwwq-j7x9` | 5.9 MODERATE | **No** |
| `vite` (dev, transitiva de vitest) | 5.4.21 | `GHSA-fx2h-pf6j-xcff` | 8.2 HIGH | **No** |
| `vite` (dev, transitiva de vitest) | 5.4.21 | `GHSA-4w7w-66w2-5vf9` | 6.3 MODERATE | **No** |
| `vite` (dev, transitiva de vitest) | 5.4.21 | `GHSA-v6wh-96g9-6wx3` | 5.5 MODERATE | **No** |
| `undici` (prod, vía `@vercel/node@3.2.29`) | 5.29.0 | 11 advisories | 3 HIGH, resto MODERATE/LOW | **Parcial** |

### Por qué no son explotables hoy

- **`vitest` CRITICAL (lectura y ejecución arbitraria de archivos en Windows).**
  Requiere que la UI o el API server de Vitest estén **escuchando en la red**.
  `vitest.config.ts` no configura `api.host` y `npm test` corre `vitest run`, que
  no levanta la UI. El puerto no se abre.
- **`vite` (la del finding es 5.4.21, transitiva de vitest, no la de la app).**
  La app usa `vite@6.4.3`. El advisory exige exponer el dev server a la red con
  `--host` o `server.host`; `vite.config.ts` no lo hace, y `AGENTS.md` lo
  prohíbe explícitamente. El bypass por `::$DATA` es específico de NTFS, pero solo
  aplica si el servidor escucha fuera de `localhost`.
- **`undici`**: la app no usa WebSocket, no pasa `upgrade`, no construye blobs
  duck-typed y no reenvía `Set-Cookie` parseados a respuestas propias, que es lo
  que explotan las advisories de undici. Sí usa `fetch` nativo contra OpenRouter y
  AssemblyAI, lo que deja expuesta la cadena de descompresión sin límite
  (`GHSA-g9mf-h72j-4rw9`): solo un proveedor comprometido o malicioso podría
  agotar memoria.

### Qué hacer

1. **`vitest` 2.1.9 → 4.1.11 o superior.** Corrección del CRITICAL y del
   path-traversal. Ojo: **el fix no está en 3.x**; `vitest` 2.x y 3.x no se
   mantienen. Esto es un major con cambios de configuración y requiere revisar la
   suite, no un bump automático.
2. **`@vercel/node` actualizado**, que es la vía para subir `undici` fuera de 5.29.
   Major/minor de tooling; revisar de nuevo con `osv-scanner`.

Mientras el dev server y el runner de tests no se expongan a la red, ninguno de
estos hallazgos es una vía de ataque real contra la aplicación en producción.

## 7. Cómo reproducir la verificación

```bash
npm run verify:release
```

Cubierto:

- `npm run lint:secrets` — ninguna credencial llega al bundle del navegador.
- `npm run typecheck` — TypeScript estricto.
- `npm run test:contract` — contratos de OpenRouter, capabilities, schema y
  validación de referencias.
- `npm test` — 435 tests.
- `npm run build` — `tsc` + `vite build`.

Opcional, facturable:

```bash
npm run test:ai-smoke          # contra OpenRouter, con coste
npm run test:ai-smoke:preview  # sin facturar
```