# Conflictos observados

## Normativos potenciales

- 5.3.a.II sugiere baja si solicitud posterior al inicio y retencion no efectiva; 5.8 puede sugerir CV por ilocalizable dentro de ventana si no hay contacto efectivo y no hay actividad valida.
- 5.7.d bloquea CV si existen calificaciones; 5.8 permite CV si no hay ingreso/modalidad segun nivel. Debe aplicarse como precedencia explicita por `por ningun motivo` en 5.7.d.
- 5.6.g permite casos excepcionales fuera de plazo por promesa no cumplida, pero requiere evaluacion conjunta y no define resultado automatico.

## Historicos disponibles

- CaVe-30344: BO indica que no se considera ilocalizable por no cumplir intentos minimos en horarios diferentes; dictamen final aplica CV por ilocalizable.
- CaVe-30354: BO indica ingreso a AV y modalidad seleccionada, ademas contacto con GM; dictamen final aplica CV por ilocalizable.
- CaVe-30318: evidencia menciona ingreso breve y seleccion/modalidad; dictamen final aplica CV por ilocalizable con argumento de no activacion efectiva.

Estos conflictos no autorizan reglas nuevas; deben mostrarse al humano y resolverse por politica explicita u OWNER_OPERATIONAL_PRECEDENCE versionada.

## Estado Phase 6

El motor expone conflictos como `CONFLICTED` y exige revisión; no aplica una
prioridad numérica implícita. Las reglas actualmente implementadas no cubren
todos los conflictos listados arriba. En particular, la precedencia de 5.7.d y
las ramas 5.3/5.6 permanecen pendientes de formalización con cita V5 exacta.
Las referencias históricas son señales de revisión y no resuelven el conflicto.
