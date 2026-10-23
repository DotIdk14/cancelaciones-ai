# Base de datos

InsForge aloja PostgreSQL y Storage. Identidad en auth.users; app_memberships determina acceso y rol. SDK administrativo exclusivamente servidor.

cases conserva solicitud, asignación, adquisición y marca de prueba; evidence originales y derivados; audits intentos y result_json. case_reviews conserva etapas humanas por audit_id; case_comparisons la comparación independiente. case_area_comments guarda bitácora y request_admissions sujetos HMAC. Relaciones, consolidaciones e incidencias tienen historial. audit_feedback, approved_examples y audit_evaluation_* existen aunque mejora continua esté bloqueada.

El workflow se deriva de case_reviews; el dictamen fuente vive en audits.result_json y country/channel son proyecciones. Vistas de dashboard excluyen pruebas según sus cohortes.

## Inspección remota: 23/10/2026

674 columnas públicas (tablas y vistas), 115 constraints, 58 índices, 21 políticas, 180 funciones públicas, seis entradas de triggers y 11 vistas. Incluye objetos de extensiones: no equivale al número de objetos de negocio. Se contrastó unicidad por audit_id y retiro de tablas administrativas. Ver [matriz de migraciones](../operations/migrations.md).

project_admin omite RLS: las guardas en código son la frontera de autorización. No se cambiaron SQL, permisos ni datos.

## Reconstrucción

Conservar baseline e incrementos, incluso objetos después retirados. Validar la cadena en base aislada con identidad y Storage de InsForge, sin aplicarla al proyecto enlazado. Las 34 migraciones, incluida human-resolution, están versionadas. Su entrada en .gitignore no altera archivos ya seguidos por Git. El historial local está completo; la reconstrucción integral en una instancia nueva no se ensayó en esta entrega. Ver [procedimiento y pendientes](../operations/migrations.md).
