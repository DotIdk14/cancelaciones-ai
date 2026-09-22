# Evaluación normativa histórica

`compareHistoricalOutcome` compara una decisión de máquina con un resultado
humano histórico únicamente después de la evaluación. No llama a IA ni trata
la coincidencia como exactitud de política. Si falta el resultado humano,
la versión no coincide, o la evaluación es indeterminada/conflictuada, se
devuelve un estado explícito (`HUMAN_OUTCOME_MISSING`, `NOT_COMPARABLE`,
`AI_INDETERMINATE` o `AI_CONFLICTED`).

Una discrepancia no se promueve automáticamente a golden case; requiere
validación de hechos, versión y fuente por OWNER.
