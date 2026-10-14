# Resumen y Calidad: contrato de métricas

Todos los rangos y las series usan **UTC**. El rango inicial es el mes calendario
actual completo. Las fechas se aplican a `audits.created_at` para auditorías y a la
fecha real de inicio de cada ejecución de comparación para su consumo. Solo
producción: todas las consultas aplican `is_test = false` antes de paginar.

## Actividad mensual

Una fila de auditoría es una ejecución. Una comparación rearmada tiene una fila
vigente y snapshots de ejecuciones anteriores, archivados transaccionalmente por
el trigger de incremento de `attempt_count`. El identificador de ejecución es
`comparison_id:attempt_count`; el historial y la vigente nunca representan el mismo
intento. Se conserva el resultado anterior, incluido su consumo y confianza.

Reauditorías son ejecuciones con una auditoría previa del mismo expediente,
incluso si la previa ocurrió antes del periodo. Reintentos y fallbacks pueden
coincidir. Los diagnósticos de capacidades no son llamadas a OpenRouter y no
aportan al contador de llamadas reales.

El transporte actual devuelve `usage` del último intento. Se prefiere la suma
por intento, con fallback a `usage` del intento exitoso cuando su diagnóstico
carece de consumo. Si la fuente declara `usageScope = aggregate`, se utiliza el
agregado sin volver a sumar los intentos. No se calculan precios desde tokens.
El campo técnico `estimatedCostUSD` procede de `usage.cost` real de OpenRouter;
su nombre histórico no convierte ese gasto en una estimación. No se producen
estimaciones nuevas ni se reclasifican dictámenes.

El total conocido es una suma de los consumos disponibles, **no una factura
completa** cuando hay cobertura incompleta. Se informa por separado el número de
ejecuciones con gasto parcial/desconocido y sin trazabilidad. Las medias de costo
se muestran solo cuando todas las ejecuciones de su universo tienen consumo
completo. Un cero explícito es conocido; `null` nunca significa gasto cero.
Los costos históricos sin trazabilidad no pueden reconstruirse retroactivamente.
La fiabilidad y latencia de IA & Costos describen auditorías; su consumo incluye
también comparaciones y muestra ambos volúmenes separados.

## Cohorte de calidad

La versión vigente es la última auditoría completada por expediente (desempate
por `created_at`, `id`). Si nunca hubo dictamen completado, se muestra la última
ejecución técnica. La selección ocurre **antes del rango y los filtros**: una
versión emitida fuera del periodo no hace vigente una anterior del periodo.
Un error o una ejecución en curso posterior no borra el último dictamen válido.
El histórico de todas las versiones del periodo conserva esos estados técnicos.

La revisión se enlaza al `audit_id` exacto. La propuesta del Asesor es inmutable;
la resolución final es la propuesta en APPROVE y `coordinator_resolution` en
CHANGE. Solo una comparación de esa auditoría y revisión, iniciada después de
`coordinator_created_at`, puede contribuir a la concordancia final. Una revisión
de una versión anterior no evalúa automáticamente la nueva. Los guardas vivos
siguen limitando revisión y finalización a sus etapas autorizadas.

La fecha de la comparación no cambia la cohorte de Calidad: puede evaluar en
noviembre un dictamen de octubre. Su consumo pertenece a noviembre.

- Concordancia sustantiva: acuerdos / comparaciones completadas con `agrees`
  booleano válido. Pendientes, errores y salidas sin veredicto quedan fuera.
- Cobertura: comparaciones finales válidas / dictámenes emitidos elegibles.
- Acuerdo exacto: coincidencias de código / resoluciones humanas finales.
  No sustituye al acuerdo sustantivo del comparador.
- Confianza original: media sobre confianza finita entre 0 y 1. Los datos
  ausentes no se promedian como cero; se cuentan por separado.
- Calibración: bandas 0–49, 50–69, 70–89 y 90–100 %. Confianza declarada y
  concordancia observada usan la misma muestra evaluada. La brecha es confianza
  menos concordancia. Se muestran casos totales y tamaño de muestra evaluada.

Los KPI y el detalle principal proceden del mismo array filtrado en SQL. Los
filtros de dimensión y evaluación se aplican también al histórico, cuya unidad
es versión y cuya tabla se identifica explícitamente como histórica. La tabla
pagina en pantalla sin recortar el universo agregado.
País y canal se leen del origen del dictamen cuando está presente, incluso si
la proyección del caso falló. Un origen explícitamente nulo permanece desconocido.
Para filas históricas sin bloque de origen se conserva el filtro por la proyección
del caso, sin inferir nuevos valores.
Los responsables asignados conservan su ID para filtrar y se presentan con el
nombre del perfil cuando está disponible. Campus y lineamiento pueden provenir
de metadatos explícitos de Flokzu; ese metadato no crea política ni auditorías.

## Activación y verificación

La app requiere `20261013100000_dashboard-execution-evaluation-metrics.sql`.
**No fue aplicada a producción.** Antes de desplegar, seguir
`MIGRATION-RECONCILIATION.md`, validar en el backend aislado y aplicar el archivo
con el runner oficial. Es aditiva: una columna de metadata, un archivo durable,
un trigger y vistas nuevas con acceso reservado a `project_admin`. No modifica
filas de casos, auditorías ni decisiones humanas existentes.

Las pruebas de `dashboard-human-review-query.test.ts` ejecutan las vistas y los
filtros reales en PostgreSQL efímero (PGlite) con datos sintéticos y sin red.
Incluyen archivo de ejecuciones, selección anterior al rango, consumo parcial,
versiones independientes y sincronización Flokzu sin llamadas artificiales.
Esto valida SQL y agregación; no reemplaza la conciliación del esquema remoto ni
un ensayo con el runner oficial en staging.
