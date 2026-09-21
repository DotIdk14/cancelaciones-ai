# InsForge

## Proyecto vinculado

- Proyecto: `Cancelaciones`
- API base: `https://4pw4jdzv.us-west.insforge.app`
- Archivo local de CLI: `.insforge/project.json` fuera de Git.

## Variables necesarias

- `NEXT_PUBLIC_INSFORGE_URL`: publica, URL base del proyecto.
- `NEXT_PUBLIC_INSFORGE_ANON_KEY`: publica en cliente autenticado, anon key del proyecto.
- `NEXT_PUBLIC_APP_URL`: publica, origen de la app para callbacks.

## Variables privadas

La API key/admin key queda exclusivamente en `.insforge/project.json` para CLI o en secretos server-side si se requiere en fases posteriores. No debe exponerse como `NEXT_PUBLIC_*`.

## Validacion ejecutada en Phase 1

- Proyecto vinculado con CLI.
- Migracion `phase-1-base-schema` creada y aplicada.
- Lectura DB validada con `SELECT` sobre `public.audits`.
- Escritura DB validada con un registro sintetico y rollback.
- Storage inspeccionado via CLI y bucket privado existente `dictamen-evidencias` validado como baseline.

## Comandos utiles

```bash
npx -y @insforge/cli current --json
npx -y @insforge/cli secrets get ANON_KEY
npx -y @insforge/cli db migrations up --all
npx -y @insforge/cli storage buckets
```
