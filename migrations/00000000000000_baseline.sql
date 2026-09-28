-- =============================================================================
-- 00000000000000_baseline.sql — LÍNEA BASE ÚNICA DEL ESQUEMA AI-NATIVE
-- =============================================================================
--
-- QUÉ ES ESTE ARCHIVO
--   Es el ÚNICO esquema del producto. Una instalación limpia es:
--
--       psql -v ON_ERROR_STOP=1 -f 00000000000000_baseline.sql
--
--   Aplicable sobre una base VACÍA de InsForge (PostgreSQL). Lo único que se
--   asume ya existente, y que aporta la plataforma, es:
--     - el esquema `auth` con la tabla `auth.users(id)` y la función `auth.uid()`;
--     - los roles `anon`, `authenticated` y `service_role`.
--   Nada más. Este archivo no depende de ninguna otra migración y no importa
--   ningún archivo del repositorio.
--
-- POR QUÉ `-v ON_ERROR_STOP=1` Y NO SÓLO `-f`
--   La sección 5 (VERIFICACIÓN) falla con RAISE EXCEPTION cuando el esquema no
--   queda como este archivo describe. Sin ON_ERROR_STOP, `psql` imprime ese
--   error y CONTINÚA con las sentencias siguientes, y el script termina con
--   código de salida 0: una migración fallida parecería exitosa, que es peor
--   que no verificar. Con ON_ERROR_STOP=1 el script aborta en el primer error.
--   Deliberadamente NO se mete aquí un `\set ON_ERROR_STOP on`: sería un
--   meta-comando de psql y este archivo tiene que seguir siendo SQL puro,
--   legible por cualquier ejecutor (CLI de InsForge, runner propio, CI). El
--   abortar-al-primer-error es responsabilidad de quien lo invoca.
--
-- DIRECCIÓN
--   forward-only y SIN BEGIN/COMMIT (el runner envuelve el archivo en su propia
--   transacción, y así se puede abortar sin dejar DDL a medias). Re-ejecutarlo
--   es seguro: todo es idempotente (CREATE ... IF NOT EXISTS, DROP ... IF
--   EXISTS, REVOKE, GRANT, CREATE OR REPLACE FUNCTION).
--
-- -----------------------------------------------------------------------------
-- POR QUÉ ESTE ARCHIVO SUSTITUYE AL ESQUEMA LEGACY DE 12 TABLAS
-- -----------------------------------------------------------------------------
-- La versión anterior de este repositorio llevaba un motor normativo entero en
-- tablas (37 migraciones, ~250 KB de SQL):
--
--     profiles, audits, audit_log, audit_manual_comments, evidences,
--     jobs, job_attempts, job_artifacts, audit_runs, tool_executions,
--     audit_results, ai_call_log
--
-- más las capas todavía más antiguas: facts, rules, rule_conditions,
-- engine_runs, fact_runs, policy_sources, tickets, ai_usage, generated_pdfs,
-- dictamen_documents, audit_comparisons, transcript_segments, ...
--
-- Todo eso desaparece. No por cantidad, sino porque el producto es AI-native y
-- el AGENTS.md lo dice sin ambigüedad:
--
--   - La base GUARDA datos y archivos. NO DECIDE negocio. No hay policy engine,
--     ni rules engine, ni evaluación de reglas ejecutable, ni cola de jobs, ni
--     runs, ni tool_executions, ni ai_call_log. El criterio lo aplica el
--     agente leyendo la fuente oficial que entrega el propietario; una segunda
--     implementación del mismo criterio en SQL sería un segundo juez que nadie
--     puede auditar contra la fuente oficial.
--   - Lo único que la base tiene que saber del dictamen es que existe y qué
--     terminó: el resultado completo, validado, vive en
--     `audits.result_json` (JSONB). Una sola fuente de verdad, validada con
--     Zod en la aplicación contra `AuditResultSchema`
--     (src/skills/audit/schema.ts). Nada de
--     columnas por etapa, nada de bitácora de tools, nada de coste por llamada.
--   - NO_PROCESS_LOCAL_DURABILITY y NO_RULES_ENGINE se cumplen por
--     construcción: no hay nada en la base que pueda quedar esperando a que
--     alguien lo reclame, barrasse o reintente.
--
-- CONSECUENCIA PRÁCTICA
--   Tres tablas. Doce políticas RLS. Una función (updated_at). Si el próximo
--   esquema necesita una tabla más, es porque el producto cambió de forma de
--   guardar o de calcular, y eso se discute antes de escribir SQL, no después.
--
-- -----------------------------------------------------------------------------
-- LAS 3 TABLAS Y QUIÉN ES LA FUENTE DE VERDAD
-- -----------------------------------------------------------------------------
--   1. public.cases     — el expediente. Quién lo creó (dueño a efectos de
--                         RLS), en qué punto del ciclo de vida está y el
--                         identificador del alumno que aporta el usuario.
--   2. public.evidence  — los archivos del expediente: metadatos, hash,
--                         key en Storage y, si hubo audio, la transcripción.
--   3. public.audits    — los intentos de auditoría. UNA fila por ejecución;
--                         `result_json` es el dictamen validado y la ÚNICA
--                         fuente de verdad del resultado.
--
-- EL CICLO DE VIDA DEL CASO, Y POR QUÉ `cases.status` NO TIENE NEEDS_INPUT
--   DRAFT -> READY -> AUDITING -> COMPLETED | ERROR
--
--   NEEDS_INPUT no es un estado del caso: es un RESULTADO del dictamen, y los
--   resultados viven en `audits.result_json` (regla del producto: no se usa
--   INDETERMINADO como resultado normal; se usa NEEDS_INPUT con la evidencia
--   faltante accionable). Contrato con la aplicación:
--     - run que termina en COMPLETED      -> caso COMPLETED.
--     - run que termina en NEEDS_INPUT    -> caso COMPLETED, con el motivo y la
--                                            evidencia faltante en result_json.
--     - run que termina en ERROR          -> caso ERROR, con error_category.
--   O sea: un caso nunca queda en un limbo, y un caso en COMPLETED no significa
--   necesariamente "el alumno cumple", sino "la auditoría se terminó". Qué
--   decidió la auditoría se pregunta a result_json, nunca a cases.status.
--
-- -----------------------------------------------------------------------------
-- LOS ARCHIVOS NO ESTÁN EN ESTE SQL
-- -----------------------------------------------------------------------------
--   El binario vive en InsForge Storage, y el bucket NO se crea desde aquí
--   (se crea con la CLI de InsForge, que es quien administra la infraestructura
--   de la plataforma):
--
--       bucket: evidencias
--       path:   {caseId}/{uuid}-{sanitizedFilename}
--
--   En la base sólo se guarda la `key` (columna `storage_path`) y el resto de
--   metadatos. El path incluye el caseId y un UUID, y el nombre va saneado por
--   la aplicación: dos cargas del mismo nombre en casos distintos nunca
--   colisionan, y un nombre de archivo no controla la ruta.
--
-- -----------------------------------------------------------------------------
-- CERO PII EN GIT
-- -----------------------------------------------------------------------------
--   Este archivo no inserta datos. Ni de ejemplo, ni sintéticos, ni reales.
--   `cases.student_identifier` es un dato personal (identifica a un alumno): se
--   guarda porque la auditoría lo necesita para citarlo, y está protegido por
--   las políticas RLS de la sección 4, pero no aparece en ningún INSERT de este
--   repositorio. NO_PII_IN_GIT.
--
-- -----------------------------------------------------------------------------
-- ORDEN DE EJECUCIÓN
-- -----------------------------------------------------------------------------
--   0. Prerrequisitos (pgcrypto).
--   0.1. Guardia previa: si la base ya tiene el esquema retirado, se aborta
--       aquí, antes de tocar nada.
--   1. Las tres tablas y sus cuatro índices.
--   2. public.set_updated_at() y su disparador en cases.
--   3. RLS y privilegios de tabla (RLS, REVOKE, GRANT, REVOKE).
--   4. Las doce políticas.
--   5. Verificación: la migración falla AQUÍ, y no en un informe tres fases
--      después, si el esquema no quedó como este archivo acaba de describir.
-- =============================================================================


-- =============================================================================
-- SECCIÓN 0 — Prerrequisitos
-- =============================================================================

-- pgcrypto aporta gen_random_uuid() en PostgreSQL 12 y anteriores; a partir de
-- 13 es una función del catálogo, pero el IF NOT EXISTS no cuesta nada y deja
-- el archivo válido en ambos casos. El rol que ejecuta la migración necesita
-- permiso para crearla (en InsForge, el runner corre con el rol de
-- administración de la base).
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- -----------------------------------------------------------------------------
-- SECCIÓN 0.1 — Guardia previa: ¿esta base ya tiene el esquema retirado?
--
-- DECISIÓN DE DISEÑO, Y ES A PROPÓSITO: este archivo NO borra nada.
--
-- Si la base ya tiene el esquema legacy, migrarla automáticamente a este
-- archivo destruiría decenas de tablas con datos de producción sin bitácora,
-- sin copia y sin que nadie lo decidiera. Un DROP TABLE IF EXISTS silencioso es
-- exactamente el tipo de pérdida que no se puede deshacer. Por eso la base con
-- el esquema antiguo NO se convierte: se rechaza, con un mensaje que dice qué
-- hay que hacer (aplicar sobre una base vacía, o retirar el esquema antiguo de
-- forma explícita, documentada y con su propia copia de seguridad).
--
-- Se comprueba ANTES de crear nada, y no sólo al final, porque un fallo al
-- final dejaría una base a medio migrar; un fallo al principio no deja rastro.
--
-- `audits` NO está en la lista: ese nombre sobrevive en la línea base, así que
-- aquí no puede delatar una forma antigua. La forma antigua de `audits` la
-- detecta la verificación final (sección 5, control 1) por columnas: un
-- `CREATE TABLE IF NOT EXISTS` que encuentra una tabla vieja con otra forma es
-- un no-op silencioso, y eso es justo lo que hay que descartar.
-- -----------------------------------------------------------------------------
DO $baseline$
DECLARE
  v_leaked text;
BEGIN
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
    INTO v_leaked
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname = ANY (ARRAY[
      -- las 12 de la línea base anterior, salvo `audits` (nombre compartido)
      'profiles','evidences','audit_log','audit_manual_comments',
      'jobs','job_attempts','job_artifacts',
      'audit_runs','tool_executions','audit_results','ai_call_log',
      -- el motor normativo y sus capas
      'facts','fact_runs','fact_extraction_runs','fact_reviews',
      'fact_run_frozen_snapshots','canonical_facts','canonical_fact_runs',
      'canonical_fact_candidates','extracted_facts',
      'rules','rule_conditions','rule_evaluations',
      'engine_runs','engine_rule_results','evidence_requirements',
      'policy_sources','policy_source_registry','audit_temporal_context',
      'source_completeness',
      -- la capa de tickets, dictamen y comparación IA/humano
      'tickets','ticket_events','dictamen_documents','dictamen_versions',
      'generated_pdfs','report_snapshots','ai_usage','ai_decision_snapshots',
      'audit_comparisons','audit_evaluation_envelopes','final_adjudications',
      'human_decision_extracts','human_reviews','audit_evidence_selection',
      'provider_operations','speaker_assignments','transcript_segments',
      'decision_runs','audit_events','schema_baseline_v2_manifest'
    ]);

  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'AI_NATIVE_BASELINE_LEGACY_PRESENT: esta base ya tiene tablas del esquema retirado: %. Este archivo NO las borra (borrarlas destruiría datos sin copia ni bitácora). Aplíquelo sobre una base vacía, o retire el esquema antiguo de forma explícita y documentada antes de volver a aplicarlo.',
      v_leaked;
  END IF;
END
$baseline$;


-- =============================================================================
-- SECCIÓN 1 — Las tres tablas
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1.1 public.cases — el expediente.
--
-- `created_by` es NOT NULL, REFERENCES auth.users(id) y no tiene valor por
-- defecto: un caso sin autor no tiene dueño, y TODO el modelo de seguridad de
-- este archivo (las doce políticas) se apoya en que siempre lo tiene. No hay
-- tabla de perfiles ni de roles: el dueño es el creador, y nada más. Un perfil
-- aparte sería una segunda identidad que puede desincronizarse de auth.users.
--
-- ON DELETE CASCADE sobre created_by: si InsForge borra la cuenta, sus casos,
-- sus evidencias y sus auditorías caen con ella. Los datos personales no
-- sobreviven a la identidad que los originó, y no queda un expediente huérfano
-- que nadie puede atribuir ni borrar.
--
-- `student_identifier` es texto libre y NO tiene índice: se busca por
-- `created_by`, no por alumno. Indexar un dato personal convierte una
-- búsqueda del cliente en un punto de extracción de PII, y nadie lo necesita.
--
-- La validación de `status` la hace el CHECK de abajo (datos) y la máquina de
-- estados la aplica la aplicación (transiciones). En la base sólo se garantiza
-- que el valor esté en el vocabulario cerrado: qué transición es legal depende
-- del ciclo de vida descrito en la cabecera, que es de la aplicación.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.cases (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','READY','AUDITING','COMPLETED','ERROR')),
  student_identifier text,
  created_by uuid REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- El único índice de esta tabla, y hace las dos cosas: por un lado filtra por
-- dueño (created_by es el predicado de TODAS las políticas RLS), por otro
-- ordena el listado del cliente (created_at DESC). Un índice para las dos
-- consultas, no dos.
CREATE INDEX IF NOT EXISTS cases_created_by_created_at_idx
  ON public.cases (created_by, created_at DESC);

-- El COMMENT es documentación viva (lo que se ve con \d+ o en el inspector), y
-- por eso va envuelto en su propio bloque: COMMENT exige ser propietario de la
-- tabla, y un comentario no es un motivo para abortar una migración. Si el
-- runner no es el propietario, se pierde la nota y sigue todo lo demás.
DO $baseline$
BEGIN
  COMMENT ON TABLE public.cases IS
    'Expediente de cancelación. cases.status es el ciclo de vida del expediente; el resultado de la auditoría NO está aquí, está en audits.result_json.';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END
$baseline$;


-- -----------------------------------------------------------------------------
-- 1.2 public.evidence — los archivos del expediente.
--
-- El binario no está aquí: está en InsForge Storage, en el bucket `evidencias`,
-- con el path `{caseId}/{uuid}-{sanitizedFilename}`. El bucket se crea con la
-- CLI de InsForge, no con SQL. En la base queda la `storage_path` (la key del
-- objeto) y los metadatos que no cambian al processing.
--
-- NO HAY COLUMNA `kind`. El tipo del archivo (IMAGE, PDF, AUDIO, TEXT) se deriva
-- de `mime_type` en la aplicación. Guardar los dos sería duplicar el mismo dato
-- en dos sitios que pueden discrepar: un `kind` que dice PDF con un
-- `mime_type` de audio produce dos verdades y ningún winner, y el agente acaba
-- eligiendo por el campo que encuentra primero. Una fuente, una verdad.
--
-- `hash` es el SHA-256 en hexadecimal del binario, y `evidence_hash_idx` es un
-- índice NO ÚNICO a propósito: la deduplicación la decide la aplicación, que
-- además necesita poder volver a cargar el mismo archivo si el usuario cambió
-- de clasificación. Declararlo UNIQUE convertiría una decisión de aplicación
-- en un 23505 opaco en el momento del upload. El índice sirve para
-- "calculemos este mismo archivo otra vez" (DO_NOT_REPROCESS_AI_UNNECESSARILY),
-- que es una consulta, no una restricción.
--
-- `transcript_json` es el resultado de la transcripción (AssemblyAI) cuando el
-- archivo es audio: { assemblyId?, status?, transcript, durationSeconds,
-- speakers[] }. Es JSONB y no columnas porque el contrato lo fija el proveedor y
-- su adapter, no la base; la aplicación lo construye en
-- src/server/assemblyai.ts y lo lee de forma defensiva en
-- src/server/evidence-prep.ts, contra el tipo TranscriptData declarado en
-- src/skills/audit/types.ts.
--
-- NO HAY `updated_at`: la evidencia es inmutable en su contenido. Subir el
-- mismo archivo otra vez es una fila nueva; la única mutación posible es
-- `processing_status` y `transcript_json` (UPLOADED -> TRANSCRIBING -> READY |
-- ERROR), que es una progresión del procesamiento, no un cambio de la evidencia.
-- `created_at` es por tanto la única marca de tiempo honesta de esta fila.
--
-- `size_bytes` y `mime_type` los valida la aplicación (Zod) en el upload; en la
-- base son NOT NULL porque una evidencia sin ellos no se puede ni citar ni
-- procesar, y una fila así no es recuperable con una simple actualización.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.evidence (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  filename text NOT NULL,
  mime_type text NOT NULL,
  size_bytes bigint NOT NULL,
  hash text NOT NULL,              -- SHA-256 hexadecimal del binario
  storage_path text NOT NULL,      -- key del objeto en InsForge Storage
  processing_status text NOT NULL DEFAULT 'UPLOADED'
    CHECK (processing_status IN ('UPLOADED','TRANSCRIBING','READY','ERROR')),
  transcript_json jsonb,           -- { assemblyId?, status?, transcript, durationSeconds, speakers[] }
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Índice para el expediente: listar y paginar las evidencias de un caso en
-- orden de carga. Coincide con el acceso real del cliente y con el orden en que
-- el agente las lee.
CREATE INDEX IF NOT EXISTS evidence_case_id_created_at_idx
  ON public.evidence (case_id, created_at DESC);

-- Índice para la consulta "¿esto ya estaba subido?": es lo que permite no
-- reprocesar un archivo idéntico. NO es UNIQUE, y no debe serlo.
CREATE INDEX IF NOT EXISTS evidence_hash_idx
  ON public.evidence (hash);

DO $baseline$
BEGIN
  COMMENT ON TABLE public.evidence IS
    'Archivos del expediente. El binario vive en InsForge Storage (bucket evidencias, path {caseId}/{uuid}-{sanitizedFilename}); aquí sólo la key y los metadatos. El tipo del archivo se deriva de mime_type en la aplicación, no hay columna kind.';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END
$baseline$;


-- -----------------------------------------------------------------------------
-- 1.3 public.audits — los intentos de auditoría. LA FUENTE DE VERDAD.
--
-- UNA fila por ejecución. `result_json` es el AuditResult validado con Zod
-- (assessment, revisión, clasificación final, secciones del procedimiento
-- citadas, evidencia faltante si la hay) y es la ÚNICA fuente de verdad del
-- resultado de la auditoría. Nada más en esta tabla duplica esa información,
-- y nada en el esquema la recalcula: no hay columnas por etapa, ni bitácora de
-- tools, ni conteo de pasos, ni coste por llamada. La traza vive DENTRO del
-- jsonb validado, donde el procedimiento puede exigirla y donde la aplicación
-- ya la muestra.
--
-- NO HAY UNIQUE SOBRE `case_id`, y es deliberado: un caso se puede re-auditar
-- (llega evidencia nueva, cambia el modelo, o simplemente hay que reintentar),
-- y una restricción de unicidad haría imposible re-auditar. El cliente lee la
-- fila más reciente: `audits_case_id_created_at_idx` es exactamente el índice
-- que sostiene esa lectura, con created_at DESC.
--
-- `status` es el resultado técnico de la ejecución (RUNNING -> COMPLETED |
-- ERROR) y NO el veredicto: una ejecución que termina bien puede haber
-- concluido NEEDS_INPUT, y eso se lee en result_json, no aquí. `error_category`
-- es texto porque su vocabulario lo fija la aplicación y no este archivo. Las
-- diez categorías de `ERROR_CATEGORIES` (src/skills/audit/types.ts) son:
-- 'UPLOAD_ERROR' | 'TRANSCRIPTION_ERROR' | 'AI_PROVIDER_ERROR' |
-- 'INVALID_AI_RESPONSE' | 'STORAGE_ERROR' | 'DATABASE_ERROR' | 'AUTH_ERROR' |
-- 'NOT_FOUND' | 'VALIDATION_ERROR' | 'UNKNOWN'. No
-- lleva CHECK a propósito para que añadir una categoría sea un cambio de
-- TypeScript, no una segunda migración; los errores se leen con validación de
-- enum, y un valor desconocido es UNKNOWN, no un 23514 que rompe la escritura
-- del error. `latency_ms` es integer y admite NULL: NULL es "no lo sé", que no
-- es lo mismo que 0.
--
-- `provider` y `model` son NOT NULL porque sin ellos un resultado no es
-- reproducible ni auditable: un dictamen sin saber quién lo emitió no se puede
-- contrastar ni comparar con otro. El default 'openrouter' es el proveedor por
-- defecto del producto, no un valor opcional.
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'RUNNING'
    CHECK (status IN ('RUNNING','COMPLETED','ERROR')),
  provider text NOT NULL DEFAULT 'openrouter',
  model text NOT NULL,
  evidence_fingerprint text NOT NULL,
  attempt_number integer NOT NULL DEFAULT 1 CHECK (attempt_number >= 1),
  deadline_at timestamptz,
  provider_metadata jsonb,
  result_json jsonb,               -- AuditResult validado (fuente de verdad)
  error_category text,             -- vocabulario cerrado en src/skills/audit/types.ts (ERROR_CATEGORIES, 10 valores); sin CHECK a propósito
  latency_ms integer,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Índice del expediente: historial de auditorías y lectura de la más reciente
-- (created_at DESC). Sin UNIQUE, porque re-auditar es una operación válida.
CREATE INDEX IF NOT EXISTS audits_case_id_created_at_idx
  ON public.audits (case_id, created_at DESC);

CREATE INDEX IF NOT EXISTS audits_case_id_fingerprint_created_at_idx
  ON public.audits (case_id, evidence_fingerprint, created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS audits_one_running_per_case_fingerprint_idx
  ON public.audits (case_id, evidence_fingerprint)
  WHERE status = 'RUNNING';

DO $baseline$
BEGIN
  COMMENT ON TABLE public.audits IS
    'Un intento de auditoría por fila. result_json es el AuditResult validado y la ÚNICA fuente de verdad del resultado. Sin UNIQUE en case_id porque un caso se puede re-auditar; el cliente lee la fila más reciente.';
EXCEPTION WHEN insufficient_privilege THEN
  NULL;
END
$baseline$;


-- =============================================================================
-- SECCIÓN 2 — public.set_updated_at() y su disparador
--
-- ÚNICA función de este esquema. No es capacidad, es infraestructura: evita
-- que cada tabla repita `NEW.updated_at = now()` y sobre todo evita que la
-- fecha la escriba a mano el cliente (un cliente que manda su propia fecha de
-- actualización puede afirmar que una fila no cambió desde hace un año).
--
-- Va SÓLO en `cases`, la única tabla del esquema con `updated_at`. Ni
-- `evidence` ni `audits` lo llevan, y en ninguna de las dos es un olvido: ver
-- 1.2 para `evidence` y el comentario del disparador más abajo para `audits`.
--
-- search_path fijado con pg_catalog PRIMERO: es la convención que impide que un
-- objeto del esquema public ensombrezca una función del catálogo y sea usado en
-- su lugar. No es SECURITY DEFINER (no lo necesita) y por eso el search_path no
-- cambia su comportamiento; se fija igual, porque el día que alguien le añada
-- SET ya está escrito.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $fn$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$fn$;

-- PostgreSQL da EXECUTE a PUBLIC en TODA función nueva. Sin estos REVOKE,
-- cualquier cliente —incluido uno anónimo— podría invocar la función, y aquí
-- eso no parece grave... hasta que se recuerda que es el mismo agujero del
-- tamaño de la función en cualquier función que se añadiera después sin
-- acordarse del REVOKE. Se revoca a PUBLIC y a anon; y a `authenticated` NO se
-- le quita, porque la necesita (ver el comentario siguiente).
--
-- POR QUÉ SÍ HAY GRANT A authenticated, CONTRA LO QUE SE SUELE ASUMIR
--   Una función de trigger se ejecuta con los privilegios del usuario que
--   disparó el evento, salvo que sea SECURITY DEFINER. El cliente actualiza
--   `cases` (cambia status: READY -> AUDITING -> COMPLETED | ERROR) con el rol
--   `authenticated`, así que ese rol necesita EXECUTE sobre esta función; si no
--   lo tiene, el UPDATE revienta en tiempo de ejecución con un 42501
--   "permission denied for function set_updated_at" que no tiene nada que ver
--   con la RLS, con el caso ni con la política, y que sólo aparece cuando un
--   usuario interactúa con la interfaz. La función NO se declara SECURITY
--   DEFINER para esquivarlo: no lo necesita (sólo escribe NEW), y hacerlo
--   significaría ejecutar código de cliente con los privilegios del
--   propietario. Lo correcto es conceder EXECUTE al rol que legítimamente
--   dispara el trigger y quitárselo a los demás. La verificación (sección 5,
--   control 9) falla la migración si alguien devuelve esta función a "sólo el
--   dueño", que es exactamente el bug que se quiere hacer imposible.
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM anon;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO authenticated, service_role;

-- POR QUÉ EL DISPARADOR ESTÁ SÓLO EN `cases`, Y NO TAMBIÉN EN `audits`
--   Decisión deliberada, y hay que entenderla para no "arreglarla" después.
--   `public.audits` NO tiene columna `updated_at`: su definición es id, case_id,
--   status, provider, model, result_json, error_category, latency_ms,
--   created_at. Un BEFORE UPDATE que asigna `NEW.updated_at` sobre una tabla SIN
--   esa columna se crea sin quejarse y revienta en tiempo de ejecución la
--   PRIMERA vez que alguien actualiza la fila, porque PL/pgSQL resuelve el campo
--   al ejecutar, no al crear el trigger. Y esa actualización es precisamente el
--   cierre de la auditoría (RUNNING -> COMPLETED | ERROR): el fallo aparecería
--   al cerrar el dictamen, no al migrar, que es el peor sitio posible para un
--   error que se evita en el DDL.
--   Por eso la tabla se deja exactamente como la especifica el producto y el
--   disparador se pone donde la columna existe. `evidence` tampoco la tiene, por
--   el motivo de la sección 1.2: su contenido es inmutable.
--   Consecuencia asumida: una fila de `audits` no lleva `updated_at`, y
--   `created_at` es su única marca de tiempo. Es coherente con el modelo: cada
--   ejecución es una fila nueva, y en una fila que sufre un único cambio de
--   estado técnico, la marca de esa transición no aporta nada que no se vea ya
--   en `status`.
--   Si algún día se quiere `updated_at` en `audits`, es un cambio de DOS líneas
--   coherentes entre sí: añadir la columna a la tabla y añadir aquí el segundo
--   CREATE TRIGGER. Nunca sólo el trigger.
--
-- DROP ... IF EXISTS antes de CREATE TRIGGER porque CREATE TRIGGER no tiene
-- forma idempotente: sobre una base re-aplicada, el trigger ya existe y el
-- CREATE sin el DROP falla.
DROP TRIGGER IF EXISTS cases_set_updated_at ON public.cases;
CREATE TRIGGER cases_set_updated_at
  BEFORE UPDATE ON public.cases
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- SECCIÓN 3 — RLS, privilegios de tabla
--
-- DENY POR DEFECTO, en las tres tablas y en el mismo orden:
--
--   1) RLS habilitada. Sin esto las políticas son decorado.
--   2) REVOKE ALL a anon y a authenticated: punto de partida limpio, sin
--      depender de los privilegios por defecto que traiga la plataforma. En
--      varias plataformas el rol de cliente recibe "todo" por defecto sobre las
--      tablas nuevas; si este archivo sólo revocara lo que él mismo otorgó,
--      la migración sería correcta en una base limpia y fallaría en la base
--      real, y TRUNCATE/REFERENCES/TRIGGER se colarían sin que nadie lo viera.
--      La ausencia de un privilegio ES la decisión, y se hace explícita antes
--      de conceder lo que sí se permite.
--   3) GRANT de exactamente los cuatro privilegios de cliente, a las tres
--      tablas, en UN solo statement: a partir de ahí, ninguna añadición
--      accidental.
--   4) REVOKE ALL a anon al final: la última palabra sobre el rol anónimo
--      siempre la tiene el REVOKE, nunca el GRANT.
--
-- NOTA SOBRE FORCE ROW LEVEL SECURITY: no se usa, a propósito. FORCE somete
-- también al propietario de la tabla, y con él al rol que aplica el DDL: una
-- operación de recuperación (corregir una fila a mano, reejecutar la auditoría
-- desde el runtime) se volvería imposible sin deshabilitar antes la política,
-- que es justo lo que uno hace cuando tiene prisa. Lo que decide el modelo es
-- otro: el límite de seguridad es el rol `authenticated` (lo que puede hacer
-- un navegador con un JWT) frente a `service_role` (el servidor, que la
-- plataforma define con BYPASSRLS y que por eso escribe filas de cualquier
-- caso). Ambas cosas son deliberadas y están escritas aquí para que nadie las
-- descubra leyendo los metadatos de la tabla.
-- =============================================================================
ALTER TABLE public.cases    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidence ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audits   ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.cases, public.evidence, public.audits FROM anon;
REVOKE ALL ON TABLE public.cases, public.evidence, public.audits FROM authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.cases, public.evidence, public.audits
  TO authenticated;

REVOKE ALL ON TABLE public.cases, public.evidence, public.audits FROM anon;

-- No hay GRANT sobre secuencias a propósito: ningún id es bigserial, todos son
-- uuid con DEFAULT gen_random_uuid(). Una secuencia sería un objeto que
-- mantener y que nadie necesita.


-- =============================================================================
-- SECCIÓN 4 — Las doce políticas RLS
--
-- UNA SOLA REGLA EN LAS TRES TABLAS: el dueño es el creador del caso.
--
--   cases    -> comparación directa:    created_by = auth.uid()
--   evidence  -> por existencia:         EXISTS (... cases.created_by = auth.uid())
--   audits    -> por existencia:         EXISTS (... cases.created_by = auth.uid())
--
-- Por qué evidencia y audits no llevan `created_by`: la fila es de un
-- expediente, no de una persona. Quien puede tocar un expediente es quien lo
-- creó, se exprese como se exprese. Añadir un created_by a las hijas crearía
-- una segunda atribución que puede desincronizarse de la del caso (una
-- evidencia "de" alguien que no es el dueño del expediente) y una segunda
-- regla que mantener.
--
-- La EXISTS mira `public.cases`, cuya RLS vuelve a exigir created_by =
-- auth.uid(): la condición se comprueba dos veces. No es recursión (son tablas
-- distintas) y no es redundancia inútil: si mañana alguien quita la EXISTS de
-- una política, la RLS de `cases` sigue impidiendo la lectura cruzada, y la
-- fila invisible del caso hace que la EXISTS devuelva FALSE igual. Es
-- defensa en profundidad sobre la misma regla, no dos reglas que puedan
-- divergir.
--
-- `auth.uid()` devuelve NULL sin sesión. Con NULL, `created_by = auth.uid()` es
-- NULL (no TRUE) y la EXISTS no encuentra nada: sin sesión no se ve ni se
-- escribe nada, sin necesidad de una política aparte para "anónimo".
--
-- DROP POLICY IF EXISTS antes de cada CREATE POLICY porque CREATE POLICY no
-- tiene forma idempotente. Los nombres llevan el prefijo de la tabla y la
-- acción, y la sección 5 los comprueba uno por uno: una política con otro
-- nombre, con otro comando, o concedida a PUBLIC en vez de a `authenticated`,
-- hace fallar la migración.
-- =============================================================================

-- --------------------------------------------------------------------- cases --
DROP POLICY IF EXISTS cases_select_own ON public.cases;
CREATE POLICY cases_select_own ON public.cases
  FOR SELECT TO authenticated
  USING (created_by = auth.uid());

DROP POLICY IF EXISTS cases_insert_own ON public.cases;
CREATE POLICY cases_insert_own ON public.cases
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

-- WITH CHECK en UPDATE, y no sólo USING: USING decide a qué filas puede
-- tocar el cliente, WITH CHECK decide con qué valores puede dejarlas. Sin
-- WITH CHECK, un UPDATE podría cambiar `created_by` a otro uuid y regalar el
-- caso (o, peor, moverlo a un caso ajeno si además se aflojara la EXISTS de
-- las hijas). El propietario de un dato personal no se cambia por UPDATE.
DROP POLICY IF EXISTS cases_update_own ON public.cases;
CREATE POLICY cases_update_own ON public.cases
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- El DELETE se permite y es en cascada: borra el caso y con él sus evidencias
-- y sus auditorías. Se documenta aquí para que quede explícito que es
-- deliberado, y no una puerta que se olvidó cerrar.
DROP POLICY IF EXISTS cases_delete_own ON public.cases;
CREATE POLICY cases_delete_own ON public.cases
  FOR DELETE TO authenticated
  USING (created_by = auth.uid());

-- ------------------------------------------------------------------ evidence --
DROP POLICY IF EXISTS evidence_select_for_visible_cases ON public.evidence;
CREATE POLICY evidence_select_for_visible_cases ON public.evidence
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cases
      WHERE cases.id = evidence.case_id
        AND cases.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS evidence_insert_for_visible_cases ON public.evidence;
CREATE POLICY evidence_insert_for_visible_cases ON public.evidence
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cases
      WHERE cases.id = evidence.case_id
        AND cases.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS evidence_update_for_visible_cases ON public.evidence;
CREATE POLICY evidence_update_for_visible_cases ON public.evidence
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cases
      WHERE cases.id = evidence.case_id
        AND cases.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cases
      WHERE cases.id = evidence.case_id
        AND cases.created_by = auth.uid()
    )
  );

-- DELETE: borrarla es parte de corregir una carga equivocada, y el CASCADE de
-- cases ya cubre el borrado masivo. Lo que se protege aquí es que nadie borra
-- evidencia de un caso ajeno.
DROP POLICY IF EXISTS evidence_delete_for_visible_cases ON public.evidence;
CREATE POLICY evidence_delete_for_visible_cases ON public.evidence
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cases
      WHERE cases.id = evidence.case_id
        AND cases.created_by = auth.uid()
    )
  );

-- -------------------------------------------------------------------- audits --
DROP POLICY IF EXISTS audits_select_for_visible_cases ON public.audits;
CREATE POLICY audits_select_for_visible_cases ON public.audits
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cases
      WHERE cases.id = audits.case_id
        AND cases.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS audits_insert_for_visible_cases ON public.audits;
CREATE POLICY audits_insert_for_visible_cases ON public.audits
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cases
      WHERE cases.id = audits.case_id
        AND cases.created_by = auth.uid()
    )
  );

-- La auditoría se puede re-escribir mientras está en curso (el runner va
-- escribiendo RUNNING -> COMPLETED|ERROR) y se puede re-auditar, pero nunca por
-- alguien que no sea el dueño del caso. Lo que NO hay en la base es ninguna
-- regla de qué se puede cambiar en un resultado ya emitido: eso no es una regla
-- de negocio, es la inmutabilidad del dictamen, y vive en la aplicación y en el
-- schema Zod que valida AuditResult, no en SQL. Aquí sólo se decide QUIÉN.
DROP POLICY IF EXISTS audits_update_for_visible_cases ON public.audits;
CREATE POLICY audits_update_for_visible_cases ON public.audits
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cases
      WHERE cases.id = audits.case_id
        AND cases.created_by = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.cases
      WHERE cases.id = audits.case_id
        AND cases.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS audits_delete_for_visible_cases ON public.audits;
CREATE POLICY audits_delete_for_visible_cases ON public.audits
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.cases
      WHERE cases.id = audits.case_id
        AND cases.created_by = auth.uid()
    )
  );


-- =============================================================================
-- SECCIÓN 5 — Verificación posterior a la aplicación
--
-- No se dice "ya está" porque el runner lo dijo: se comprueba. Si algo no
-- cuadra, la migración falla AQUÍ, y no en un informe tres fases después, con
-- una excepción que dice exactamente qué no cuadra.
--
-- Lo que se comprueba:
--   0) que los prerrequisitos de InsForge están (auth.users, auth.uid, roles);
--   1) que las 3 tablas existen con EXACTAMENTE las columnas de la spec;
--   2) que no queda ninguna tabla del esquema retirado;
--   3) que no queda ninguna función de la arquitectura antigua, y que ninguna
--      función de public es ejecutable por PUBLIC ni por anon;
--   4) que la RLS está habilitada en las 3;
--   5) que las 12 políticas son las esperadas, con el comando correcto y sólo
--      para `authenticated` (una política con roles=PUBLIC también falla);
--   6) que no hay ninguna política EXTRA en las 3 tablas;
--   7) los privilegios: anon sin nada, PUBLIC sin nada, y `authenticated` con
--      exactamente los 4 privilegios en cada tabla y nada más;
--   8) que el único disparador es cases_set_updated_at, que está en `cases` y
--      es BEFORE UPDATE FOR EACH ROW, y que no queda ningún otro;
--   9) que set_updated_at() existe, devuelve trigger, no es ejecutable por
--      PUBLIC/anon y SÍ lo es por `authenticated`;
--  10) que los CHECK de estado llevan el vocabulario cerrado de la spec;
--  11) que las 3 claves foráneas existen y borran en cascada;
--  12) que no se colaron los UNIQUE prohibidos (audits.case_id, evidence.hash).
--
-- Todos los privilege checks leen pg_class.relacl con aclexplode(), NO las
-- vistas information_schema.*_privileges: esas vistas filtran por "rol
-- actualmente habilitado" del usuario que consulta, de modo que un runner que
-- no es miembro de `authenticated` no vería las filas y la comprobación
-- fallaría sobre un esquema correcto. El catálogo no filtra nada.
-- =============================================================================
DO $baseline$
DECLARE
  v_leaked   text;
  v_count    integer;
  v_auth_oid oid;
  v_anon_oid oid;
BEGIN

  -- 0) Prerrequisitos que aporta la plataforma. Se comprueban aquí para que un
  --    error de mitad del archivo se lea como lo que es: se aplicó el archivo
  --    sobre un PostgreSQL que no es el de InsForge.
  IF to_regnamespace('auth') IS NULL THEN
    RAISE EXCEPTION 'AI_NATIVE_BASELINE_PREREQ_MISSING: no existe el esquema auth. Este archivo es para una base de InsForge.';
  END IF;
  IF to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'AI_NATIVE_BASELINE_PREREQ_MISSING: no existe auth.users. Este archivo es para una base de InsForge.';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'AI_NATIVE_BASELINE_PREREQ_MISSING: no existe auth.uid(). Este archivo es para una base de InsForge.';
  END IF;
  SELECT oid INTO v_anon_oid FROM pg_roles WHERE rolname = 'anon';
  IF v_anon_oid IS NULL THEN
    RAISE EXCEPTION 'AI_NATIVE_BASELINE_PREREQ_MISSING: no existe el rol anon (InsForge).';
  END IF;
  SELECT oid INTO v_auth_oid FROM pg_roles WHERE rolname = 'authenticated';
  IF v_auth_oid IS NULL THEN
    RAISE EXCEPTION 'AI_NATIVE_BASELINE_PREREQ_MISSING: no existe el rol authenticated (InsForge).';
  END IF;

  -- 1) Las 3 tablas con las columnas de la spec. Se comprueban COLUMNAS, no sólo
  --    la existencia de la tabla: un CREATE TABLE IF NOT EXISTS que se encuentra
  --    una tabla vieja con otra forma es un no-op silencioso, y `audits` es
  --    exactamente el nombre donde eso puede pasar (la tabla legacy se llamaba
  --    igual). Es el control que hace útil la guardia 0.1.
  SELECT string_agg(e.tabla || '.' || col.nombre, ', ' ORDER BY e.tabla, col.nombre)
    INTO v_leaked
  FROM (VALUES
    ('cases', ARRAY[
      'id','status','student_identifier','created_by','created_at','updated_at']::text[]),
    ('evidence', ARRAY[
      'id','case_id','filename','mime_type','size_bytes','hash','storage_path',
      'processing_status','transcript_json','created_at']::text[]),
    ('audits', ARRAY[
      'id','case_id','status','provider','model','evidence_fingerprint','attempt_number',
      'deadline_at','provider_metadata','result_json','error_category','latency_ms','created_at']::text[])
  ) AS e(tabla, cols)
  CROSS JOIN LATERAL unnest(e.cols) AS col(nombre)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'public'
      AND c.table_name = e.tabla
      AND c.column_name = col.nombre
  );
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'AI_NATIVE_BASELINE_INCOMPLETE: a la línea base le faltan columnas de la spec: %. Si `audits` aparece aquí, es la tabla del esquema anterior: esta migración no reescribe tablas existentes.',
      v_leaked;
  END IF;

  -- 2) Ninguna tabla del esquema retirado sobrevive.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname)
    INTO v_leaked
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname = ANY (ARRAY[
      'profiles','evidences','audit_log','audit_manual_comments',
      'jobs','job_attempts','job_artifacts',
      'audit_runs','tool_executions','audit_results','ai_call_log',
      'facts','fact_runs','fact_extraction_runs','fact_reviews',
      'fact_run_frozen_snapshots','canonical_facts','canonical_fact_runs',
      'canonical_fact_candidates','extracted_facts',
      'rules','rule_conditions','rule_evaluations',
      'engine_runs','engine_rule_results','evidence_requirements',
      'policy_sources','policy_source_registry','audit_temporal_context',
      'source_completeness',
      'tickets','ticket_events','dictamen_documents','dictamen_versions',
      'generated_pdfs','report_snapshots','ai_usage','ai_decision_snapshots',
      'audit_comparisons','audit_evaluation_envelopes','final_adjudications',
      'human_decision_extracts','human_reviews','audit_evidence_selection',
      'provider_operations','speaker_assignments','transcript_segments',
      'decision_runs','audit_events','schema_baseline_v2_manifest'
    ]);
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'AI_NATIVE_BASELINE_INCOMPLETE: tablas del esquema antiguo aún presentes: %',
      v_leaked;
  END IF;

  -- 3) Ninguna función de la arquitectura antigua quedó viva. La única función
  --    que este esquema declara en public es set_updated_at; cualquier otra es
  --    residuo (RPC, cola, barridos, motor de reglas) o una función que la
  --    plataforma hubiera creado por su cuenta. Este control es deliberadamente
  --    estricto, y por eso su mensaje no presupone cuál de los dos casos es: si
  --    la función no es de la arquitectura antigua, hay que revisarla y decidir,
  --    no borrarla a ciegas.
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname)
    INTO v_leaked
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname <> 'set_updated_at';
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'AI_NATIVE_BASELINE_INCOMPLETE: en el esquema public hay funciones que no son de esta línea base: %. Esta línea base no expone ninguna RPC (la base no ejecuta lógica de negocio): si son de la arquitectura antigua, elimínelas; si pertenecen a la plataforma, revíselas y no permitas que el cliente las ejecute.',
      v_leaked;
  END IF;

  -- 3b) Y ninguna función de public ejecutable por PUBLIC ni por anon.
  --     grantee = 0 es PUBLIC en la representación de ACL de Postgres. Se
  --     excluye al propietario, que sí debe poder ejecutarla por definición.
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname)
    INTO v_leaked
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
  WHERE n.nspname = 'public'
    AND acl.privilege_type = 'EXECUTE'
    AND acl.grantee <> p.proowner
    AND (acl.grantee = 0 OR acl.grantee = v_anon_oid);
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'AI_NATIVE_BASELINE_INSECURE: funciones de public ejecutables por PUBLIC o anon: %',
      v_leaked;
  END IF;

  -- 4) RLS habilitada en las tres. Sin esto, las políticas de la sección 4 no
  --    se aplican y todo el modelo de seguridad es decorado.
  SELECT count(*) INTO v_count
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('cases','evidence','audits')
    AND c.relrowsecurity;
  IF v_count <> 3 THEN
    RAISE EXCEPTION
      'AI_NATIVE_BASELINE_INSECURE: la RLS no está habilitada en las tres tablas del producto';
  END IF;

  -- 5) Las 12 políticas, con su comando correcto y sólo para `authenticated`.
  --    Se leen de `pg_policies` y no de `pg_policy` por dos razones: `cmd` ya
  --    viene como texto ('SELECT', 'INSERT', ...) sin depender del cast de
  --    polcmd (que es del tipo interno "char" y cuya coerción no es estable
  --    entre versiones), y `roles` ya viene como name[] con nombres de rol, así
  --    que comparar `roles = ARRAY['authenticated']` descarta tanto una
  --    política sin rol (PUBLIC) como una demasiado amplia (anon u otro): es la
  --    diferencia entre "hay una política" y "es la que se quiso escribir".
  --    `pg_policies` es una vista directa sobre el catálogo, sin filtrado por
  --    usuario, así que no puede verse menos de lo que hay.
  --
  --    `permissive` se compara contra 'PERMISSIVE' y no se usa como predicado a
  --    secas porque en `pg_policies` es de tipo TEXT ('PERMISSIVE'/'RESTRICTIVE'),
  --    no booleano: `AND p.permissive` aborta la migración con "argument of AND
  --    must be type boolean, not type text" sobre un esquema correcto.
  WITH esperado(pol_nombre, tbl, cmd) AS (
    VALUES
      ('cases_select_own',                  'cases',    'SELECT'),
      ('cases_insert_own',                  'cases',    'INSERT'),
      ('cases_update_own',                  'cases',    'UPDATE'),
      ('cases_delete_own',                  'cases',    'DELETE'),
      ('evidence_select_for_visible_cases', 'evidence', 'SELECT'),
      ('evidence_insert_for_visible_cases', 'evidence', 'INSERT'),
      ('evidence_update_for_visible_cases', 'evidence', 'UPDATE'),
      ('evidence_delete_for_visible_cases', 'evidence', 'DELETE'),
      ('audits_select_for_visible_cases',   'audits',   'SELECT'),
      ('audits_insert_for_visible_cases',   'audits',   'INSERT'),
      ('audits_update_for_visible_cases',   'audits',   'UPDATE'),
      ('audits_delete_for_visible_cases',   'audits',   'DELETE')
  )
  SELECT string_agg(e.pol_nombre, ', ' ORDER BY e.pol_nombre)
    INTO v_leaked
  FROM esperado e
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_policies p
    WHERE p.schemaname = 'public'
      AND p.tablename = e.tbl
      AND p.policyname = e.pol_nombre
      AND p.cmd = e.cmd
      AND p.permissive = 'PERMISSIVE'
      AND p.roles = ARRAY['authenticated']::name[]
  );
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'AI_NATIVE_BASELINE_INSECURE: faltan, o no son las esperadas, estas políticas: % (cuenta también como faltante una política con otro comando, de otro nombre, no PERMISSIVE, o concedida a PUBLIC/anon en vez de a authenticated)',
      v_leaked;
  END IF;

  -- 6) Ninguna política EXTRA en las tres tablas. Una política sobrante es una
  --    puerta trasera: las políticas son PERMISSIVE y se combinan con OR, así
  --    que una sola política adicional bien escrita anula el modelo entero sin
  --    tocar ninguna de las doce.
  SELECT string_agg(p.tablename || '.' || p.policyname, ', ' ORDER BY p.tablename, p.policyname)
    INTO v_leaked
  FROM pg_policies p
  WHERE p.schemaname = 'public'
    AND p.tablename IN ('cases','evidence','audits')
    AND p.policyname <> ALL (ARRAY[
      'cases_select_own','cases_insert_own','cases_update_own','cases_delete_own',
      'evidence_select_for_visible_cases','evidence_insert_for_visible_cases',
      'evidence_update_for_visible_cases','evidence_delete_for_visible_cases',
      'audits_select_for_visible_cases','audits_insert_for_visible_cases',
      'audits_update_for_visible_cases','audits_delete_for_visible_cases'
    ]);
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'AI_NATIVE_BASELINE_INSECURE: políticas no esperadas en las tablas del producto: %',
      v_leaked;
  END IF;

  -- 7a) `anon` sin ningún privilegio sobre las tres tablas.
  SELECT string_agg(r.rolname || ':' || c.relname || ':' || acl.privilege_type,
                    ', ' ORDER BY c.relname, acl.privilege_type)
    INTO v_leaked
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
  JOIN pg_roles r ON r.oid = acl.grantee
  WHERE n.nspname = 'public'
    AND c.relname IN ('cases','evidence','audits')
    AND r.rolname = 'anon';
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'AI_NATIVE_BASELINE_INSECURE: anon conserva privilegios sobre las tablas del producto: %',
      v_leaked;
  END IF;

  -- 7b) PUBLIC tampoco. grantee = 0 es PUBLIC; el JOIN a pg_roles lo dejaría
  --     fuera, así que se mira explícitamente.
  IF EXISTS (
    SELECT 1
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
    WHERE n.nspname = 'public'
      AND c.relname IN ('cases','evidence','audits')
      AND acl.grantee = 0
  ) THEN
    RAISE EXCEPTION
      'AI_NATIVE_BASELINE_INSECURE: hay privilegios concedidos a PUBLIC sobre las tablas del producto';
  END IF;

  -- 7c) `authenticated` con EXACTAMENTE los cuatro, en las tres, y nada más.
  --     Que sea exactamente: si aparece TRUNCATE, REFERENCES o TRIGGER (lo que
  --     aportan los privilegios por defecto de algunas plataformas), la
  --     migración falla, porque "todo lo que la plataforma concede por defecto"
  --     no es una lista de privilegios que alguien haya decidido.
  SELECT count(*) INTO v_count
  FROM (
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) AS acl
    WHERE n.nspname = 'public'
      AND c.relname IN ('cases','evidence','audits')
      AND acl.grantee = v_auth_oid
    GROUP BY c.relname
    HAVING array_agg(acl.privilege_type) @> ARRAY['SELECT','INSERT','UPDATE','DELETE']
       AND array_agg(acl.privilege_type) <@ ARRAY['SELECT','INSERT','UPDATE','DELETE']
  ) t;
  IF v_count <> 3 THEN
    RAISE EXCEPTION
      'AI_NATIVE_BASELINE_INSECURE: authenticated no tiene exactamente SELECT, INSERT, UPDATE y DELETE en las tres tablas del producto (revise los privilegios por defecto de la plataforma)';
  END IF;

  -- 8a) El único disparador de las tres tablas es cases_set_updated_at. Un
  --     trigger heredado (el guard de inmutabilidad del legacy, o un sweep)
  --     seguiría ejecutándose, aplicando reglas de negocio que ya nadie ha
  --     pedido, sobre una base que ya no las declara. Y un trigger de más en
  --     `audits` o `evidence` sería el error en tiempo de ejecución del que fala
  --     la sección 2.
  SELECT string_agg(c.relname || '.' || t.tgname, ', ' ORDER BY c.relname, t.tgname)
    INTO v_leaked
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname IN ('cases','evidence','audits')
    AND NOT t.tgisinternal
    AND t.tgname <> 'cases_set_updated_at';
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'AI_NATIVE_BASELINE_INCOMPLETE: disparadores no esperados en las tablas del producto: % (esta línea base sólo declara cases_set_updated_at; un trigger de updated_at en audits fallaría en runtime porque audits no tiene esa columna)',
      v_leaked;
  END IF;

  -- 8b) Y que ese existe, está en `cases`, y es BEFORE UPDATE FOR EACH ROW.
  --     tgtype es un mapa de bits: 1 = ROW, 2 = BEFORE, 4 = INSERT, 8 = DELETE,
  --     16 = UPDATE, 32 = TRUNCATE, 64 = INSTEAD OF. Un trigger BEFORE para
  --     TRUNCATE (1|2|32) no mantendría updated_at, y es el error que un
  --     refresco del archivo puede colar sin que nadie lo note.
  SELECT count(*) INTO v_count
  FROM pg_trigger t
  JOIN pg_class c ON c.oid = t.tgrelid
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = 'cases'
    AND NOT t.tgisinternal
    AND t.tgname = 'cases_set_updated_at'
    AND (t.tgtype::int & 1)  = 1     -- ROW
    AND (t.tgtype::int & 2)  = 2     -- BEFORE
    AND (t.tgtype::int & 16) = 16    -- UPDATE
    AND (t.tgtype::int & 4)  <> 4    -- no INSERT
    AND (t.tgtype::int & 8)  <> 8    -- no DELETE
    AND (t.tgtype::int & 32) <> 32;  -- no TRUNCATE
  IF v_count <> 1 THEN
    RAISE EXCEPTION
      'AI_NATIVE_BASELINE_INCOMPLETE: falta cases_set_updated_at en public.cases, o no es BEFORE UPDATE FOR EACH ROW';
  END IF;

  -- 9) set_updated_at(): existe, devuelve trigger, cerrada a PUBLIC/anon y
  --    ABIERTA a authenticated. El último punto es el que duele cuando falta:
  --    sin EXECUTE para el rol de cliente, cada UPDATE que el usuario haga en
  --    la interfaz falla con un 42501 que no parece de permisos. Convertir ese
  --    error futuro en un fallo de migración es el objeto de este control.
  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname = 'set_updated_at'
      AND p.pronargs = 0
      AND p.prorettype = 'trigger'::regtype
  ) THEN
    RAISE EXCEPTION
      'AI_NATIVE_BASELINE_INCOMPLETE: no existe public.set_updated_at() RETURNS trigger';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
    WHERE n.nspname = 'public'
      AND p.proname = 'set_updated_at'
      AND acl.privilege_type = 'EXECUTE'
      AND (acl.grantee = 0 OR acl.grantee = v_anon_oid)
  ) THEN
    RAISE EXCEPTION
      'AI_NATIVE_BASELINE_INSECURE: public.set_updated_at() es ejecutable por PUBLIC o anon';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
    WHERE n.nspname = 'public'
      AND p.proname = 'set_updated_at'
      AND acl.privilege_type = 'EXECUTE'
      AND acl.grantee = v_auth_oid
  ) THEN
    RAISE EXCEPTION
      'AI_NATIVE_BASELINE_INSECURE: authenticated no tiene EXECUTE sobre public.set_updated_at(); cada UPDATE del cliente sobre cases fallaría en runtime con 42501';
  END IF;

  -- 10) El vocabulario cerrado de los CHECK de estado. Se comprueba por valor
  --     y no comparando la definición textual: la forma exacta de la
  --     definición la decide la versión de PostgreSQL, y una comparación
  --     literal frágil haría fallar la migración por una razón que no es un
  --     defecto del esquema. Se comprueba que el CHECK existe y contiene cada
  --     valor de la spec, que es lo que protege contra un estado nuevo
  --     colado desde la aplicación.
  SELECT string_agg(v.tabla || '.' || v.col || ' no declara ' || v.val, ', ')
    INTO v_leaked
  FROM (VALUES
    ('cases',    'status',             'DRAFT'),
    ('cases',    'status',             'READY'),
    ('cases',    'status',             'AUDITING'),
    ('cases',    'status',             'COMPLETED'),
    ('cases',    'status',             'ERROR'),
    ('evidence', 'processing_status',  'UPLOADED'),
    ('evidence', 'processing_status',  'TRANSCRIBING'),
    ('evidence', 'processing_status',  'READY'),
    ('evidence', 'processing_status',  'ERROR'),
    ('audits',   'status',             'RUNNING'),
    ('audits',   'status',             'COMPLETED'),
    ('audits',   'status',             'ERROR')
  ) AS v(tabla, col, val)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint ct
    WHERE ct.conrelid = format('public.%I', v.tabla)::regclass
      AND ct.contype = 'c'
      AND pg_get_constraintdef(ct.oid) LIKE '%' || v.val || '%'
  );
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'AI_NATIVE_BASELINE_INCOMPLETO: el CHECK de estado no es el de la spec (%); una columna de estado sin vocabulario cerrado en la base es un estado que se puede colar desde la aplicación',
      v_leaked;
  END IF;

  -- 11) Las tres claves foráneas, y las tres con ON DELETE CASCADE: sin cascada
  --     un borrado de usuario o de caso deja filas huérfanas que ya nadie puede
  --     ver ni borrar (su RLS depende de un padre que ya no existe).
  SELECT string_agg(v.tabla || '.' || v.col || ' -> ' || v.ref, ', ')
    INTO v_leaked
  FROM (VALUES
    ('cases',    'created_by', 'auth.users'),
    ('evidence', 'case_id',    'public.cases'),
    ('audits',   'case_id',    'public.cases')
  ) AS v(tabla, col, ref)
  WHERE NOT EXISTS (
    SELECT 1
    FROM pg_constraint fk
    WHERE fk.conrelid = format('public.%I', v.tabla)::regclass
      AND fk.contype = 'f'
      AND fk.confrelid = v.ref::regclass
      AND fk.confdeltype = 'c'                      -- CASCADE
      AND pg_get_constraintdef(fk.oid) LIKE '%' || v.col || '%'
  );
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION
      'AI_NATIVE_BASELINE_INCOMPLETE: faltan claves foráneas con ON DELETE CASCADE: %',
      v_leaked;
  END IF;

  -- 12) Los UNIQUE que NO deben existir. Se declaran las dos ausencias porque
  --     son decisiones de producto que se rompen en silencio si aparecen:
  --       - audits UNIQUE (case_id): impide re-auditar un caso.
  --       - evidence UNIQUE (hash): convierte la deduplicación, que es una
  --         decisión de la aplicación, en un error 23505 en el momento del
  --         upload.
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.audits'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%case_id%'
  ) THEN
    RAISE EXCEPTION
      'AI_NATIVE_BASELINE_INCOMPLETE: audits no debe tener UNIQUE en case_id; un caso se puede re-auditar y el cliente lee la fila más reciente';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.evidence'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) LIKE '%hash%'
  ) THEN
    RAISE EXCEPTION
      'AI_NATIVE_BASELINE_INCOMPLETE: evidence no debe tener UNIQUE en hash; la deduplicación la decide la aplicación, no la base';
  END IF;

END
$baseline$;


-- =============================================================================
-- Fin de la línea base.
--
-- Lo que queda en la base: 3 tablas, 4 índices, 1 función, 1 disparador,
-- 12 políticas RLS y una ACL explícita por rol. Lo que NO queda, y no debe
-- volver: cola de trabajo, runs, tool_executions, ai_call_log, bitácora,
-- motor de reglas, facts, ni ninguna función que decida negocio.
--
-- El bucket `evidencias` y su path `{caseId}/{uuid}-{sanitizedFilename}` se
-- crean con la CLI de InsForge, no desde este archivo.
-- =============================================================================
