# Seguridad

Este documento describe el modelo de seguridad de Cancelaciones AI: qué se
confía, qué no, dónde están las barreras y qué está pendiente fuera del código.

`NO VERIFICADO` significa que no comprobamos el estado real del entorno. Un
punto marcado así es un pendiente operativo, no una garantía.

---

## 1. Modelo de confianza

```text
Navegador (no confiable)
   │  fetch a /api/*, cookies httpOnly, sin claves
   ▼
Vercel Functions (frontera server-side)   ← TODA la validación ocurre aquí
   │
   ├──► InsForge  (Postgres + Storage + auth)   ← solo server-side, service_role
   ├──► OpenRouter (única IA)                    ← server-side
   └──► AssemblyAI  (solo transcripción)         ← server-side
```

- El navegador **nunca** habla con InsForge, OpenRouter ni AssemblyAI.
- No existe ninguna variable de entorno con prefijo `VITE_` o `NEXT_PUBLIC_`.
  `npm run lint:secrets` falla si alguien introduce una.
- Toda validación se repite en el servidor. El cliente es una vista, nunca una
  frontera.

## 2. Identidad y sesión

| Propiedad | Implementación |
|---|---|
| Transporte | Cookies `HttpOnly; Secure; SameSite=Lax; Path=/` |
| Access token | **Nunca** se decodifica en el servidor. `auth.getCurrentUser()` contra InsForge |
| Refresh | `POST /api/auth/refresh`, rota el access token; si falla, limpia cookies |
| Sesión ausente o inválida | `401 UNAUTHENTICATED` — **fail-closed** |
| Sesión válida sin membership | `403 AUTH_ERROR` |
| Proveedor de identidad caído | `503 PROVIDER_UNAVAILABLE` — **nunca** anónimo |
| Rol desconocido en `app_memberships` | `403` (se trata como "sin permiso") |

**No hay sign-up.** Los usuarios se crean en InsForge y el acceso se autoriza
insertando una fila en `app_memberships` (`user_id` PK, `role` en
`user` \| `coordinator`). Una cuenta de InsForge sin fila no ve nada de la app.

**Por qué `404` y no `403` en un caso ajeno:** `assertCaseOwner` y
`getScopedCaseOr404` devuelven `404 NOT_FOUND`. Un `403` confirmaría que el
identificador existe, lo que convierte la API en un oráculo de enumeración de
identificadores. El usuario ve el mismo resultado exista o no el caso.

## 3. CSRF

Todo método mutante (`POST`, `PUT`, `PATCH`, `DELETE`) exige **ambas** condiciones:

1. `Origin` igual a `APP_URL`.
2. Header `X-App-Request: 1`.

La segunda condición no es un segundo factor de seguridad: es una marca explícita
de "esto es una petición de la aplicación", para que un `curl` o un `fetch`
cruzado sin `Origin` no se confused con tráfico de la SPA. Aplicar Origin sin
esta marca hace que `same-origin` mal interpretado degrade a "sin verificar".

## 4. Entrada no confiable (evidencias)

Orden de operaciones al subir — **el orden importa**:

```text
1. auth + ownership            → 404 si el caso no es del usuario
2. método + cuerpo + tamaño    → 413 si excede MAX_EVIDENCE_BYTES
3. MIME declarado              → 400 si no está en la lista blanca
4. FIRMA REAL (magic bytes)    → 415 si el contenido no corresponde al MIME
5. cuota pagada                → 429 ANTES de tocar Storage
6. subida a Storage            → si falla, no hay fila
7. insert de evidence          → updateCaseStatus propaga su fallo
```

Puntos donde un orden mal pensado deja basura o allowía bypass:

- **Firma antes de la cuota y del Storage.** Validar el contenido después de
  subir deja un objeto no referenciado en el bucket por cada intento fallido.
- **Cuota antes del Storage.** Al revés, un `429` deja bytes huérfanos y, en el
  caso del audio, una fila `UPLOADED` que bloquea la auditoría para siempre.
- **`updateCaseStatus` no se traga errores.** Si la subida tiene éxito y el
  update de estado falla, el caso queda `DRAFT` con evidencia utilizable; callar
  ese error devolvería `201` con un estado inconsistente.
- **`deleteEvidence` propaga el fallo de Storage.** Si el objeto no se borra,
  se responde error y se conserva la fila: es preferible una evidencia visible
  que un objeto vivo sin dueño.

### Lista blanca de MIME y firmas aceptadas

| MIME | Firma que deben tener los primeros bytes |
|---|---|
| `application/pdf` | `%PDF-` |
| `image/png` | `\x89PNG\r\n\x1a\n` |
| `image/jpeg` | `\xFF\xD8\xFF` |
| `image/gif` | `GIF87a` \| `GIF89a` |
| `image/webp` | `RIFF….WEBP` |
| `audio/mpeg` | `ID3` **o** frame sync `0xFFEx/0xFFFx` |
| `audio/wav` | `RIFF….WAVE` |
| `audio/mp4`, `audio/m4a`, `audio/x-m4a` | `….ftyp` |
| `audio/ogg`, `audio/opus` | `OggS` |
| `audio/webm` | `\x1A\x45\xDF\xA3` |
| `text/plain` | rechaza prefijos de binario: `PK`, `MZ`, `\x7fELF`, `#!`, `<!DO`, bytes nulos |

El MIME declarado lo elige el cliente, así que por sí solo no prueba nada. Sin la
firma real, un `.exe` o un `.pdf` malicioso renaming a `.txt` entra al expediente
como "texto" y de ahí al prompt.

## 5. Prompt injection

Las evidencias son **datos**, nunca instrucciones. Hay tres capas:

1. **Instrucción explícita** en el system prompt
   (`EVIDENCE_IS_DATA_NOT_INSTRUCTIONS`): el contenido del expediente no puede
   reescribir el rol, el schema ni las clasificaciones.
2. **Cercado mecánico** (`src/skills/sanitize.ts`):
   `sanitizeTagDelimiters` neutraliza cualquier etiqueta de cierre que simule
   cerrar un bloque del prompt, `sanitizeFenceDelimiters` impide que una cerca
   de código ``` termine la región de contenido, y `wrapUntrusted` /
   `wrapUntrustedInline` delimitan la región no confiable con marcadores que el
   contenido no puede producir.
3. **El nombre del archivo también es contenido no confiable** y se sanea antes
   de aparecer en el encabezado `## Evidencia: <nombre>`. Un nombre de archivo es
   un vector tan válido como el cuerpo.

La instrucción (capa 1) depende del modelo; el cercado (capa 2) depende del
código. Solo la segunda se puede probar. Ambos son necesarios.

**La salida se valida contra un schema Zod `strict` y se comprueban las
referencias** a evidencia y sección del procedimiento: una respuesta que cita una
evidencia inexistente se rechaza (`INVALID_AI_RESPONSE`) en lugar de pasar a
formar parte del dictamen.

## 6. Cuotas

- Implementadas en la función SQL `admit_or_reject_quota`, con
  `pg_advisory_xact_lock` y ventanas móviles en PostgreSQL. **No** hay contadores
  en memoria de proceso (`NO_PROCESS_LOCAL_DURABILITY`).
- El sujeto (correo, IP, `user_id`) se hashea con HMAC-SHA256
  (`QUOTA_HMAC_KEY`) antes de persistirse. La base nunca ve la IP ni el correo.
- **Fail-closed con la semántica correcta:** si la RPC falla, devuelve una fila
  malformada o `admitted` no es un booleano, la respuesta es **503**, no 429.
  Traducir "no pude preguntar" como "te pasaste" genera un 429 falso que oculta
  una caída de infraestructura y hace esperar al usuario en vano.
- Cuotas activas: 5/correo/15 min y 10/IP/15 min para login; cuota pagada para
  auditoría, comparación y transcripción.

> **Acoplamiento a vigilar.** Si `QUOTA_HMAC_KEY` no está definida,
> `quotaHmacKey()` usa `INSFORGE_API_KEY`. Funciona, pero implica que **rotar la
> clave de InsForge invalida en silencio todo el historial de cuotas**: los hashes
> viejos dejan de coincidir con los nuevos y los contadores se reinician. Para
> despliegue en producción conviene definir una clave propia.

## 7. Datos y privacidad

- `cases.student_identifier` es PII: se guarda porque la auditoría lo necesita y
  **no aparece en ningún `INSERT` del repositorio** (`NO_PII_IN_GIT`).
- El diagnóstico de IA guarda modelo, formato, status, códigos saneados, latencia,
  tokens, coste y categoría. **No** guarda prompt, archivos ni PII.
- Los errores al cliente nunca exponen stack traces. Los mensajes del proveedor se
  sanean (`api_key`, `secret`, `token`, `authorization`) y se truncan a 300
  caracteres.
- Los originales nunca se modifican: todo derivado conserva hash y origen
  (`PRESERVE_EVIDENCE_PROVENANCE`).

## 8. Supply chain y CI

- `npm run lint:secrets` en `prebuild` y en `verify:release`: falla si una
  credencial llega al bundle del navegador o a un archivo versionado.
- CI (`.github/workflows/ci.yml`): `npm ci` → `verify:release` (lint de secretos,
  typecheck, contract tests, suite completa, build).
- Dependabot configurado para `npm` y GitHub Actions.
- Los tests unitarios **no** hacen llamadas pagadas a OpenRouter. El smoke live
  (`npm run test:ai-smoke`) es un gate manual aparte.

## 9. Pendientes operativos

Estos puntos no se resuelven desde el repositorio. Marcados `NO VERIFICADO`
porque el estado del entorno no se comprobó.

| # | Acción | Por qué importa | Prioridad |
|---|---|---|---|
| 1 | Aplicar las 8 migraciones posteriores al baseline | Sin `20261002000000_auth_core.sql` no existe `app_memberships` y **todos** los usuarios reciben 403 | **Alta** |
| 2 | Poblar `app_memberships` | Sin fila no hay acceso. Una app sin usuarios utilizables | **Alta** |
| 3 | Aplicar política de Storage **owner-scoped** | Con la política por defecto, conocer la ruta del objeto basta para descargarlo. La app sí valida el dueño, pero el bucket no | **Alta** |
| 4 | Backfill de los casos con `created_by IS NULL` | Bajo RLS son invisibles: el caso existe pero nadie lo ve | Alta |
| 5 | Rotar el secreto `sk-…` del historial (commit `569d8ca`) | Sigue en el historial Git aunque se borrara del archivo | **Alta** |
| 6 | Ejecutar `scripts/verify-rls-grants.sql` y confirmar que no reporta desviaciones | Detecta superficie de lectura anónima o privilegios de más | Alta |
| 7 | Purgar las ramas `archive/*` | Publican código y posible material interno fuera del flujo mantenido | Media |
| 8 | Decidir `LICENSE` | Sin licencia, "open source" no es cierto legalmente | Media |
| 9 | Declarar que el PDF fuente del procedimiento no está versionado | `policy/` versiona las 26 secciones, no el `.docx.pdf`. El SHA-256 permite verificar que no cambió, no reconstruirlo. Ya está documentado en el README; falta decidir si es aceptable para publicar | Media |
| 10 | `vitest` 2 → 4.1.11+ | CRITICAL de lectura/ejecución arbitraria en Windows, **no explotable hoy** (la UI no se levanta) pero sin fix en 3.x. Detalle en `docs/REPOSITORY_AUDIT.md` §6 bis | Media |
| 11 | `@vercel/node` actualizado | Es la vía para subir `undici` fuera de 5.29.0 (11 advisories). Ninguna explotable con el código actual | Baja |

Sobre el punto 5: eliminar el archivo del árbol **no** elimina el secreto del
historial. La rotación es obligatoria; reescribir la historia es opcional y
decisión del owner.

## 10. Reportar una vulnerabilidad

No abras un issue público para una vulnerabilidad sin corregir. Escribe a
privado al owner describiendo:

1. Qué superficie afecta (endpoint, componente, migración).
2. Pasos exactos para reproducir.
3. Impacto: qué obtiene o cambia quien lo explota, y qué necesita para empezar.
4. Si hay una corrección conocida, inclúyela.

El issue tracker público queda para bugs no sensibles y para discusión de
funcionalidad.