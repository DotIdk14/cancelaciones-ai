# ADR 002 - IA vs motor normativo

## Estado

Aceptada.

## Decision

La IA extrae y estructura hechos. El motor normativo aplica politica oficial de forma pura y determinista.

## Motivo

La politica es inmutable y debe ser trazable. Un LLM no puede inventar excepciones, prioridades ni resultados.

## Consecuencias

- Structured output y validacion son obligatorios para extraccion con LLM.
- El motor opera sobre facts normalizados, no sobre prompts.
- Toda regla debe enlazar fuente normativa exacta.
