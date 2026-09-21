# Inventario de outcomes

Outcomes detectados en la fuente principal. No son enum definitivo hasta formalizacion.

| Outcome | Fuente | Notas |
|---|---|---|
| Cancelacion de venta | 5.1, 5.3, 5.5, 5.6, 5.8, 5.9 | Outcome principal recurrente. |
| Baja definitiva | 5.1.c, 5.3.a.II, 5.7.d | Aplica posterior a inicio o con servicio devengado segun reglas. |
| Cancelacion de venta operativa | 5.9 | Por errores operativos de SER, Finanzas/Cobranza o canalizacion. |
| Baja/cancelacion operativa sin impacto por equipo | 5.8.f | Requiere analisis de gestiones de ambos equipos. |
| Cancelacion de matricula | 5.10 | Mystery Shopper, aplicada por Servicios Escolares. |
| No aplica cancelacion de venta | 5.4.a, 5.4.c, 5.7.d, 5.8 nota | No necesariamente outcome final; puede conducir a baja o retencion. |
| Retencion | 5.3.a.V, 5.3.b, 5.4.b, 5.8.c | Proceso requerido antes de decidir en ciertos escenarios. |
| Cancelacion del ticket | Plantilla/historicos, no fuente normativa como outcome formal | Lenguaje operativo observado en plantilla. Debe validarse antes de motor. |
