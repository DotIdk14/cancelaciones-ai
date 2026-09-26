# Decisión de máquina accionable

La decisión de máquina tiene dos dimensiones independientes:

- `suggestedOutcome`: outcome sustentado exclusivamente por reglas conocidas y satisfechas.
- `decisionStatus`: `READY_TO_APPROVE`, `REVIEW_REQUIRED`, `CONFLICTED` o `INDETERMINATE`.

Una regla `UNKNOWN` nunca aporta soporte positivo. Sí puede exigir revisión,
generar un faltante o indicar que el resultado podría cambiar. Un resultado
sugerido con incertidumbre es válido: permite orientar la revisión humana sin
presentarlo como aprobación automática.

La evaluación conserva trazabilidad hacia reglas, facts, artifacts y
evidencia. Las fuentes normativas ausentes y las reglas aún no implementadas
se muestran separadas de los faltantes de evidencia.
