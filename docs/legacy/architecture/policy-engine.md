# Motor normativo (Phase 6)

`@cancelaciones/policy-engine` es un núcleo síncrono, puro y determinista. Recibe
`facts`, `policyCode` y `policyVersion`; nunca consulta base de datos ni usa IA.
Cada regla declara categoría, cita exacta, condiciones de cuatro estados,
hechos/evidencia usados y datos faltantes. El agregador se ejecuta después de
evaluar todas las reglas, por lo que no oculta conflictos.

La versión queda fijada en cada evaluación. El fingerprint de reglas y hechos
permite reproducir una corrida histórica. Las precedencias operativas del OWNER
son datos externos y no sustituyen la fuente normativa.
