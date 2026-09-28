# InsForge

> [!IMPORTANT]
> Documento reescrito para la arquitectura actual: **SPA React + Vite** con
> **Vercel Functions en `api/**`**. La versión anterior de este archivo
> describía una aplicación Next.js en un monorepo con su propio gestor de
> paquetes y con el bucket de Storage de la fase 1: todo eso ya no existe.
> Lee este documento en lugar del histórico si necesitas el setup vigente.

## Cómo está conectado el proyecto

- Proyecto InsForge: `Cancelaciones`
- API base: `https://4pw4jdzv.us-west.insforge.app`
- La app **nunca habla con InsForge desde el navegador**. InsForge es
  **solo server-side**: el cliente (SPA) llama a `/api/*` (Vercel Functions) y es
  el servidor, con `src/server/insforge.ts`, quien habla con InsForge. No hay
  SDK de InsForge en el bundle del navegador ni URL de InsForge embebida en el
  HTML.
- El setup de la infraestructura (base de datos, RLS, storage, secrets) se hace
  con la **CLI `insforge`**, no desde la aplicación ni desde un `.env` del
  cliente.
- Archivo local de la CLI: `.insforge/project.json` — **fuera de Git**, contiene
  las credenciales de administración.

## Variables de entorno (todas server-side)

Se leen todas en `src/server/env.ts`. Copiar `.env.example` a `.env.local`
(gitignored) y completar. Si falta una obligatoria, el servidor falla al
arrancar con `[env] Falta la variable de entorno <NOMBRE>`.

### Obligatorias

- `INSFORGE_BASE_URL=https://4pw4jdzv.us-west.insforge.app`
- `INSFORGE_ANON_KEY` — anon key del proyecto. Da acceso al rol `anon` y, con la
  cookie de sesión httpOnly, al rol `authenticated` (el que aplica la RLS por
  `created_by`).
- `INSFORGE_API_KEY` — clave administrativa usada por las funciones del
  servidor para operaciones privilegiadas.
- `OPENROUTER_API_KEY` y `OPENROUTER_MODEL` — el proveedor de IA del producto
  (fuera del alcance de este documento, pero se validan en el mismo arranque).

### Opcionales

- `INSFORGE_STORAGE_BUCKET` — bucket de Storage donde viven los binarios de las
  evidencias. **Default: `evidencias`** (único bucket del producto).

### Prohibidas

- Cualquier variable con prefijo `VITE_` o `NEXT_PUBLIC_`. Si aparece una, es un
  bug de diseño: sería una fuga de secreto al bundle del navegador.

## Base de datos y Storage

- El esquema es **una única migración baseline**:
  `migrations/00000000000000_baseline.sql` (3 tablas `cases`, `evidence`,
  `audits`; RLS por `created_by = auth.uid()`; trigger `set_updated_at` solo en
  `cases`). Se aplica sobre una base **vacía** de InsForge.
- Storage: bucket **único** `evidencias`. El path del objeto es
  `{caseId}/{uuid}-{sanitizedFilename}` — el nombre del archivo nunca controla la
  ruta. El bucket **no lo crea la aplicación**: se crea con la CLI de InsForge.
- Toda variable sensible vive **solo en el servidor**: no hay secretos en el
  repositorio ni en el cliente.

## Comandos útiles de la CLI

```bash
# Ver el proyecto vinculado y su estado
insforge current --json

# Listar buckets de Storage
insforge storage buckets

# Aplicar migraciones de la DB
insforge db migrations up --all

# Inspeccionar/leer secrets del proyecto
insforge secrets list
insforge secrets get ANON_KEY
```

Consulta las skills de la CLI (`insforge-cli`) para el detalle de cada comando.
