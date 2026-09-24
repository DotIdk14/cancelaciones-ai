# ADR 013: Fijación de versión normativa en runtime

## Estado

Aceptado para Phase 6.

## Decisión

Toda evaluación recibe explícitamente `policyCode` y `policyVersion`. El
runtime no infiere una versión a partir de la fecha del caso y nunca sustituye
una corrida histórica porque exista una versión más reciente. El default visible
para nuevas auditorías puede ser V5, pero sigue siendo un valor seleccionable y
persistido.

`engine_runs` conserva `policy_code`, `policy_version`, `policy_code_hash`,
`rules_fingerprint`, `facts_fingerprint` y la evaluación serializada. La
unicidad lógica usa la auditoría, facts, hash determinista de `policy_code`, y
fingerprint para evitar duplicar una misma corrida sin indexar el texto completo
en btree. El endpoint valida que la auditoría pertenezca al usuario antes de
leer o crear una corrida.

## Consecuencias

Una comparación histórica con una versión distinta se marca
`NOT_COMPARABLE`/`POLICY_VERSION_MISMATCH`; no se presenta como error del
motor. La selección de versión y la procedencia de reglas quedan disponibles
para reproducibilidad.
