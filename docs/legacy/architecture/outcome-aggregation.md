# Agregación de outcomes

La evaluación tiene dos etapas separadas:

1. Cada regla produce `SATISFIED`, `NOT_SATISFIED`, `UNKNOWN`,
   `NOT_APPLICABLE` o `BLOCKED_BY_MISSING_NORMATIVE_SOURCE`, además de sus
   condiciones y trace.
2. El agregador combina únicamente los efectos de reglas evaluadas y expone
   faltantes y conflictos.

Un resultado compatible puede ser `DETERMINED` o
`DETERMINED_WITH_WARNINGS`; la ausencia de un outcome con información
indispensable produce `INDETERMINATE`. Outcomes incompatibles producen
`CONFLICTED` y `reviewRequired`. El agregador no elige silenciosamente una
regla por orden de ejecución.

Las exclusiones y precedencias deben estar sustentadas por una cita explícita
de la política o por una precedencia operacional de OWNER aprobada,
versionada y separada de la fuente normativa. Phase 6 no crea precedencias
operativas automáticamente.

La agregación separa ahora el `suggestedOutcome` del `decisionStatus`.
Un outcome puede estar sustentado por reglas `SATISFIED` aunque existan
reglas `UNKNOWN`; en ese caso el resultado es `REVIEW_REQUIRED`, nunca se
convierte UNKNOWN en soporte positivo. `READY_TO_APPROVE` sólo se usa cuando
no quedan incertidumbres relevantes, conflictos, fuentes normativas faltantes
ni cobertura de software pendiente. `CONFLICTED` se reserva para outcomes
incompatibles conocidos sin precedencia explícita.

Cada evaluación expone además reglas a favor, en contra, pendientes y
bloqueadas; faltantes de evidencia/facts separados de fuentes normativas y
cobertura de software; y `nextActions` deterministas. La implementación
actual (`packages/policy-engine`) cubre la agregación necesaria para las
reglas V5 implementadas en 5.2 y 5.8. No afirma cobertura total de las
secciones restantes; consultar `docs/policy/v5-coverage.md`.
