# Pruebas de outcomes accionables

Las pruebas del motor deben comprobar que:

- una regla de outcome satisfecha conserva `suggestedOutcome` aunque exista una
  regla independiente `UNKNOWN`;
- un faltante relevante produce `REVIEW_REQUIRED`, no soporte ficticio;
- outcomes incompatibles conocidos producen `CONFLICTED` sin voto mayoritario;
- sin una regla de outcome satisfecha el resultado es `INDETERMINATE`;
- `supportingRules`, `opposingRules`, `pendingRules` y `conflictingRules`
  reflejan únicamente el estado real de cada regla.

Los conteos de colecciones se prueban con completitud `COMPLETE`, `PARTIAL` y
`UNKNOWN`; una lista parcial por debajo del umbral es `UNKNOWN`, no `FALSE`.
