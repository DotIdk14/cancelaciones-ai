-- =============================================================================
-- Comentarios manuales por área (Back Office, HelpDesk, Servicios Escolares,
-- Finanzas, Adicional).
--
-- QUÉ ES Y QUÉ NO ES
--   Es la bitácora en la que cada área deja su observación sobre un caso. No es
--   normativa, no alimenta al modelo y no decide el dictamen: el criterio sigue
--   siendo exclusivamente el procedimiento V5 del owner. Por eso NO hay
--   relación con `audits.result_json` ni ninguna columna que el modelo lea.
--
-- POR QUÉ UNA TABLA NUEVA Y NO `audit_manual_comments`
--   La tabla legacy `audit_manual_comments` tiene exactamente estas cinco
--   columnas, pero está colgada de `legacy_audits(id)` — el schema de 62 tablas
--   que AGENTS.md marca como residuo a eliminar — y tiene 0 filas. Reutilizarla
--   ataría el producto a un schema que se va depurar, y no se puede garantizar
--   que su alcance por caso sobreviva a esa limpieza. Se crea la tabla en el
--   schema del producto y la legacy queda redundante (borrarla es una migración
--   destructiva que requiere decisión explícita del owner).
--
-- UN COMENTARIO POR ÁREA Y POR CASO
--   `UNIQUE (case_id, area)` hace que "guardar" sea un UPSERT y no un
--   historial. Es la decisión de producto: lo que se lee en el dictamen es el
--   estado actual del comentario de cada área, y un histórico por cada uno
--   convertiría la pantalla en un registro de auditoría que nadie pidió y que
--   nadie va a leer.
--
-- SEGURIDAD
--   · RLS activa y fail-closed: solo se leen y escriben los comentarios cuyo
--     `created_by` es la identidad autenticada. Sin `SELECT` para `anon`.
--   · El alcance se resuelve por `created_by`, no por el rol: quien puede
--     escribir es quien escribió el caso, igual que en `cases`.
--   · `comment` tiene NOT NULL y CHECK de longitud: no existe el comentario
--     vacío, y un texto gigante no entra (VALIDATE_BEFORE_EFFECT: la base
--     rechaza antes de que exista fila inconsistente).
--   · Este texto es libre y lo escribe una persona. Se muestra escapado por
--     React y no se inyecta en ningún prompt. Si algún día se manda al modelo,
--     pasa a ser contenido NO CONFIABLE y necesita el cercado de
--     `src/skills/sanitize.ts` como el resto del expediente.
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.case_area_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES public.cases(id) ON DELETE CASCADE,
  -- Vocabulario cerrado: un área que no esté aquí no se puede escribir. El
  -- CHECK de la base es la última línea; la validación de la API es la primera.
  area        text NOT NULL,
  comment     text NOT NULL,
  created_by  uuid REFERENCES auth.users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT case_area_comments_area_ck
    CHECK (area IN ('BACK_OFFICE', 'HELPDESK', 'SCHOOL_SERVICES', 'FINANCE', 'ADDITIONAL')),
  CONSTRAINT case_area_comments_comment_ck
    CHECK (char_length(btrim(comment)) BETWEEN 1 AND 4000),
  CONSTRAINT case_area_comments_case_area_uq UNIQUE (case_id, area)
);

-- RLS fail-closed. Sin estas políticas la tabla queda inaccesible, que es el
-- estado seguro; con ellas el acceso es exactamente "mis comentarios".
ALTER TABLE public.case_area_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS case_area_comments_select_own ON public.case_area_comments;
CREATE POLICY case_area_comments_select_own
  ON public.case_area_comments
  FOR SELECT
  USING (created_by = auth.uid());

DROP POLICY IF EXISTS case_area_comments_insert_own ON public.case_area_comments;
CREATE POLICY case_area_comments_insert_own
  ON public.case_area_comments
  FOR INSERT
  WITH CHECK (created_by = auth.uid());

-- `WITH CHECK` además de `USING`: sin él, un UPDATE podría mover el comentario
-- a otro caso y dejarla fuera del alcance del dueño original.
DROP POLICY IF EXISTS case_area_comments_update_own ON public.case_area_comments;
CREATE POLICY case_area_comments_update_own
  ON public.case_area_comments
  FOR UPDATE
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

-- El acceso real es EXCLUSIVAMENTE del servidor con la API key de
-- administración. La plataforma otorga `anon` y `authenticated` por defecto al
-- crear una tabla, así que hay que revocarlo explícitamente: el navegador jamás
-- habla con la base, y el alcance del caso lo resuelve `getScopedCaseOr404` en
-- el endpoint, no una política que confíe en el cliente. Mismo criterio que
-- `case_reviews`.
REVOKE ALL ON public.case_area_comments FROM anon;
REVOKE ALL ON public.case_area_comments FROM authenticated;
GRANT SELECT, INSERT, UPDATE ON public.case_area_comments TO project_admin;

DROP TRIGGER IF EXISTS case_area_comments_set_updated_at ON public.case_area_comments;
CREATE TRIGGER case_area_comments_set_updated_at
  BEFORE UPDATE ON public.case_area_comments
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();