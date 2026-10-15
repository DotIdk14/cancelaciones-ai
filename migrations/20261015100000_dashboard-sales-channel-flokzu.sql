-- Añade el canal de venta reportado por Flokzu a las vistas que consume el
-- dashboard. `cases.channel` conserva su significado separado: canal de origen
-- confirmado en el dictamen a partir de evidencia.

DO $preflight$
BEGIN
  IF to_regclass('public.audit_activity_metrics') IS NULL
    OR to_regclass('public.comparison_activity_metrics') IS NULL
    OR to_regclass('public.audit_evaluation_metrics') IS NULL
    OR to_regclass('public.current_audit_evaluation_metrics') IS NULL THEN
    RAISE EXCEPTION 'DASHBOARD_SALES_CHANNEL_DEPENDENCY_MISSING: aplica primero las vistas de métricas vigentes tras reconciliar el esquema';
  END IF;
END;
$preflight$;

CREATE OR REPLACE VIEW public.audit_activity_metrics_with_sales_channel AS
SELECT activity.*,
  NULLIF(c.flokzu_data #>> '{operations,salesChannelReported}', '') AS sales_channel
FROM public.audit_activity_metrics activity
JOIN public.cases c ON c.id = activity.case_id;

CREATE OR REPLACE VIEW public.comparison_activity_metrics_with_sales_channel AS
SELECT activity.*,
  NULLIF(c.flokzu_data #>> '{operations,salesChannelReported}', '') AS sales_channel
FROM public.comparison_activity_metrics activity
JOIN public.cases c ON c.id = activity.case_id;

CREATE OR REPLACE VIEW public.audit_evaluation_metrics_with_sales_channel AS
SELECT evaluation.*, activity.sales_channel
FROM public.audit_evaluation_metrics evaluation
JOIN public.audit_activity_metrics_with_sales_channel activity ON activity.id = evaluation.id;

CREATE OR REPLACE VIEW public.current_audit_evaluation_metrics_with_sales_channel AS
SELECT evaluation.*, activity.sales_channel
FROM public.current_audit_evaluation_metrics evaluation
JOIN public.audit_activity_metrics_with_sales_channel activity ON activity.id = evaluation.id;

REVOKE ALL ON public.audit_activity_metrics_with_sales_channel FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audit_activity_metrics_with_sales_channel TO project_admin;
REVOKE ALL ON public.comparison_activity_metrics_with_sales_channel FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.comparison_activity_metrics_with_sales_channel TO project_admin;
REVOKE ALL ON public.audit_evaluation_metrics_with_sales_channel FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.audit_evaluation_metrics_with_sales_channel TO project_admin;
REVOKE ALL ON public.current_audit_evaluation_metrics_with_sales_channel FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.current_audit_evaluation_metrics_with_sales_channel TO project_admin;

DO $verify$
DECLARE v text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='audit_activity_metrics_with_sales_channel'
      AND column_name='sales_channel' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='comparison_activity_metrics_with_sales_channel'
      AND column_name='sales_channel' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='audit_evaluation_metrics_with_sales_channel'
      AND column_name='sales_channel' AND data_type='text'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema='public' AND table_name='current_audit_evaluation_metrics_with_sales_channel'
      AND column_name='sales_channel' AND data_type='text'
  ) THEN
    RAISE EXCEPTION 'DASHBOARD_SALES_CHANNEL_INCOMPLETE: las vistas no exponen sales_channel como texto';
  END IF;

  FOREACH v IN ARRAY ARRAY[
    'audit_activity_metrics_with_sales_channel',
    'comparison_activity_metrics_with_sales_channel',
    'audit_evaluation_metrics_with_sales_channel',
    'current_audit_evaluation_metrics_with_sales_channel'
  ] LOOP
    IF has_table_privilege('anon', 'public.' || v, 'SELECT')
      OR has_table_privilege('authenticated', 'public.' || v, 'SELECT')
      OR NOT has_table_privilege('project_admin', 'public.' || v, 'SELECT') THEN
      RAISE EXCEPTION 'DASHBOARD_SALES_CHANNEL_PRIVILEGES: permisos inesperados en public.%', v;
    END IF;
  END LOOP;
END;
$verify$;
