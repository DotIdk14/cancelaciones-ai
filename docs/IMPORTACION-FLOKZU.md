# Importación diaria de tickets de Flokzu

La opción **Importar tickets** está disponible solo para Coordinadores. El endpoint vuelve a comprobar la capacidad en el servidor, aunque alguien intente invocarlo fuera de la interfaz.

## Preparar el Excel

1. Desde Flokzu, exporta a Excel la vista de tickets CaVe que usa el equipo para la carga diaria.
2. Conserva la primera fila de metadatos, los encabezados en la segunda fila y los datos desde la tercera. El libro debe conservar una sola hoja y los nombres de columna de la exportación.
3. Revisa que existan `Identificador`, `Matricula (CaVe)` y `Nombre del estudiante (CaVe)`. Si falta alguno, la vista previa se rechaza antes de crear el batch.
4. Conserva las matrículas como texto para mantener ceros iniciales. No cambies el identificador CaVe por una matrícula.
5. En la aplicación, abre `#/importacion-tickets`, selecciona o arrastra el `.xlsx`, revisa conteos, filas con error y reparto propuesto; confirma solo cuando el resumen sea correcto.

El parser identifica campos por encabezado; no depende de posiciones fijas. Normaliza mayúsculas, acentos y espacios, mantiene los sufijos distintivos como `. (CaVe)` y rechaza encabezados ambiguos en campos conocidos. La cadena `99` y el número `99` se tratan como dato ausente. Las fechas `DD/MM/YYYY`, ISO y las fechas de Excel válidas se guardan como `YYYY-MM-DD`.

El libro de referencia analizado tiene una hoja, 92 columnas, metadatos en la fila 1 y 185 tickets desde la fila 3. Los 185 identificadores CaVe son válidos; se encontraron 181 matrículas distintas y cuatro matrículas repetidas asociadas a identificadores CaVe diferentes. La prueba versionada usa los encabezados extraídos y valores sintéticos: el Excel real no se guarda en Git porque contiene datos personales.

## Campos almacenados

`cases.student_identifier` y `cases.student_name` conservan matrícula y nombre. `cases.external_source = 'FLOKZU'` junto con `cases.external_case_id` forma la clave externa única. `cases.flokzu_data` guarda la última proyección administrativa:

- **Académico:** campus, universidad, país reportado explícitamente por nombres de campus conocidos, programa, nivel, bloque, clave de programa y fecha de ingreso.
- **Procedimiento:** política reportada, motivo, descripción, fecha de solicitud y `Fecha Inicio` administrativa de Flokzu.
- **Operación:** tarea actual, estado y finalización reportados, agente revisor, supervisor, iniciador y área solicitante.
- **Referencias:** acceso al aula, documentos, intentos de contactación, no calificación, no continuidad, seguimiento, fecha de inicio, pago SIU, evidencia UVE, registro de contacto, llamadas y tipo de evidencia.

`countryReported` no cambia `cases.country`: el país de origen del dictamen sigue viniendo del assessment de auditoría con evidencia. Si el campus no nombra explícitamente un país conocido, el dato académico queda `null`. La fecha administrativa de Flokzu nunca rellena `cycle_start_date`, que requiere evidencia o captura humana. Los estados y las resoluciones reportados por Flokzu se muestran como contexto; no se convierten en resultado de auditoría.

### Encabezados fuente que se leen

Los tres encabezados requeridos son `Identificador`, `Matricula (CaVe)` y `Nombre del estudiante (CaVe)`. Los demás se leen si están presentes; su ausencia produce `null` o una lista vacía:

| Destino en `flokzu_data` | Encabezados exactos de la exportación |
| --- | --- |
| `academic` | `Campus (CaVe)`, `Universidad. (CaVe)`, `Programa (CaVe)`, `Nivel (CaVe)`, `Bloque (CaVe)`, `Clave de Programa (CaVe)`, `Fecha de ingreso (CaVe)` |
| `procedure` | `Política que aplica (CaVe)`, `Motivo (CaVe)`, `Descripción (CaVe)`, `Fecha de solicitud (CaVe)`, `Fecha Inicio` |
| `operations` | `Tarea Actual`, `Estado (CaVe)`, `Finalizado`, `Agente revisor CV (CaVe)`, `Supervisor (CaVe)`, `Iniciador`, `Área del solicitante (CaVe)` |
| `evidenceReferences` | `Evidencia acceso al aula (CaVe)`, `Evidencia de documentos (CaVe)`, `Evidencia de intentos de contactación (CaVe)`, `Evidencia de no calificación (CaVe)`, `Evidencia de no continuar (CaVe)`, `Evidencia de seguimiento (CaVe)`, `Evidencia fecha de inicio (CaVe)`, `Evidencia pago en SIU (CaVe)`, `Evidencia UVE. (CaVe)`, `Registro de contacto (CaVe)`, `Llamada asesor de ventas (CaVe)`, `Llamada tutor (CaVe)`, `Tipo de evidencias (CaVe)` |

La comparación para reimportar incluye únicamente matrícula, nombre y toda la proyección administrativa anterior. Otras columnas exportadas no se guardan ni se sincronizan.

Los nombres incluidos en las columnas de evidencia son referencias reportadas, no archivos cargados. Se muestran separados de `evidence`; no se crean objetos en Storage ni evidencias ficticias. No se sincronizan correos personales ni columnas libres que no sean parte del contrato anterior.

## Sincronización, asignación y privacidad

- CaVe + `FLOKZU` hace idempotente la importación. Una segunda carga igual cuenta como sin cambios; una carga con diferencias actualiza solo matrícula, nombre y `flokzu_data`.
- La confirmación corre en una función SQL transaccional con un bloqueo compartido y clave única. Conserva el estado, creador, responsable, fecha de inicio humana, evidencias, auditorías, revisiones y comentarios existentes. Los casos nuevos empiezan en `DRAFT`.
- Solo los casos nuevos cuya `Tarea Actual` sea exactamente `[BACKOFFICE] [REVISION BO] [CV]` entran al reparto. Se consideran cuentas con membership activa de rol `user`, y se elige primero la menor cantidad de casos no completados; los empates se resuelven por UUID para mantener un reparto determinista. El sistema no tiene una capacidad numérica configurada por asesor, así que la carga pendiente es la medida disponible.
- HelpDesk, SER, cancelaciones por HelpDesk, Dictaminador y las demás etapas se importan sin asignación automática. Si no hay Asesores elegibles, el caso queda pendiente y el Coordinador puede reasignarlo desde esta página.
- `created_by` identifica al Coordinador que creó el registro y `assigned_to` al Asesor responsable. Los guardas permiten trabajar al Asesor asignado; la RLS no sustituye los controles server-side.
- La vista previa guarda temporalmente las filas válidas en `case_import_batches` para que la confirmación sobreviva a un reinicio. Vence en 24 horas; en la siguiente consulta de historial o nueva importación, un RPC borra su staging personal. Al confirmar, el staging se vacía de inmediato. Los errores guardan número de fila, CaVe y mensaje, no el contenido completo de la fila.
- El tamaño máximo es 4 MB para dejar margen al límite de 4.5 MB por petición de Vercel Functions.
- Importar no llama a OpenRouter, no inicia auditorías y no genera costos de IA.

## Migración y verificaciones

La migración incremental es `migrations/20261012100000_flokzu-case-import.sql`. Añade el identificador externo único, `assigned_to`, la proyección Flokzu, historial/staging aislado y RPCs disponibles solo para `project_admin`.

La migración quedó aplicada en staging y producción por el runner oficial de InsForge. El cierre del 12 de octubre de 2026 se registra en `docs/MIGRATION-RECONCILIATION.md`. Para cambios posteriores, seguir ese procedimiento y comprobar el ledger antes de aplicar una migración. La implementación mantiene los 12 archivos de `api/`; reutiliza `api/cases/index.ts` y `api/cases/[caseId]/index.ts` para permanecer dentro del límite Hobby.

Verificaciones de código:

```powershell
npm run typecheck
npx vitest run tests/flokzu-parser.test.ts tests/flokzu-assignment.test.ts tests/flokzu-import-route.test.ts tests/case-assignment-ownership.test.ts tests/role-capabilities.test.ts
npm test
npm run lint
npm run build
```
