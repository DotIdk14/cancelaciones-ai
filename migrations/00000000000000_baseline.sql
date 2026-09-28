-- =============================================================================
-- 00000000000000_baseline.sql — LÍNEA BASE ÚNICA DEL ESQUEMA AI-NATIVE
-- =============================================================================
--
-- QUÉ ES ESTE ARCHIVO
--   Es el ÚNICO esquema del repositorio. Una instalación limpia es:
--
--       psql -f 00000000000000_baseline.sql
--
--   Aplicable sobre una base vacía. Lo único que se asume ya existente, y que
--   aporta la plataforma (InsForge), son:
--     - el esquema `auth` con la tabla `auth.users` y la función `auth.uid()`;
--     - los roles `anon`, `authenticated` y `service_role`.
--   Nada más. En particular, este archivo NO depende de ninguna otra migración.
--
-- DIRECCIÓN
--   forward-only, sin BEGIN/COMMIT (el runner envuelve cada archivo en su propia
--   transacción). Re-ejecutar el archivo es seguro: todas las operaciones son
--   idempotentes (IF NOT EXISTS / IF EXISTS / DROP ... IF EXISTS / ON CONFLICT).
--
-- -----------------------------------------------------------------------------
-- EL ESQUEMA ANTERIOR, RETIRADO COMPLETO
-- -----------------------------------------------------------------------------
-- Antes de este archivo el repositorio llevaba 37 migraciones (250 KB) que
-- construían el "motor normativo": un motor de reglas determinista (facts, rules,
-- rule_conditions, engine_runs, policy_sources, fact model canónico), el pipeline
-- de reportes de dictamen en PDF, la comparación IA/humano y un ledger de coste
-- `ai_usage`, todo ello sobre una capa legacy de "tickets".
--
-- Se retira COMPLETO, y no por jumlahnya, sino porque su criterio normativo
-- en contra de AGENTS.md:
--     POLICY_ENGINE_DECIDES  — el criterio ya no lo aplica un motor de reglas en
--                               tablas: lo aplica el agente sobre la fuente
--                               oficial que entrega el propietario. Mantener el
--                               motor en tablas era mantener un segundo juez con
--                               reglas que nadie puede auditar contra la fuente.
--     DO_NOT_DUPLICATE_IMPLEMENTATIONS — el motor y el agente decidían lo mismo
--                               dos veces, con dos formatos de salida distintos.
--     KEEP_IT_SIMPLE          — para ~50 auditorías/día, 48 tablas y ~30
--                               funciones para clasificar documentos es
--                               infraestructura sin consumidor.
--
-- Lo que sobrevive es lo que de verdad tiene consumidor: una auditoría, sus
-- evidencias, su bitácora, sus comentarios, la cola durable, y la traza de lo
-- que el agente hizo y costó.
--
-- -----------------------------------------------------------------------------
-- POR QUÉ SE BORRARON LAS 37 MIGRACIONES DEL ÁRBOL
-- -----------------------------------------------------------------------------
-- Se eliminaron del árbol de trabajo (Git conserva su historia completa, así que
-- siguen siendo recuperables con `git show <commit>:<ruta>`). Tres razones, todas
-- verificadas, ninguna estética:
--
--   1) TRES DE ELLAS NO SON REPRODUCIBLES. Una instalación limpia fallaba ANTES
--      de llegar al baseline:
--        - 20260918211733_create-auditor-schema.sql:354
--            ERROR: schema "system" does not exist
--        - 20260925090200_fact-reviews-schema-compat.sql:12
--            ERROR: column "status" does not exist
--        - 20260925140000_policy-foundation-security-closure.sql:81
--            ERROR: relation "public.audit_jobs" does not exist
--      Esas tres referencian objetos que ninguna migración anterior crea
--      (`schema system`, una columna que ya no existía, una tabla que cambió de
--      nombre). Su contenido está en el historial; su condición de reproducción
--      no.
--
--   2) CREABAN 36 TABLAS QUE ESTE MISMO BASELINE DESTRUÍA. facts, rules,
--      engine_runs, tickets, dictamen_documents, generated_pdfs, ai_usage,
--      report_snapshots, canonical_facts, ... Eran 250 KB de SQL cuyo efecto neto
--      sobre el esquema final era 36 tablas de más. Mantenerlas obligaba a
--      arrastrar la reconstrucción y sus 250 DROP por el mismo archivo.
--
--   3) NO SON EL ESTADO DEL PRODUCTO. El esquema vivo es el de este baseline; el
--      resto era andamiaje de una arquitectura ya retirada. Que el árbol describa
--      el producto y no su arqueología es lo que hace que `psql -f` sobre una
--      base vacía sea una verificación y no una investigación.
--
-- NOTA SOBRE ESTA REESCRITURA: la versión anterior de este archivo (commit
-- anterior a la consolidación) era TRANSFORMACIONAL: convertía el esquema
-- acumulado en el limpio y por eso DROP y CREATE al mismo tiempo. Al quedar
-- este baseline como único archivo, se reescribió como instalación limpia: crea
-- directamente la forma final de las 12 tablas, sinarrastrar el DROP de lo que ya
-- no se crea. Los DROP y la verificación de "no queda nada del esquema antiguo"
-- se conservan, porque siguen siendo la garantía de que este archivo puede
-- aplicarse encima de una base que alguien migró antes con el árbol viejo.
--
-- -----------------------------------------------------------------------------
-- LAS 12 TABLAS QUE SOBREVIVEN
-- -----------------------------------------------------------------------------
--   1.  profiles                  — quién es el usuario y su rol (AUDITOR|OWNER);
--                                   la fuente de `current_app_role()`.
--   2.  audits                    — la auditoría: expediente, estado y datos de
--                                   cabecera. Raíz de todo el aggregates.
--   3.  audit_log                 — bitácora append-only de los hechos
--                                   relevantes (alta, cola, cierre, borrado).
--   4.  audit_manual_comments     — los cuatro comentarios manuales (back office,
--                                   helpdesk, servicios escolares, finanzas).
--   5.  evidences                 — los archivos del expediente, con su estado de
--                                   ALMACENAMIENTO (`status`) separado del de
--                                   CONTENIDO (`content_status`).
--   6.  jobs                      — la cola durable: trabajo con idempotencia,
--                                   reintento y timeout. Estados: QUEUED,
--                                   RUNNING, SUCCEEDED, FAILED.
--   7.  job_attempts              — un registro por intento: quién intentó qué,
--                                   cuándo y con qué resultado. Da duración
--                                   real al worker sin columna de lease.
--   8.  job_artifacts             — el resultado de un job (extracción,
--                                   transcripción), UNIQUE (job_id, artifact_type).
--   9.  audit_runs                — un intento de dictamen: unidad de trabajo y de
--                                   trazabilidad. TERMINAL = inmutable.
--  10.  tool_executions           — una llamada del agente por fila; con su
--                                   idempotencia, su timeout y su error.
--  11.  audit_results             — el dictamen por etapa (ANALYST, REVIEWER,
--                                   FINAL). Un resultado por run.
--  12.  ai_call_log               — telemetría de coste y latencia por llamada de
--                                   modelo. APPEND-ONLY.
--
-- Además sobreviven dos funciones de apoyo, que no son capacidad sino
-- infraestructura: `set_updated_at()` (disparadores de updated_at) y
-- `current_app_role()` (SECURITY DEFINER, evita la recursión de políticas al
-- leer profiles).
--
-- -----------------------------------------------------------------------------
-- LAS 9 FUNCIONES DE LA LÍNEA BASE
-- -----------------------------------------------------------------------------
--   1.  guard_audit_run_immutability()  — trigger: un audit_run terminal
--      (COMPLETED|NEEDS_INPUT|FAILED) no se reescribe, ni por su propietario, ni
--      por un sweep, ni por una corrección humana (PRESERVE_MACHINE_DECISION).
--   2.  enqueue_job()                   — alta idempotente de un job por
--      idempotency_key; reactiva a QUEUED sólo un FAILED con input distinto.
--   3.  claim_next_job()                — reclama UN job QUEUED con SKIP LOCKED
--      y lo pasa a RUNNING con attempt_count + 1.
--   4.  complete_job()                  — cierre exitoso; idempotente (si el job
--      ya no está RUNNING no hace nada y no falla).
--   5.  schedule_job_retry()            — LA LÓGICA DE TERMINACIÓN: si quedan
--      intentos vuelve a QUEUED con available_at futuro; si no, FAILED. Nunca
--      existe un estado donde un job espere sin que nadie lo reclame.
--   6.  fail_job_permanent()            — fallo definitivo desde RUNNING o QUEUED.
--   7.  record_job_artifact()           — escritura idempotente del artefacto de
--      un job (ON CONFLICT sobre UNIQUE (job_id, artifact_type)).
--   8.  delete_audit()                  — ÚNICA vía de borrado de una auditoría:
--      exige sesión, exige creador u OWNER, y escribe la bitácora antes de
--      borrar.
--   9.  sweep_stale_operations()        — la barredora: cierra jobs, tool_calls
--      y audit_runs que superaron su timeout. Es lo que hace cierto el
--      invariante "todo job termina en SUCCEEDED o FAILED".
--
-- -----------------------------------------------------------------------------
-- INVARIANTES QUE ESTA LÍNEA BASE DEFINE (AGENTS.md)
-- -----------------------------------------------------------------------------
--   - PRESERVE_MACHINE_DECISION -> guard_audit_run_immutability() + sección 8,
--     que convierte la inmutabilidad en un fallo de migración si desaparece.
--   - TRACE_EVERY_DECISION     -> audit_results + tool_executions + ai_call_log
--     son la traza durable de quién decidió qué, con qué prompt y con qué modelo.
--   - NO_PROCESS_LOCAL_DURABILITY -> todo job tiene timeout_at explícito y
--     sweep_stale_operations() es la única vía de salida de un job colgado.
--   - DO_NOT_DUPLICATE_IMPLEMENTATIONS -> la escritura de la cola, del artefacto
--     y del borrado de auditoría pasa por RPC SECURITY DEFINER; las políticas
--     RLS de INSERT quedan sin efecto para el rol de cliente a propósito.
--   - SECURITY DEFINER, sin agujeros por defecto -> toda función SECURITY
--     DEFINER tiene REVOKE ALL ... FROM PUBLIC y FROM anon antes de su GRANT.
--     Postgres da EXECUTE a PUBLIC en toda función nueva: sin ese REVOKE, un
--     cliente anónimo podría encolar jobs, reclamar jobs de la cola global,
--     cerrar los runs de cualquiera y borrar auditorías.
--
-- -----------------------------------------------------------------------------
-- ORDEN DE EJECUCIÓN (verificado al final del archivo, sección 8)
-- -----------------------------------------------------------------------------
--   0. Extensión pgcrypto.
--   1. Identidad, auditoría, bitácora, comentarios y evidencias.
--   2. La cola: jobs, job_artifacts, job_attempts.
--   3. El dictamen: audit_runs, tool_executions, audit_results, ai_call_log.
--   4. Funciones de apoyo y disparadores de updated_at.
--   5. RLS y privilegios de tabla.
--   6. Las nueve funciones de la línea base.
--   7. Privilegios de las funciones.
--   8. Verificación: la migración falla AQUÍ, y no en un informe tres fases
--      después, si el esquema no quedó como se acaba de describir.
-- =============================================================================


-- =============================================================================
-- SECCIÓN 0 — Prerrequisitos
--
-- pgcrypto aporta gen_random_uuid() en PostgreSQL 12 y anteriores; a partir de
-- 13 es una función del catálogo, pero el IF NOT EXISTS no cuesta nada y deja el
-- archivo válido en ambos casos.
-- =============================================================================
CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- =============================================================================
-- SECCIÓN 1 — Identidad, auditoría, bitácora, comentarios y evidencias
-- =============================================================================

-- 1.1 profiles: el rol es lo único que separa a un auditor de un OWNER, y
--     current_app_role() lo lee de aquí. La FK a auth.users es la que ata un
--     perfil a una identidad real de la plataforma.
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'AUDITOR' CHECK (role IN ('AUDITOR', 'OWNER')),
  display_name text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 1.2 audits: la raíz del agregado. created_by es NOT NULL y sin valor por
--     defecto: una auditoría sin autor no tiene a quién atribuirla, y el modelo
--     entero (RLS incluido) descansa en que siempre lo tiene.
--
--     ESTADO: 'READY' desapareció y aparece 'NEEDS_INPUT'. READY significaba
--     "evidencias cargadas, esperando decisión", que era un estado que ningún
--     proceso leía y que se confundía con "todo va bien". NEEDS_INPUT significa
--     "la IA no pudo decidir con la evidencia disponible y hace falta
--     intervención humana", que es la distinción que hace falta de verdad. No
--     tiene traducción honesta: READY no afirmaba que nada se hubiera evaluado,
--     así que las filas en READY iban a FAILED, no a NEEDS_INPUT.
CREATE TABLE IF NOT EXISTS public.audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'DRAFT'
    CHECK (status IN ('DRAFT','PROCESSING','COMPLETED','NEEDS_INPUT','FAILED')),
  external_case_id text,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  display_name text,
  class_start_date date,
  ticket_start_at timestamptz,
  student_name text,
  student_enrollment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- DELETE sobre audits está REVOKEADO en la sección 5: el único camino para borrar
-- una auditoría es public.delete_audit(), que escribe la bitácora antes.

-- 1.3 audit_log: la bitácora. APPEND-ONLY y con ON DELETE SET NULL, que es lo
--     que hace público.delete_audit() honesto: la entrada que registra el borrado
--     sobrevive al borrado, con audit_id a NULL, en vez de desaparecer con la
--     fila que documenta.
CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES public.audits(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  actor_id uuid REFERENCES auth.users(id),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS audit_log_audit_idx ON public.audit_log (audit_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS audit_log_event_idx ON public.audit_log (event_type, occurred_at DESC);

-- 1.4 audit_manual_comments: los cuatro comentarios manuales, uno por fila y por
--     auditoría. UNIQUE en audit_id: el comentario es único por su naturaleza
--     (es un campo de un formulario), no un hilo de discusión.
CREATE TABLE IF NOT EXISTS public.audit_manual_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL UNIQUE REFERENCES public.audits(id) ON DELETE CASCADE,
  back_office_comment text,
  helpdesk_comment text,
  school_services_comment text,
  finance_comment text,
  additional_comment text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id)
);

-- 1.5 evidences: los archivos del expediente.
--
--     La separación status / content_status es deliberada y es la decisión de
--     modelo más importante de esta tabla: `status` es el estado de
--     ALMACENAMIENTO (¿está el archivo en storage?) y `content_status` es el de
--     CONTENIDO (¿se pudo extraer su texto y estructura?). Con una sola columna
--     no se puede expresar "el PDF está subido pero su extracción espera a un
--     proveedor externo", que es el caso más común de un pipeline real.
--
--     kind sustituye al antiguo `document_role`/`tipo` como respuesta a "¿qué es
--     este archivo?"; `content_error` sustituye a `failure_reason` y a
--     `extraccion`, y explica el fallo en texto legible en vez de guardarlo en
--     jsonb sin contrato.
--
--     NO hay columna `retired_at`/`retired_by`: la retirada de evidencia no es
--     una operación de este producto. Y NO se indexa UNIQUE en
--     (audit_id, sha256): la deduplicación la decide la aplicación, que además
--     necesita poder cargar el mismo archivo dos veces si el usuario cambia de
--     clasificación. Declararlo UNIQUE convertiría un requisito de aplicación
--     en un 23505 opaco en el momento del upload.
CREATE TABLE IF NOT EXISTS public.evidences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  nombre_archivo text NOT NULL,
  tipo text NOT NULL,
  kind text NOT NULL DEFAULT 'DOCUMENT'
    CHECK (kind IN ('PDF','IMAGE','AUDIO','TEXT','SPREADSHEET','DOCUMENT')),
  storage_bucket text NOT NULL DEFAULT 'dictamen-evidencias',
  storage_key text,
  storage_url text,
  mime_type text,
  detected_mime_type text,
  size_bytes bigint,
  sha256 text,
  original_filename text,
  safe_filename text,
  status text NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING','STORED','FAILED')),
  content_status text NOT NULL DEFAULT 'PENDING'
    CHECK (content_status IN ('PENDING','READY','FAILED','WAITING_EXTERNAL')),
  content_error text,
  uploaded_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS evidences_audit_id_created_at_idx ON public.evidences (audit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS evidences_storage_lookup_idx ON public.evidences (storage_bucket, storage_key);
CREATE INDEX IF NOT EXISTS evidences_sha256_idx ON public.evidences (sha256);
CREATE INDEX IF NOT EXISTS evidences_sha256_audit_idx ON public.evidences (audit_id, sha256);
CREATE INDEX IF NOT EXISTS evidences_content_status_idx ON public.evidences (content_status)
  WHERE content_status <> 'READY';


-- =============================================================================
-- SECCIÓN 2 — La cola
--
-- MODELO DE ESTADOS: cuatro, y sólo cuatro.
--   QUEUED -> RUNNING -> SUCCEEDED
--                    -> QUEUED  (reintento, con available_at futuro)
--                    -> FAILED   (definitivo)
-- No existe RETRY_SCHEDULED. Un reintento no es un estado, es un QUEUED con
-- fecha: así no hay ningún estado en el que un job pueda quedarse esperando sin
-- que nadie lo reclame ni lo barra, y por tanto cada job acaba en SUCCEEDED o en
-- FAILED. RETRY_SCHEDULED era exactamente ese estado trampa.
--
-- TIMEOUT: `timeout_at` es la única garantía de terminación. No hay lease
-- renovable: si el worker muere, el job se queda RUNNING hasta que
-- sweep_stale_operations() lo marca FAILED con JOB_TIMEOUT. Un reintento
-- posterior es un enqueue nuevo con OTRA idempotency_key, no un reclamo de un job
-- muerto.
--
-- IDEMPOTENCIA: `idempotency_key` es UNIQUE global, no (scope, key). Un job es
-- una operación lógica, y la clave que la identifica es global.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES public.audits(id) ON DELETE CASCADE,
  job_type text NOT NULL CHECK (job_type IN ('EVIDENCE_PROCESSING','AUDIO_TRANSCRIPTION','AUDIT_RUN')),
  operation_scope text NOT NULL,
  idempotency_key text NOT NULL UNIQUE,
  input_fingerprint text NOT NULL DEFAULT '',
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  evidence_id uuid,
  status text NOT NULL DEFAULT 'QUEUED' CHECK (status IN ('QUEUED','RUNNING','SUCCEEDED','FAILED')),
  progress integer NOT NULL DEFAULT 0,
  attempt_count integer NOT NULL DEFAULT 0,
  max_attempts integer NOT NULL DEFAULT 2 CHECK (max_attempts BETWEEN 1 AND 2),
  last_error_code text,
  last_error_message_sanitized text,
  available_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  timeout_at timestamptz
);

CREATE INDEX IF NOT EXISTS jobs_claim_idx ON public.jobs (status, available_at) WHERE status = 'QUEUED';
CREATE INDEX IF NOT EXISTS jobs_audit_idx ON public.jobs (audit_id, created_at DESC);
CREATE INDEX IF NOT EXISTS jobs_timeout_idx ON public.jobs (status, timeout_at);

-- job_artifacts conserva la forma de result / content_sha256 que la aplicación ya
-- lee, y tiene UNIQUE (job_id, artifact_type): es lo que hace idempotente
-- public.record_job_artifact(). Sin ese UNIQUE, un reintento del worker insertaría
-- un segundo artifact del mismo tipo y el lector no podría saber cuál es el bueno.
CREATE TABLE IF NOT EXISTS public.job_artifacts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  evidence_id uuid,
  artifact_type text NOT NULL,
  result jsonb NOT NULL DEFAULT '{}'::jsonb,
  content_sha256 text,
  extractor_version text,
  provider text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT job_artifacts_job_type_identity UNIQUE (job_id, artifact_type)
);

CREATE INDEX IF NOT EXISTS job_artifacts_job_idx ON public.job_artifacts (job_id);
CREATE INDEX IF NOT EXISTS job_artifacts_evidence_idx ON public.job_artifacts (evidence_id, created_at DESC);

-- job_attempts es el ledger de intentos. Es lo que da duración real a p_worker_id:
-- sin columna de lease en jobs, "quién estuvo tocando este job y cuánto tardó"
-- se consulta aquí.
CREATE TABLE IF NOT EXISTS public.job_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id uuid NOT NULL REFERENCES public.jobs(id) ON DELETE CASCADE,
  attempt_number integer NOT NULL,
  worker_id text NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  outcome text CHECK (outcome IN ('SUCCEEDED','FAILED_TRANSIENT','FAILED_PERMANENT','CANCELLED','CRASHED')),
  error_code text,
  error_message_sanitized text,
  UNIQUE (job_id, attempt_number)
);

CREATE INDEX IF NOT EXISTS job_attempts_job_idx ON public.job_attempts (job_id, attempt_number DESC);


-- =============================================================================
-- SECCIÓN 3 — El dictamen
-- =============================================================================

-- 3.1 audit_runs: la unidad de trabajo y de trazabilidad de un dictamen. Un run
--     es un intento, y su estado terminal es irreversible.
CREATE TABLE IF NOT EXISTS public.audit_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  run_number integer NOT NULL,
  status text NOT NULL DEFAULT 'CREATED'
    CHECK (status IN ('CREATED','PROCESSING_EVIDENCE','ANALYZING','REVIEWING','COMPLETED','NEEDS_INPUT','FAILED')),
  evidence_fingerprint text NOT NULL DEFAULT '',
  policy_code text,
  policy_version text,
  policy_source_sha256 text,
  analyst_model text,
  analyst_prompt_version text,
  reviewer_model text,
  reviewer_prompt_version text,
  policy_sections_consulted text[] NOT NULL DEFAULT '{}'::text[],
  tool_call_count integer NOT NULL DEFAULT 0,
  agent_step_count integer NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  created_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  UNIQUE (audit_id, run_number)
);

CREATE INDEX IF NOT EXISTS audit_runs_audit_idx ON public.audit_runs (audit_id, run_number DESC);
CREATE INDEX IF NOT EXISTS audit_runs_status_idx ON public.audit_runs (status)
  WHERE status NOT IN ('COMPLETED','NEEDS_INPUT','FAILED');

-- 3.2 Inmutabilidad del run terminal. Ésta es la barrera (C) de AGENTS.md: se
--     ejecuta incluso para el propietario de la tabla, que es lo que realmente
--     hace irreversible un run terminal. Sin ella, un DDL, un GRANT accidental o
--     un sweep mal escrito podrían reescribir el dictamen ya emitido
--     (PRESERVE_MACHINE_DECISION).
--
--     Las dos comprobaciones se complementan:
--       1) OLD terminal -> aborta SIEMPRE. Ningún UPDATE, ni siquiera uno que no
--          toque `status`.
--       2) NEW no terminal y OLD no terminal conocido -> aborta. Cierra la
--          transición desde un origen inesperado en vez de dejarla pasar.
--
--     El search_path queda fijado (pg_catalog primero) aunque la función no sea
--     SECURITY DEFINER: es la convención del resto del archivo y no cambia nada
--     del comportamiento descrito arriba.
CREATE OR REPLACE FUNCTION public.guard_audit_run_immutability()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD.status IN ('COMPLETED','NEEDS_INPUT','FAILED') THEN
    RAISE EXCEPTION 'AUDIT_RUN_TERMINAL_IMMUTABLE: run % está en estado terminal % y no puede modificarse', OLD.id, OLD.status
      USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.status NOT IN ('COMPLETED','NEEDS_INPUT','FAILED')
     AND OLD.status NOT IN ('CREATED','PROCESSING_EVIDENCE','ANALYZING','REVIEWING') THEN
    RAISE EXCEPTION 'AUDIT_RUN_ILLEGAL_TRANSITION: % -> %', OLD.status, NEW.status;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS audit_runs_terminal_guard ON public.audit_runs;
CREATE TRIGGER audit_runs_terminal_guard
  BEFORE UPDATE ON public.audit_runs
  FOR EACH ROW EXECUTE FUNCTION public.guard_audit_run_immutability();

-- 3.3 tool_executions: la traza de cada llamada del agente. `kind` separa de qué
--     tipo de fuente salió la llamada (evidencia, política, caso, audio, visión,
--     base de datos) para poder costear y auditar por origen sin parsear el
--     input. La UNIQUE (audit_id, idempotency_key) impide que un reintento del
--     agente cree una segunda ejecución de la misma operación lógica.
CREATE TABLE IF NOT EXISTS public.tool_executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.audit_runs(id) ON DELETE CASCADE,
  name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('EVIDENCE','POLICY','CASE','AUDIO','VISION','DATABASE')),
  status text NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','RUNNING','WAITING_EXTERNAL','SUCCEEDED','FAILED')),
  input jsonb NOT NULL DEFAULT '{}'::jsonb,
  output jsonb,
  idempotency_key text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  error_code text,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  finished_at timestamptz,
  timeout_at timestamptz,
  UNIQUE (audit_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS tool_executions_run_idx ON public.tool_executions (run_id, created_at);
CREATE INDEX IF NOT EXISTS tool_executions_open_idx ON public.tool_executions (status, timeout_at)
  WHERE status IN ('PENDING','RUNNING','WAITING_EXTERNAL');

-- 3.4 audit_results: un resultado por run (UNIQUE en run_id), y dentro del run
--     una fila por etapa. `stage` distingue quién dictaminó: ANALYST (primera
--     pasada), REVIEWER (segunda pasada sobre la misma evidencia) y FINAL (el
--     dictamen que se entrega). La restricción de estado exige que un resultado
--     COMPLETED tenga clasificación: un dictamen sin clasificación no es un
--     dictamen, y eso no se decide en la aplicación sino aquí.
CREATE TABLE IF NOT EXISTS public.audit_results (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid NOT NULL REFERENCES public.audits(id) ON DELETE CASCADE,
  run_id uuid NOT NULL UNIQUE REFERENCES public.audit_runs(id) ON DELETE CASCADE,
  stage text NOT NULL CHECK (stage IN ('ANALYST','REVIEWER','FINAL')),
  status text NOT NULL CHECK (status IN ('COMPLETED','NEEDS_INPUT','FAILED')),
  classification text CHECK (classification IN ('CANCELACION_VENTA','BAJA','CANCELACION_VENTA_OPERATIVA','DICTAMINACION')),
  summary text NOT NULL DEFAULT '',
  assessment jsonb NOT NULL DEFAULT '{}'::jsonb,
  review jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT audit_results_status_classification_check
    CHECK (status <> 'COMPLETED' OR classification IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS audit_results_audit_idx ON public.audit_results (audit_id, created_at DESC);

-- 3.5 ai_call_log: telemetría de coste y de latencia por llamada de modelo.
--
--     APPEND-ONLY. En la sección 5 se otorgan SELECT e INSERT y NADA MÁS: un
--     UPDATE sobre un gasto ya registrado permite reescribir el coste que se
--     imputó, que es el mismo objetivo que tendría quien manipulase la
--     contabilidad. Si un dato de coste está mal, se corrige con una fila de
--     ajuste y una nota, no editando la original.
--
--     estimated_cost_usd admite NULL a propósito: NULL significa "no lo sé" y 0
--     significa "lo sé y fue gratis". Son cosas distintas y confundirlas es como
--     se esconde un gasto.
CREATE TABLE IF NOT EXISTS public.ai_call_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_id uuid REFERENCES public.audits(id) ON DELETE CASCADE,
  run_id uuid REFERENCES public.audit_runs(id) ON DELETE CASCADE,
  provider text NOT NULL,
  model text NOT NULL,
  purpose text NOT NULL,
  input_tokens integer,
  output_tokens integer,
  estimated_cost_usd numeric(12,6),
  latency_ms integer,
  error_code text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS ai_call_log_run_idx ON public.ai_call_log (run_id, created_at);
CREATE INDEX IF NOT EXISTS ai_call_log_cost_idx ON public.ai_call_log (created_at, estimated_cost_usd);


-- =============================================================================
-- SECCIÓN 4 — Funciones de apoyo y disparadores
--
-- Estas dos no son capacidad, son infraestructura, y por eso no están en la
-- lista de las nueve: set_updated_at mantiene updated_at honesto sin que cada
-- tabla repita la lógica, y current_app_role() evita la recursión de políticas
-- (una política de SELECT sobre audits que leyera profiles, cuya política de
-- SELECT leyera audits otra vez, no termina nunca).
--
-- current_app_role() ES SECURITY DEFINER y por eso le aplica la regla de la
-- sección 7: REVOKE ALL FROM PUBLIC y FROM anon antes de otorgarla. Sin ese
-- REVOKE, el privilegio por defecto de Postgres dejaría la función ejecutable
-- por cualquiera, y una función SECURITY DEFINER ejecutable por cualquiera es
-- un agujero del tamaño de la propia función.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.current_app_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()
$$;

DROP TRIGGER IF EXISTS profiles_set_updated_at ON public.profiles;
CREATE TRIGGER profiles_set_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS audits_set_updated_at ON public.audits;
CREATE TRIGGER audits_set_updated_at
  BEFORE UPDATE ON public.audits
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS evidences_set_updated_at ON public.evidences;
CREATE TRIGGER evidences_set_updated_at
  BEFORE UPDATE ON public.evidences
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

DROP TRIGGER IF EXISTS audit_manual_comments_set_updated_at ON public.audit_manual_comments;
CREATE TRIGGER audit_manual_comments_set_updated_at
  BEFORE UPDATE ON public.audit_manual_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();


-- =============================================================================
-- SECCIÓN 5 — RLS y privilegios de tabla
--
-- Patrón único en todas las tablas que cuelgan de una auditoría: el cliente sólo
-- ve y escribe dentro de las auditorías que puede ver (las que creó, o todas si
-- es OWNER).
--
-- Las tablas de la COLA siguen otro patrón a propósito: conservan la política de
-- SELECT para poder depurar, pero NO tienen política de INSERT ni de UPDATE, así
-- que la RLS deniega la escritura aunque el privilegio de tabla lo conceda. Crear,
-- reclamar y cerrar pasan por enqueue_job, claim_next_job, complete_job,
-- schedule_job_retry, fail_job_permanent y record_job_artifact, que son
-- SECURITY DEFINER. Así el rol de cliente no puede encolar jobs ni artefactos por
-- su cuenta (DO_NOT_DUPLICATE_IMPLEMENTATIONS aplicado también a la ACL, no sólo
-- al código).
-- =============================================================================

-- Primero se le quitan permisos a anon en las doce tablas. Una instalación limpia no
-- necesita dar acceso a ninguna de ellas al rol anónimo, y heredarlo de los
-- privilegios por defecto de la plataforma sería una superficie que nadie pidió.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'profiles','audits','audit_log','audit_manual_comments','evidences',
    'jobs','job_attempts','job_artifacts',
    'audit_runs','tool_executions','audit_results','ai_call_log'
  ] LOOP
    EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon', t);
  END LOOP;
END $$;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_manual_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.evidences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.job_artifacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tool_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_call_log ENABLE ROW LEVEL SECURITY;

-- Privilegios de tabla. La ausencia de un privilegio ES la decisión:
--   - DELETE sobre audits: revocado a propósito, el único camino es delete_audit().
--   - UPDATE/DELETE sobre audit_log: es una bitácora, se añade, no se corrige.
--   - UPDATE/DELETE sobre ai_call_log: es un log de coste, ver 3.5.
GRANT SELECT, INSERT, UPDATE ON public.profiles TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.audits TO authenticated;
GRANT SELECT, INSERT ON public.audit_log TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.audit_manual_comments TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.evidences TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.jobs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.job_attempts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.job_artifacts TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.audit_runs TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.tool_executions TO authenticated;
GRANT SELECT, INSERT, UPDATE ON public.audit_results TO authenticated;
GRANT SELECT, INSERT ON public.ai_call_log TO authenticated;

-- El GRANT de arriba es una lista explícita y no otorga lo que no nombra, así
-- que estas REVOKE son la redundancia que protege de los privilegios por
-- defecto de la plataforma: si InsForge los trajera, el borrado de una
-- auditoría dejaría de pasar por delete_audit() y de dejar bitácora.
REVOKE DELETE ON public.audits FROM anon, authenticated;
REVOKE UPDATE, DELETE ON public.audit_log FROM anon, authenticated;
REVOKE UPDATE, DELETE ON public.ai_call_log FROM anon, authenticated;

-- ------------------------------------------------------------------ profiles --
DROP POLICY IF EXISTS profiles_select_own_or_owner ON public.profiles;
CREATE POLICY profiles_select_own_or_owner ON public.profiles
  FOR SELECT TO authenticated
  USING (id = auth.uid() OR public.current_app_role() = 'OWNER');

DROP POLICY IF EXISTS profiles_insert_own ON public.profiles;
CREATE POLICY profiles_insert_own ON public.profiles
  FOR INSERT TO authenticated
  WITH CHECK (id = auth.uid());

DROP POLICY IF EXISTS profiles_update_own_or_owner ON public.profiles;
CREATE POLICY profiles_update_own_or_owner ON public.profiles
  FOR UPDATE TO authenticated
  USING (id = auth.uid() OR public.current_app_role() = 'OWNER')
  WITH CHECK (id = auth.uid() OR public.current_app_role() = 'OWNER');

-- -------------------------------------------------------------------- audits --
DROP POLICY IF EXISTS audits_select_own_or_owner ON public.audits;
CREATE POLICY audits_select_own_or_owner ON public.audits
  FOR SELECT TO authenticated
  USING (created_by = auth.uid() OR public.current_app_role() = 'OWNER');

DROP POLICY IF EXISTS audits_insert_own ON public.audits;
CREATE POLICY audits_insert_own ON public.audits
  FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid());

DROP POLICY IF EXISTS audits_update_own_or_owner ON public.audits;
CREATE POLICY audits_update_own_or_owner ON public.audits
  FOR UPDATE TO authenticated
  USING (created_by = auth.uid() OR public.current_app_role() = 'OWNER')
  WITH CHECK (created_by = auth.uid() OR public.current_app_role() = 'OWNER');

-- ----------------------------------------------------------------- audit_log --
-- audit_id IS NULL: una entrada de bitácora que ya no cuelga de ninguna
-- auditoría (el caso real es AUDIT_DELETED) es visible para cualquier
-- autenticado, porque la política de SELECT de audits ya no puede arbitrar
-- sobre una fila cuya auditoría no existe.
DROP POLICY IF EXISTS audit_log_select_for_visible_audits ON public.audit_log;
CREATE POLICY audit_log_select_for_visible_audits ON public.audit_log
  FOR SELECT TO authenticated
  USING (
    audit_id IS NULL OR EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = audit_log.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  );

DROP POLICY IF EXISTS audit_log_insert_self ON public.audit_log;
CREATE POLICY audit_log_insert_self ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (actor_id = auth.uid());

-- ---------------------------------------------------- audit_manual_comments --
DROP POLICY IF EXISTS audit_manual_comments_select_visible ON public.audit_manual_comments;
CREATE POLICY audit_manual_comments_select_visible ON public.audit_manual_comments
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = audit_manual_comments.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  );

-- El INSERT exige(created_by) real Y que el usuario sea el creador de la
-- auditoría: un OWNER puede leer y editar los comentarios de otro, pero no puede
-- escribir los suyos propios en la auditoría de otro. Se mantiene la asimetría
-- deliberada del original: escribir es un acto atribuible a un solo autor.
DROP POLICY IF EXISTS audit_manual_comments_insert_own_audit ON public.audit_manual_comments;
CREATE POLICY audit_manual_comments_insert_own_audit ON public.audit_manual_comments
  FOR INSERT TO authenticated
  WITH CHECK (
    updated_by = auth.uid() AND EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = audit_manual_comments.audit_id
        AND audits.created_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS audit_manual_comments_update_own_audit ON public.audit_manual_comments;
CREATE POLICY audit_manual_comments_update_own_audit ON public.audit_manual_comments
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = audit_manual_comments.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  )
  WITH CHECK (
    updated_by = auth.uid() AND EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = audit_manual_comments.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  );

-- ----------------------------------------------------------------- evidences --
DROP POLICY IF EXISTS evidences_select_for_visible_audits ON public.evidences;
CREATE POLICY evidences_select_for_visible_audits ON public.evidences
  FOR SELECT TO authenticated
  USING (
    audit_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = evidences.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  );

DROP POLICY IF EXISTS evidences_insert_for_own_audits ON public.evidences;
CREATE POLICY evidences_insert_for_own_audits ON public.evidences
  FOR INSERT TO authenticated
  WITH CHECK (
    uploaded_by = auth.uid()
    AND audit_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = evidences.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  );

DROP POLICY IF EXISTS evidences_update_for_visible_audits ON public.evidences;
CREATE POLICY evidences_update_for_visible_audits ON public.evidences
  FOR UPDATE TO authenticated
  USING (
    audit_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = evidences.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  )
  WITH CHECK (
    audit_id IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = evidences.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  );

-- ---------------------------------------------------------------------- jobs --
DROP POLICY IF EXISTS jobs_select_for_visible_audits ON public.jobs;
CREATE POLICY jobs_select_for_visible_audits ON public.jobs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = jobs.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  );

-- -------------------------------------------------------------- job_attempts --
DROP POLICY IF EXISTS job_attempts_select_for_visible_jobs ON public.job_attempts;
CREATE POLICY job_attempts_select_for_visible_jobs ON public.job_attempts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs
      JOIN public.audits ON audits.id = jobs.audit_id
      WHERE jobs.id = job_attempts.job_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  );

-- ------------------------------------------------------------- job_artifacts --
DROP POLICY IF EXISTS job_artifacts_select_for_visible_jobs ON public.job_artifacts;
CREATE POLICY job_artifacts_select_for_visible_jobs ON public.job_artifacts
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs
      JOIN public.audits ON audits.id = jobs.audit_id
      WHERE jobs.id = job_artifacts.job_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  );

-- El UPDATE del artifact lo necesita el worker al releer su propio resultado.
-- a authenticated, y sólo dentro de las auditorías visibles.
DROP POLICY IF EXISTS job_artifacts_update_for_visible_jobs ON public.job_artifacts;
CREATE POLICY job_artifacts_update_for_visible_jobs ON public.job_artifacts
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.jobs
      JOIN public.audits ON audits.id = jobs.audit_id
      WHERE jobs.id = job_artifacts.job_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.jobs
      JOIN public.audits ON audits.id = jobs.audit_id
      WHERE jobs.id = job_artifacts.job_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  );

-- --------------------------------------------------------------- audit_runs --
DROP POLICY IF EXISTS audit_runs_select_for_visible_audits ON public.audit_runs;
CREATE POLICY audit_runs_select_for_visible_audits ON public.audit_runs
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = audit_runs.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  );

-- El INSERT lleva las DOS condiciones, no sólo created_by = auth.uid(): con sólo
-- la primera, un auditor podría colgar un run de una auditoría ajena
-- declarándose autor (la fila quedaría oculta para él por la política de SELECT,
-- pero existiría).
DROP POLICY IF EXISTS audit_runs_insert_for_visible_audits ON public.audit_runs;
CREATE POLICY audit_runs_insert_for_visible_audits ON public.audit_runs
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = audit_runs.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  );

DROP POLICY IF EXISTS audit_runs_update_for_visible_audits ON public.audit_runs;
CREATE POLICY audit_runs_update_for_visible_audits ON public.audit_runs
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = audit_runs.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = audit_runs.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  );

-- ---------------------------------------------------------- tool_executions --
DROP POLICY IF EXISTS tool_executions_select_for_visible_audits ON public.tool_executions;
CREATE POLICY tool_executions_select_for_visible_audits ON public.tool_executions
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = tool_executions.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  );

DROP POLICY IF EXISTS tool_executions_insert_for_visible_audits ON public.tool_executions;
CREATE POLICY tool_executions_insert_for_visible_audits ON public.tool_executions
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = tool_executions.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  );

DROP POLICY IF EXISTS tool_executions_update_for_visible_audits ON public.tool_executions;
CREATE POLICY tool_executions_update_for_visible_audits ON public.tool_executions
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = tool_executions.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = tool_executions.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  );

-- ------------------------------------------------------------ audit_results --
DROP POLICY IF EXISTS audit_results_select_for_visible_audits ON public.audit_results;
CREATE POLICY audit_results_select_for_visible_audits ON public.audit_results
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = audit_results.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  );

DROP POLICY IF EXISTS audit_results_insert_for_visible_audits ON public.audit_results;
CREATE POLICY audit_results_insert_for_visible_audits ON public.audit_results
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = audit_results.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  );

DROP POLICY IF EXISTS audit_results_update_for_visible_audits ON public.audit_results;
CREATE POLICY audit_results_update_for_visible_audits ON public.audit_results
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = audit_results.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = audit_results.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  );

-- --------------------------------------------------------------- ai_call_log --
-- La EXISTS es estricta, sin la cláusula `audit_id IS NULL OR ...` que sí usa
-- audit_log_select_for_visible_audits. Consecuencia asumida y deliberada: una
-- fila con audit_id NULL no es escribible ni legible por `authenticated` (la WITH
-- CHECK la rechaza), porque una llamada de modelo sin auditoría a la que
-- atribuírsela no se puede auditar. Si el pipeline necesita registrar llamadas
-- huérfanas, tiene que pasar por service_role, no por el JWT de un auditor.
DROP POLICY IF EXISTS ai_call_log_select_for_visible_audits ON public.ai_call_log;
CREATE POLICY ai_call_log_select_for_visible_audits ON public.ai_call_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = ai_call_log.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  );

DROP POLICY IF EXISTS ai_call_log_insert_for_visible_audits ON public.ai_call_log;
CREATE POLICY ai_call_log_insert_for_visible_audits ON public.ai_call_log
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.audits
      WHERE audits.id = ai_call_log.audit_id
        AND (audits.created_by = auth.uid() OR public.current_app_role() = 'OWNER')
    )
  );


-- =============================================================================
-- SECCIÓN 6 — Las nueve funciones
--
-- Todas las de antes de la última son SECURITY DEFINER con el search_path fijado
-- en pg_catalog, public, pg_temp (pg_catalog PRIMERO: es lo que impide que un
-- objeto del esquema público ensombrezca una función del catálogo y sea ejecutada
-- en su lugar). Los privilegios se dan en la sección 7, no aquí.
-- =============================================================================

-- 6.1 enqueue_job: alta idempotente de un job.
--
-- Semántica de la reactivación, que es lo no trivial:
--   SUCCEEDED                       -> se devuelve tal cual. Un job que ya
--                                      terminó bien NO se reabre: repetir el
--                                      análisis de un caso ya dictamenado
--                                      cobraría dos veces por lo mismo.
--   FAILED e input_fingerprint IGUAL -> se devuelve sin cambios. Es el mismo
--                                      input que ya falló; reintentarlo es la
--                                      decisión del worker, no de quien encola.
--   FAILED e input_fingerprint NUEVO -> reactiva a QUEUED, attempt_count 0,
--                                      available_at now(). La evidencia cambió,
--                                      así que es OTRO trabajo y merece otro
--                                      ciclo de vida, conservando la trazabilidad
--                                      de que hubo un intento anterior.
--   Sin fila previa                  -> INSERT.
--
-- El `IF NOT FOUND` del final no puede darse: ON CONFLICT DO UPDATE siempre
-- devuelve fila. Se mantiene la aserción por si alguien cambiara el ON CONFLICT.
CREATE OR REPLACE FUNCTION public.enqueue_job(
  p_audit_id uuid,
  p_job_type text,
  p_operation_scope text,
  p_idempotency_key text,
  p_input_fingerprint text,
  p_payload jsonb DEFAULT '{}'::jsonb,
  p_evidence_id uuid DEFAULT NULL,
  p_max_attempts integer DEFAULT 2,
  p_actor_id uuid DEFAULT NULL
)
RETURNS public.jobs
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_job public.jobs;
  v_prev public.jobs;
  v_reactivated boolean := false;
BEGIN
  IF p_audit_id IS NULL THEN
    RAISE EXCEPTION 'JOB_AUDIT_ID_REQUIRED';
  END IF;
  IF btrim(COALESCE(p_idempotency_key, '')) = '' THEN
    RAISE EXCEPTION 'JOB_IDEMPOTENCY_KEY_REQUIRED';
  END IF;
  -- max_attempts tiene un CHECK BETWEEN 1 AND 2 en la tabla. Sin esta
  -- pre-comprobación el llamador recibe un 23514 opaco que no dice qué parámetro
  -- falló ni por qué ese valor es inválido.
  IF p_max_attempts IS NULL OR p_max_attempts NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION 'JOB_MAX_ATTEMPTS_INVALID: % (sólo 1 o 2)', p_max_attempts;
  END IF;

  -- Estado previo de la fila, sólo para poder distinguir en la bitácora un alta
  -- nueva de una reactivación. El INSERT sigue mandando por el ON CONFLICT.
  SELECT * INTO v_prev
  FROM public.jobs
  WHERE idempotency_key = p_idempotency_key;

  INSERT INTO public.jobs (
    audit_id, job_type, operation_scope, idempotency_key, input_fingerprint,
    payload, evidence_id, max_attempts
  )
  VALUES (
    p_audit_id, p_job_type, p_operation_scope, p_idempotency_key,
    COALESCE(p_input_fingerprint, ''), COALESCE(p_payload, '{}'::jsonb),
    p_evidence_id, p_max_attempts
  )
  ON CONFLICT (idempotency_key) DO UPDATE SET
    -- Se reactiva SÓLO en el caso de la especificación: FAILED con
    -- input_fingerprint distinto. En los demás casos (SUCCEEDED, FAILED con el
    -- mismo fingerprint, y también QUEUED o RUNNING en curso) TODAS las columnas
    -- se dejan como están. Si el ON CONFLICT escribiera payload/evidence_id/
    -- max_attempts/input_fingerprint en general, un enqueue duplicado pisaría el
    -- trabajo de un job que ya está corriendo, y un fingerprint igual dejaría de
    -- ser idempotente de verdad: el job se modificaría sin querer.
    status = CASE
      WHEN public.jobs.status = 'FAILED'
           AND public.jobs.input_fingerprint <> EXCLUDED.input_fingerprint THEN 'QUEUED'
      ELSE public.jobs.status
    END,
    input_fingerprint = CASE
      WHEN public.jobs.status = 'FAILED'
           AND public.jobs.input_fingerprint <> EXCLUDED.input_fingerprint THEN EXCLUDED.input_fingerprint
      ELSE public.jobs.input_fingerprint
    END,
    payload = CASE
      WHEN public.jobs.status = 'FAILED'
           AND public.jobs.input_fingerprint <> EXCLUDED.input_fingerprint THEN EXCLUDED.payload
      ELSE public.jobs.payload
    END,
    evidence_id = CASE
      WHEN public.jobs.status = 'FAILED'
           AND public.jobs.input_fingerprint <> EXCLUDED.input_fingerprint THEN EXCLUDED.evidence_id
      ELSE public.jobs.evidence_id
    END,
    max_attempts = CASE
      WHEN public.jobs.status = 'FAILED'
           AND public.jobs.input_fingerprint <> EXCLUDED.input_fingerprint THEN EXCLUDED.max_attempts
      ELSE public.jobs.max_attempts
    END,
    attempt_count = CASE
      WHEN public.jobs.status = 'FAILED'
           AND public.jobs.input_fingerprint <> EXCLUDED.input_fingerprint THEN 0
      ELSE public.jobs.attempt_count
    END,
    available_at = CASE
      WHEN public.jobs.status = 'FAILED'
           AND public.jobs.input_fingerprint <> EXCLUDED.input_fingerprint THEN now()
      ELSE public.jobs.available_at
    END,
    started_at = CASE
      WHEN public.jobs.status = 'FAILED'
           AND public.jobs.input_fingerprint <> EXCLUDED.input_fingerprint THEN NULL
      ELSE public.jobs.started_at
    END,
    finished_at = CASE
      WHEN public.jobs.status = 'FAILED'
           AND public.jobs.input_fingerprint <> EXCLUDED.input_fingerprint THEN NULL
      ELSE public.jobs.finished_at
    END,
    timeout_at = CASE
      WHEN public.jobs.status = 'FAILED'
           AND public.jobs.input_fingerprint <> EXCLUDED.input_fingerprint THEN NULL
      ELSE public.jobs.timeout_at
    END,
    last_error_code = CASE
      WHEN public.jobs.status = 'FAILED'
           AND public.jobs.input_fingerprint <> EXCLUDED.input_fingerprint THEN NULL
      ELSE public.jobs.last_error_code
    END,
    last_error_message_sanitized = CASE
      WHEN public.jobs.status = 'FAILED'
           AND public.jobs.input_fingerprint <> EXCLUDED.input_fingerprint THEN NULL
      ELSE public.jobs.last_error_message_sanitized
    END
  RETURNING * INTO v_job;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'JOB_ENQUEUE_FAILED';
  END IF;

  -- Reactivación = había fila, estaba FAILED y el fingerprint es otro. Un alta
  -- nueva y un job QUEUED que ya existía dan ambos status=QUEUED con
  -- attempt_count=0, así que el status del resultado NO sirve para distinguirlos.
  v_reactivated := (
    v_prev.id IS NOT NULL
    AND v_prev.status = 'FAILED'
    AND v_prev.input_fingerprint <> COALESCE(p_input_fingerprint, '')
  );

  INSERT INTO public.audit_log (audit_id, event_type, actor_id, metadata)
  VALUES (
    v_job.audit_id,
    CASE WHEN v_reactivated THEN 'JOB_REACTIVATED' ELSE 'JOB_QUEUED' END,
    p_actor_id,
    jsonb_build_object(
      'jobId', v_job.id,
      'jobType', v_job.job_type,
      'evidenceId', v_job.evidence_id,
      'status', v_job.status,
      'operationScope', v_job.operation_scope
    )
  );

  RETURN v_job;
END;
$$;

-- 6.2 claim_next_job: reclamo de UN job, con SKIP LOCKED.
--
-- `FOR UPDATE SKIP LOCKED` es lo que permite que dos workers concurrentes
-- reclamen dos jobs distintos sin serializarse y sin que ninguno reclame el
-- mismo. `timeout_at` es la garantía de terminación: si el worker muere, el job
-- no se queda en RUNNING para siempre, sino hasta que el sweep lo cierre.
--
-- `attempt_count + 1` y `started_at = COALESCE(started_at, now())` registran el
-- primer intento y conservan el inicio original del job aunque se reintente.
--
-- El registro en job_attempts es lo que da duración real a p_worker_id: sin
-- lease_owner en la tabla, el worker_id queda en el ledger de intentos, que es
-- donde se consulta "quién estuvo tocando este job".
--
-- Si no hay nada que reclamar devuelve NULL (jsonb), que es el análogo natural
-- del "RETURN sin fila" de la versión anterior.
CREATE OR REPLACE FUNCTION public.claim_next_job(
  p_worker_id text,
  p_lease_seconds integer DEFAULT 60
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_job public.jobs;
BEGIN
  IF btrim(COALESCE(p_worker_id, '')) = '' THEN
    RAISE EXCEPTION 'JOB_WORKER_ID_REQUIRED';
  END IF;
  IF p_lease_seconds IS NULL OR p_lease_seconds < 1 THEN
    RAISE EXCEPTION 'JOB_LEASE_SECONDS_INVALID: %', p_lease_seconds;
  END IF;

  WITH candidate AS (
    SELECT id
    FROM public.jobs
    WHERE status = 'QUEUED'
      AND available_at <= now()
    ORDER BY created_at
    LIMIT 1
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.jobs j
  SET status = 'RUNNING',
      attempt_count = j.attempt_count + 1,
      started_at = COALESCE(j.started_at, now()),
      timeout_at = now() + make_interval(secs => p_lease_seconds)
  FROM candidate
  WHERE j.id = candidate.id
  RETURNING j.* INTO v_job;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.job_attempts (job_id, attempt_number, worker_id)
  VALUES (v_job.id, v_job.attempt_count, p_worker_id)
  ON CONFLICT (job_id, attempt_number) DO NOTHING;

  INSERT INTO public.audit_log (audit_id, event_type, metadata)
  VALUES (
    v_job.audit_id,
    'JOB_STARTED',
    jsonb_build_object(
      'jobId', v_job.id,
      'jobType', v_job.job_type,
      'attempt', v_job.attempt_count,
      'workerId', p_worker_id
    )
  );

  RETURN jsonb_build_object(
    'job_id', v_job.id,
    'attempt_number', v_job.attempt_count,
    'audit_id', v_job.audit_id,
    'job_type', v_job.job_type,
    'payload', v_job.payload,
    'evidence_id', v_job.evidence_id,
    'attempt_count', v_job.attempt_count,
    'max_attempts', v_job.max_attempts,
    'timeout_at', v_job.timeout_at
  );
END;
$$;

-- 6.3 complete_job: cierre exitoso. Idempotente por diseño: si el job ya no
-- está RUNNING no hace nada y no lanza error, porque el worker puede haber muerto
-- después de escribir y alguien más haberlo cerrado ya.
CREATE OR REPLACE FUNCTION public.complete_job(
  p_job_id uuid,
  p_worker_id text,
  p_progress integer DEFAULT 100
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_job public.jobs;
BEGIN
  UPDATE public.jobs
  SET status = 'SUCCEEDED',
      progress = LEAST(GREATEST(COALESCE(p_progress, 100), 0), 100),
      finished_at = now(),
      timeout_at = NULL
  WHERE id = p_job_id
    AND status = 'RUNNING'
  RETURNING * INTO v_job;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.job_attempts
  SET finished_at = now(), outcome = 'SUCCEEDED'
  WHERE job_id = p_job_id
    AND worker_id = p_worker_id
    AND finished_at IS NULL;

  INSERT INTO public.audit_log (audit_id, event_type, metadata)
  VALUES (
    v_job.audit_id,
    'JOB_SUCCEEDED',
    jsonb_build_object('jobId', v_job.id, 'jobType', v_job.job_type, 'attempt', v_job.attempt_count)
  );
END;
$$;

-- 6.4 fail_job_permanent: fallo definitivo. Acepta RUNNING o QUEUED (un job que
-- nunca arrancó puede fallar por una precondición del handler). No reactiva
-- nada: el siguiente intento, si lo hay, es un enqueue nuevo.
CREATE OR REPLACE FUNCTION public.fail_job_permanent(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_message_sanitized text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_job public.jobs;
BEGIN
  UPDATE public.jobs
  SET status = 'FAILED',
      finished_at = now(),
      timeout_at = NULL,
      last_error_code = p_error_code,
      last_error_message_sanitized = left(COALESCE(p_error_message_sanitized, ''), 500)
  WHERE id = p_job_id
    AND status IN ('RUNNING','QUEUED')
  RETURNING * INTO v_job;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  UPDATE public.job_attempts
  SET finished_at = now(),
      outcome = 'FAILED_PERMANENT',
      error_code = p_error_code,
      error_message_sanitized = left(COALESCE(p_error_message_sanitized, ''), 500)
  WHERE job_id = p_job_id
    AND worker_id = p_worker_id
    AND finished_at IS NULL;

  INSERT INTO public.audit_log (audit_id, event_type, metadata)
  VALUES (
    v_job.audit_id,
    'JOB_FAILED',
    jsonb_build_object(
      'jobId', v_job.id, 'jobType', v_job.job_type,
      'attempt', v_job.attempt_count, 'errorCode', p_error_code
    )
  );
END;
$$;

-- 6.5 schedule_job_retry: LA LÓGICA DE TERMINACIÓN.
--
--   quedan intentos (attempt_count < max_attempts) -> QUEUED con available_at
--     futuro y timeout_at limpio. No queda ningún rastro de "estaba corriendo":
--     un reintento es un job que vuelve a la cola, no un job en un limbo.
--   no quedan intentos                                -> FAILED, finished_at,
--     timeout_at limpio.
--
-- En los dos casos la fila sale de RUNNING. Ése es el invariante: no existe
-- ningún camino por el que un job termine la sesión del worker sin quedar
-- terminal o pendiente de un reintento con fecha, y todo lo pendiente tiene
-- timeout_at NULL y será reclamado por el siguiente sweep del ciclo o por el
-- próximo claim. Por eso todo job acaba en SUCCEEDED o en FAILED.
CREATE OR REPLACE FUNCTION public.schedule_job_retry(
  p_job_id uuid,
  p_worker_id text,
  p_error_code text,
  p_error_message_sanitized text,
  p_delay_seconds integer DEFAULT 30
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_job public.jobs;
  v_retry boolean;
BEGIN
  IF p_delay_seconds IS NULL OR p_delay_seconds < 0 THEN
    RAISE EXCEPTION 'JOB_RETRY_DELAY_INVALID: %', p_delay_seconds;
  END IF;

  SELECT * INTO v_job
  FROM public.jobs
  WHERE id = p_job_id
    AND status IN ('RUNNING','QUEUED')
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  v_retry := (v_job.attempt_count < v_job.max_attempts);

  IF v_retry THEN
    UPDATE public.jobs
    SET status = 'QUEUED',
        available_at = now() + make_interval(secs => p_delay_seconds),
        timeout_at = NULL,
        last_error_code = p_error_code,
        last_error_message_sanitized = left(COALESCE(p_error_message_sanitized, ''), 500)
    WHERE id = p_job_id;
  ELSE
    UPDATE public.jobs
    SET status = 'FAILED',
        finished_at = now(),
        timeout_at = NULL,
        last_error_code = p_error_code,
        last_error_message_sanitized = left(COALESCE(p_error_message_sanitized, ''), 500)
    WHERE id = p_job_id;
  END IF;

  UPDATE public.job_attempts
  SET finished_at = now(),
      outcome = CASE WHEN v_retry THEN 'FAILED_TRANSIENT' ELSE 'FAILED_PERMANENT' END,
      error_code = p_error_code,
      error_message_sanitized = left(COALESCE(p_error_message_sanitized, ''), 500)
  WHERE job_id = p_job_id
    AND worker_id = p_worker_id
    AND finished_at IS NULL;

  INSERT INTO public.audit_log (audit_id, event_type, metadata)
  VALUES (
    v_job.audit_id,
    CASE WHEN v_retry THEN 'JOB_RETRY_SCHEDULED' ELSE 'JOB_FAILED' END,
    jsonb_build_object(
      'jobId', v_job.id, 'jobType', v_job.job_type,
      'attempt', v_job.attempt_count, 'errorCode', p_error_code
    )
  );
END;
$$;

-- 6.6 record_job_artifact: idempotente gracias a UNIQUE (job_id, artifact_type).
-- Un reintento del worker reescribe el MISMO artifact en vez de apilar un segundo,
-- y el COALESCE del sha256 conserva el hash ya calculado si el reintento no lo
-- vuelve a traer. evidence_id se toma del parámetro y NO se hereda del job: el
-- artifact pertenece a la extracción de ESE archivo, y heredar el del job
-- escribiría una atribución falsa cuando el worker no lo pase. La prelectura del
-- job convierte un 23503 de FK en un JOB_NOT_FOUND legible.
CREATE OR REPLACE FUNCTION public.record_job_artifact(
  p_job_id uuid,
  p_artifact_type text,
  p_result jsonb,
  p_evidence_id uuid DEFAULT NULL,
  p_content_sha256 text DEFAULT NULL,
  p_extractor_version text DEFAULT NULL,
  p_provider text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_artifact_id uuid;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.jobs WHERE id = p_job_id) THEN
    RAISE EXCEPTION 'JOB_NOT_FOUND';
  END IF;
  IF btrim(COALESCE(p_artifact_type, '')) = '' THEN
    RAISE EXCEPTION 'JOB_ARTIFACT_TYPE_REQUIRED';
  END IF;

  INSERT INTO public.job_artifacts (
    job_id, artifact_type, result, evidence_id, content_sha256, extractor_version, provider
  )
  VALUES (
    p_job_id,
    p_artifact_type,
    COALESCE(p_result, '{}'::jsonb),
    p_evidence_id,
    p_content_sha256,
    p_extractor_version,
    p_provider
  )
  ON CONFLICT (job_id, artifact_type) DO UPDATE SET
    result = EXCLUDED.result,
    content_sha256 = COALESCE(EXCLUDED.content_sha256, public.job_artifacts.content_sha256),
    created_at = now()
  RETURNING id INTO v_artifact_id;

  RETURN v_artifact_id;
END;
$$;

-- 6.7 delete_audit: ÚNICA vía de borrado. Mismo contrato que la versión anterior
-- con el retorno pasado a jsonb:
--   - exige sesión (auth.uid() no nulo), luego nadie sin sesión la ejecuta ni
--     aunque tenga EXECUTE: es lo que hace la función segura de usar desde un
--     endpoint sin autenticar;
--   - exige que el actor sea el creador o tenga rol OWNER;
--   - escribe la bitácora ANTES de borrar, y audit_log.audit_id es ON DELETE SET
--     NULL, así que la entrada sobrevive a la auditoría con audit_id a NULL;
--   - borra la fila y el CASCADE se lleva evidences, runs, resultados,
--     tool_executions, ai_call_log, jobs, artefactos, intentos y comentarios.
CREATE OR REPLACE FUNCTION public.delete_audit(
  p_audit_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_actor_id uuid := auth.uid();
  v_audit public.audits;
  v_role text := COALESCE(public.current_app_role(), '');
BEGIN
  IF v_actor_id IS NULL THEN
    RAISE EXCEPTION 'AUTH_REQUIRED';
  END IF;

  SELECT * INTO v_audit
  FROM public.audits
  WHERE id = p_audit_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'AUDIT_NOT_FOUND';
  END IF;

  IF NOT (v_audit.created_by = v_actor_id OR v_role = 'OWNER') THEN
    RAISE EXCEPTION 'FORBIDDEN';
  END IF;

  INSERT INTO public.audit_log (audit_id, event_type, actor_id, metadata)
  VALUES (
    p_audit_id,
    'AUDIT_DELETED',
    v_actor_id,
    jsonb_build_object(
      'reason', p_reason,
      'externalCaseId', v_audit.external_case_id,
      'displayName', v_audit.display_name,
      'status', v_audit.status,
      'createdBy', v_audit.created_by,
      'deletedByRole', NULLIF(v_role, '')
    )
  );

  DELETE FROM public.audits
  WHERE id = p_audit_id;

  RETURN jsonb_build_object(
    'audit_id', v_audit.id,
    'external_case_id', v_audit.external_case_id,
    'display_name', v_audit.display_name,
    'status', v_audit.status,
    'deleted_by', v_actor_id,
    'deleted_by_role', NULLIF(v_role, ''),
    'reason', p_reason,
    'deleted_at', now()
  );
END;
$$;

-- 6.8 sweep_stale_operations: la barredora.
--
-- Ésta es la RPC que hace cierto el "todo job termina en SUCCEEDED o FAILED".
-- Cierra las tres clases de operación que pueden quedarse colgadas:
--   jobs            -> timeout_at vencido, en RUNNING o en QUEUED
--   tool_executions -> timeout_at vencido, en PENDING/RUNNING/WAITING_EXTERNAL
--   audit_runs      -> sin estado terminal tras 30 minutos
--
-- SOBRE EL TRIGGER DE INMUTABILIDAD: no bloquea este sweep, y conviene que se
-- entienda por qué. Para cada fila actualizada, OLD.status no está en
-- ('COMPLETED','NEEDS_INPUT','FAILED') porque es exactamente lo que el WHERE
-- excluye, así que la primera rama del trigger no se cumple. Y NEW.status es
-- 'FAILED', que SÍ está en la lista de terminales, así que la condición
-- `NEW.status NOT IN (...) AND OLD.status NOT IN (...)` es FALSE y la segunda
-- rama tampoco se cumple. La transición se permite, y sólo se permite, desde un
-- estado no terminal: que es lo que un sweep debe poder hacer y lo que un run
-- terminal no debe poder sufrir.
--
-- SEGURIDAD — POR QUÉ `authenticated` NO LA PUEDE EJECUTAR.
--   El sweep es una acción GLOBAL: no recibe tenant, no filtra por propietario y
--   escribe en `jobs`, `tool_executions` y `audit_runs` de TODOS los tenants sin
--   mirar sus políticas RLS (es SECURITY DEFINER). Concedérselo a `authenticated`
--   convertía a cualquier auditor —un token de un solo tenant— en el mecanismo
--   para marcar como FAILED los jobs y los runs de OTRO auditor:_denegación de
--   servicio cross-tenant y falsificación de la traza de un dictamen
--   ajeno. Que el barrido sea idempotente y sólo toque operaciones ya vencidas
--   acota el daño, no lo elimina.
--   Por eso EXECUTE va SÓLO a service_role (sección 7): la ejecuta el runtime,
--   no el usuario final. Un OWNER que necesite forzar el barrido lo pide al
--   runtime, que es quien tiene el privilegio y la responsabilidad.
CREATE OR REPLACE FUNCTION public.sweep_stale_operations(
  p_now timestamptz DEFAULT now()
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_jobs integer := 0;
  v_tools integer := 0;
  v_runs integer := 0;
BEGIN
  UPDATE public.jobs
  SET status = 'FAILED',
      finished_at = now(),
      timeout_at = NULL,
      last_error_code = 'JOB_TIMEOUT',
      last_error_message_sanitized = 'El job superó su timeout sin terminar.'
  WHERE status IN ('RUNNING','QUEUED')
    AND timeout_at IS NOT NULL
    AND timeout_at < p_now;
  GET DIAGNOSTICS v_jobs = ROW_COUNT;

  UPDATE public.tool_executions
  SET status = 'FAILED',
      finished_at = now(),
      error_code = 'TOOL_TIMEOUT',
      error_message = 'La ejecución de la tool superó su timeout.'
  WHERE status IN ('PENDING','RUNNING','WAITING_EXTERNAL')
    AND timeout_at IS NOT NULL
    AND timeout_at < p_now;
  GET DIAGNOSTICS v_tools = ROW_COUNT;

  UPDATE public.audit_runs
  SET status = 'FAILED',
      finished_at = now(),
      error_code = 'RUN_TIMEOUT',
      error_message = 'El run superó su timeout sin alcanzar un estado terminal.'
  WHERE status NOT IN ('COMPLETED','NEEDS_INPUT','FAILED')
    AND created_at < p_now - interval '30 minutes';
  GET DIAGNOSTICS v_runs = ROW_COUNT;

  RETURN jsonb_build_object(
    'jobs_failed', v_jobs,
    'tool_executions_failed', v_tools,
    'audit_runs_failed', v_runs
  );
END;
$$;


-- =============================================================================
-- SECCIÓN 7 — Privilegios de las funciones
--
-- REGLA APLICADA A TODAS, sin excepción:
--   1) REVOKE ALL ... FROM PUBLIC. Postgres da EXECUTE a PUBLIC en TODA función
--      nueva. Sin este REVOKE, cualquier cliente —incluido uno anónimo— podría
--      ejecutar una SECURITY DEFINER. Sin el REVOKE, esta sección es decorado.
--   2) REVOKE ALL ... FROM anon, por si el privilegio por defecto de la
--      plataforma lo concediera aunque el anterior lo quitara.
--   3) GRANT EXECUTE a authenticated o a service_role, según el caso, y sólo a
--      uno de los dos.
--
-- Reparto por caso de uso:
--   authenticated -> las RPCs que el CLIENTE invoca como parte de su trabajo:
--       encolar (lo hace la aplicación al subir evidencia), reclamar y cerrar
--       (el worker), y borrar la propia auditoría.
--   service_role  -> las RPCs de acción global que ejecuta el RUNTIME, no la
--       persona: en este archivo, sweep_stale_operations().
--
-- delete_audit va a authenticated A PROPÓSITO: es una acción de usuario (borrar
-- su propia auditoría), y la seguridad no está en quién la puede llamar sino en
-- que la función exige sesión (auth.uid() NOT NULL) y exige ser el creador o
-- OWNER. Un usuario sin sesión recibe AUTH_REQUIRED aunque tenga EXECUTE, y un
-- usuario con sesión sobre la auditoría de otro recibe FORBIDDEN.
--
-- current_app_role() también necesita EXECUTE para authenticated: la llaman las
-- políticas RLS, que se evalúan con los privilegios del usuario que consulta. Sin
-- ese GRANT, la RLS sería inaccesible y el rol OWNER no existiría de facto.
-- =============================================================================
REVOKE ALL ON FUNCTION public.set_updated_at() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_updated_at() FROM anon;
GRANT EXECUTE ON FUNCTION public.set_updated_at() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.current_app_role() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.current_app_role() FROM anon;
GRANT EXECUTE ON FUNCTION public.current_app_role() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.guard_audit_run_immutability() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.guard_audit_run_immutability() FROM anon;
GRANT EXECUTE ON FUNCTION public.guard_audit_run_immutability() TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.enqueue_job(uuid, text, text, text, text, jsonb, uuid, integer, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_job(uuid, text, text, text, text, jsonb, uuid, integer, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.enqueue_job(uuid, text, text, text, text, jsonb, uuid, integer, uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.claim_next_job(text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.claim_next_job(text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.claim_next_job(text, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.complete_job(uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_job(uuid, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.complete_job(uuid, text, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.fail_job_permanent(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_job_permanent(uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.fail_job_permanent(uuid, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.schedule_job_retry(uuid, text, text, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schedule_job_retry(uuid, text, text, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.schedule_job_retry(uuid, text, text, text, integer) TO authenticated;

REVOKE ALL ON FUNCTION public.record_job_artifact(uuid, text, jsonb, uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.record_job_artifact(uuid, text, jsonb, uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.record_job_artifact(uuid, text, jsonb, uuid, text, text, text) TO authenticated;

REVOKE ALL ON FUNCTION public.delete_audit(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_audit(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.delete_audit(uuid, text) TO authenticated;

-- sweep_stale_operations: SÓLO service_role. Ver la nota de seguridad en 6.8.
-- No lleva `authenticated`, y la sección 8 falla la migración si alguien lo
-- vuelve a añadir, para que la regresión no pueda colarse sin que se note.
REVOKE ALL ON FUNCTION public.sweep_stale_operations(timestamptz) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sweep_stale_operations(timestamptz) FROM anon;
GRANT EXECUTE ON FUNCTION public.sweep_stale_operations(timestamptz) TO service_role;


-- =============================================================================
-- SECCIÓN 8 — Verificación posterior a la aplicación
--
-- No se dice "ya está" porque el runner lo dijo. Se comprueba, y si algo no
-- cuadra la migración falla AQUÍ y no en un informe tres fases después.
--
-- Se comprueba: que las 12 tablas están con las columnas de la spec, que no
-- queda NINGUNA tabla del esquema retirado, que la cola tiene su unicidad, que
-- las nueve funciones existen y ninguna es ejecutable por PUBLIC o anon, que
-- sweep_stale_operations no es ejecutable por authenticated, y que ai_call_log es
-- de verdad append-only para el rol de cliente.
-- =============================================================================
DO $$
DECLARE
  v_leaked text;
  v_missing text;
  v_anon_oid oid;
  v_count integer;
BEGIN
  SELECT oid INTO v_anon_oid FROM pg_roles WHERE rolname = 'anon';

  -- 1) Las 12 tablas de la línea base existen, con las columnas de la spec. Se
  --    comprueban las columnas, no sólo la existencia de la tabla: un
  --    `CREATE TABLE IF NOT EXISTS` que encuentra una tabla vieja con otra forma
  --    es un no-op silencioso, y eso es lo que hay que descartar.
  SELECT string_agg(e.tabla || '.' || col.nombre, ', ' ORDER BY e.tabla, col.nombre)
    INTO v_leaked
  FROM (VALUES
    ('audits', ARRAY['id','status','external_case_id','created_by','display_name',
                     'class_start_date','ticket_start_at','student_name',
                     'student_enrollment','created_at','updated_at']::text[]),
    ('evidences', ARRAY['id','audit_id','nombre_archivo','tipo','kind','storage_bucket',
                        'storage_key','storage_url','mime_type','detected_mime_type',
                        'size_bytes','sha256','original_filename','safe_filename',
                        'status','content_status','content_error','uploaded_by',
                        'created_at','updated_at']::text[]),
    ('audit_log', ARRAY['id','audit_id','event_type','actor_id','metadata','occurred_at']::text[]),
    ('audit_manual_comments', ARRAY['id','audit_id','back_office_comment',
                                    'helpdesk_comment','school_services_comment',
                                    'finance_comment','additional_comment',
                                    'created_at','updated_at','updated_by']::text[]),
    ('audit_runs', ARRAY['id','audit_id','run_number','status','evidence_fingerprint',
                         'policy_code','policy_version','policy_source_sha256',
                         'analyst_model','analyst_prompt_version','reviewer_model',
                         'reviewer_prompt_version','policy_sections_consulted',
                         'tool_call_count','agent_step_count','error_code',
                         'error_message','created_by','created_at','started_at','finished_at']::text[]),
    ('tool_executions', ARRAY['id','audit_id','run_id','name','kind','status','input',
                              'output','idempotency_key','attempts','error_code',
                              'error_message','created_at','started_at','finished_at','timeout_at']::text[]),
    ('audit_results', ARRAY['id','audit_id','run_id','stage','status','classification',
                            'summary','assessment','review','created_at']::text[]),
    ('ai_call_log', ARRAY['id','audit_id','run_id','provider','model','purpose',
                          'input_tokens','output_tokens','estimated_cost_usd',
                          'latency_ms','error_code','created_at']::text[]),
    ('jobs', ARRAY['id','audit_id','job_type','operation_scope','idempotency_key',
                   'input_fingerprint','payload','evidence_id','status','progress',
                   'attempt_count','max_attempts','last_error_code',
                   'last_error_message_sanitized','available_at','created_at',
                   'started_at','finished_at','timeout_at']::text[]),
    ('job_artifacts', ARRAY['id','job_id','evidence_id','artifact_type','result',
                            'content_sha256','extractor_version','provider','created_at']::text[]),
    ('job_attempts', ARRAY['id','job_id','attempt_number','worker_id','started_at',
                           'finished_at','outcome','error_code','error_message_sanitized']::text[])
  ) AS e(tabla, cols)
  CROSS JOIN LATERAL unnest(e.cols) AS col(nombre)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns cols2
    WHERE cols2.table_schema = 'public'
      AND cols2.table_name = e.tabla
      AND cols2.column_name = col.nombre
  );
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION 'AI_NATIVE_BASELINE_INCOMPLETE: a las tablas de la línea base les faltan columnas de la spec: %', v_leaked;
  END IF;

  -- 2) Ninguna tabla del esquema retirado sobrevive. Esto sigue siendo una
  --    comprobación viva, no un recuerdo histórico: sigue valiendo si alguien
  --    aplicó el árbol viejo de migraciones antes que este archivo.
  SELECT string_agg(c.relname, ', ' ORDER BY c.relname) INTO v_leaked
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relkind = 'r'
    AND c.relname = ANY (ARRAY[
      'fact_extraction_runs','fact_run_frozen_snapshots','facts','fact_reviews',
      'canonical_fact_runs','canonical_fact_candidates','canonical_facts',
      'audit_temporal_context','engine_runs','engine_rule_results',
      'rule_evaluations','rule_conditions','rules','evidence_requirements',
      'policy_sources','policy_source_registry','report_snapshots',
      'dictamen_documents','dictamen_versions','generated_pdfs',
      'ai_decision_snapshots','ai_usage','audit_comparisons',
      'audit_evaluation_envelopes','final_adjudications','human_decision_extracts',
      'human_reviews','audit_evidence_selection','provider_operations',
      'speaker_assignments','extracted_facts','transcript_segments',
      'decision_runs','tickets','audit_events','schema_baseline_v2_manifest'
    ]);
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION 'AI_NATIVE_BASELINE_INCOMPLETE: tablas del esquema antiguo aún presentes: %', v_leaked;
  END IF;

  -- 3) Ninguna función de la arquitectura antigua quedó viva.
  SELECT count(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = ANY (ARRAY[
      'freeze_fact_run_v1','create_derived_fact_run_v1','persist_policy_evaluation_v1',
      'backfill_legacy_frozen_snapshots_v1','begin_fact_run_processing_v1',
      'record_ai_usage','record_ai_usage_v1','persist_provider_operation',
      'begin_provider_operation_v1','complete_provider_operation_v1',
      'update_provider_operation_status','renew_job_lease',
      'is_admin_or_owner','is_admin_or_owner_by_evidence','is_admin_or_owner_by_run',
      'set_current_decision_run'
    ]);
  IF v_count <> 0 THEN
    RAISE EXCEPTION 'AI_NATIVE_BASELINE_INCOMPLETE: quedan funciones de la arquitectura antigua';
  END IF;

  -- 4) Las nueve funciones de la línea base existen.
  SELECT count(*) INTO v_count
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname = ANY (ARRAY[
      'enqueue_job','claim_next_job','complete_job','fail_job_permanent',
      'schedule_job_retry','record_job_artifact','delete_audit',
      'sweep_stale_operations','guard_audit_run_immutability'
    ]);
  IF v_count <> 9 THEN
    RAISE EXCEPTION 'AI_NATIVE_BASELINE_INCOMPLETE: no están las nueve funciones de la línea base AI-Native';
  END IF;

  -- 5) SEGURIDAD: ninguna SECURITY DEFINER ejecutable por PUBLIC ni por anon.
  --    grantee = 0 es PUBLIC en la representación de ACL de Postgres. Se
  --    excluye el propietario, que sí debe poder ejecutarlas por definición.
  SELECT string_agg(p.proname, ', ' ORDER BY p.proname) INTO v_leaked
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
  WHERE n.nspname = 'public'
    AND p.prosecdef
    AND acl.privilege_type = 'EXECUTE'
    AND acl.grantee <> p.proowner
    AND (acl.grantee = 0 OR acl.grantee = v_anon_oid);
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION 'AI_NATIVE_BASELINE_INSECURE: funciones SECURITY DEFINER ejecutables por PUBLIC o anon: %', v_leaked;
  END IF;

  -- 6) sweep_stale_operations NO es ejecutable por authenticated. Es una acción
  --    global; que aparezca aquí es una regresión de seguridad deliberada.
  IF EXISTS (
    SELECT 1
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    CROSS JOIN LATERAL aclexplode(COALESCE(p.proacl, acldefault('f', p.proowner))) AS acl
    JOIN pg_roles r ON r.oid = acl.grantee
    WHERE n.nspname = 'public'
      AND p.proname = 'sweep_stale_operations'
      AND acl.privilege_type = 'EXECUTE'
      AND r.rolname = 'authenticated'
  ) THEN
    RAISE EXCEPTION 'AI_NATIVE_BASELINE_INSECURE: sweep_stale_operations es ejecutable por authenticated (acción cross-tenant)';
  END IF;

  -- 7) ai_call_log es APPEND-ONLY para el rol de cliente: SELECT e INSERT, nada
  --    más. Un UPDATE aquí permitiría reescribir el gasto ya registrado.
  SELECT string_agg(DISTINCT privilege_type, ', ' ORDER BY privilege_type) INTO v_leaked
  FROM information_schema.column_privileges
  WHERE table_schema = 'public'
    AND table_name = 'ai_call_log'
    AND grantee = 'authenticated'
    AND privilege_type <> 'SELECT'
    AND privilege_type <> 'INSERT';
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION 'AI_NATIVE_BASELINE_INSECURE: ai_call_log otorga % a authenticated; debe ser append-only', v_leaked;
  END IF;

  -- 8) Lo mismo para audit_log: una bitácora que se puede editar no es una
  --    bitácora.
  SELECT string_agg(DISTINCT privilege_type, ', ' ORDER BY privilege_type) INTO v_leaked
  FROM information_schema.column_privileges
  WHERE table_schema = 'public'
    AND table_name = 'audit_log'
    AND grantee = 'authenticated'
    AND privilege_type <> 'SELECT'
    AND privilege_type <> 'INSERT';
  IF v_leaked IS NOT NULL THEN
    RAISE EXCEPTION 'AI_NATIVE_BASELINE_INSECURE: audit_log otorga % a authenticated; debe ser append-only', v_leaked;
  END IF;

  -- 9) audits no tiene DELETE para el rol de cliente: el único camino es
  --    public.delete_audit(), que deja bitácora.
  IF EXISTS (
    SELECT 1
    FROM information_schema.column_privileges
    WHERE table_schema = 'public'
      AND table_name = 'audits'
      AND grantee = 'authenticated'
      AND privilege_type = 'DELETE'
  ) THEN
    RAISE EXCEPTION 'AI_NATIVE_BASELINE_INSECURE: audits tiene DELETE para authenticated; sólo debe borrarse vía delete_audit()';
  END IF;

  -- 10) La unicidad de artifact es real: sin UNIQUE (job_id, artifact_type),
  --     record_job_artifact() no sería idempotente y su ON CONFLICT no resolvería.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.job_artifacts'::regclass
      AND contype = 'u'
      AND pg_get_constraintdef(oid) = 'UNIQUE (job_id, artifact_type)'
  ) THEN
    RAISE EXCEPTION 'AI_NATIVE_BASELINE_INCOMPLETE: falta UNIQUE (job_id, artifact_type) en job_artifacts';
  END IF;

  -- 11) Y que jobs no admita nada fuera de los cuatro estados del modelo, ni un
  --     quinto estado trampa como era RETRY_SCHEDULED.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.jobs'::regclass
      AND pg_get_constraintdef(oid) = 'CHECK (status = ANY (ARRAY[''QUEUED''::text, ''RUNNING''::text, ''SUCCEEDED''::text, ''FAILED''::text]))'
  ) THEN
    RAISE EXCEPTION 'AI_NATIVE_BASELINE_INCOMPLETE: el CHECK de estados de jobs no es el de la spec';
  END IF;
END $$;
