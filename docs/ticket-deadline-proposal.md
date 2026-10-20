# Propuesta para calcular el vencimiento de tickets Flokzu

## Regla disponible

El procedimiento `GDM_GAM_PRD_MLG_003`, versión 5, sección 5.1, páginas 2–3, establece 72 horas desde la notificación formal de cancelación por Mejora Continua. La misma sección reparte 48 horas para la réplica y 24 para la determinación final, y menciona una jornada de lunes a viernes. La sección no especifica las horas de inicio y fin de esa jornada.

## Datos que faltan

La importación actual de Flokzu contiene `Fecha de solicitud (CAVE)` (`requestDate`) y `Fecha Inicio` (`administrativeStartDate`). Ninguna identifica la notificación formal que inicia las 72 horas. `cases.created_at` es la fecha local de alta del expediente. No deben sustituir esa marca de tiempo.

Flokzu debe exponer una fecha-hora explícita de notificación formal, con zona horaria. Hasta entonces, el estado de vencimiento debe ser “No calculable”; no se debe inferir desde esas otras fechas.

## Configuración central propuesta

Cuando exista el dato fuente, centralizar en un único servicio de servidor:

- La duración de 72 horas y la interpretación aprobada de “jornada de lunes a viernes”.
- Los umbrales de aviso “próximo a vencer” y “vence hoy”, configurables y compartidos por lista, expediente y dashboard.
- Las condiciones de cierre válido confirmadas por la integración de Flokzu.
- Una función pura que reciba la hora de notificación, la hora actual y el estado de cierre y devuelva `IN_TIME`, `DUE_SOON`, `DUE_TODAY`, `OVERDUE`, `RESOLVED` o `UNKNOWN` junto con días transcurridos y restantes.

Antes de activar cálculos hay que resolver con el dueño del proceso si las 72 horas son horas corridas distribuidas en días hábiles, horas laborables con horario diario, o una medida distinta. La sección 5.1 por sí sola no resuelve ese detalle ni fija el umbral de “próximo a vencer”.

La auditoría y el cierre operativo de Flokzu siguen siendo estados separados. Finalizar una revisión no cuenta como cierre del ticket.
