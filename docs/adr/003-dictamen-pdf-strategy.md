# ADR 003 - Estrategia de Dictamen.pdf

## Estado

Aceptada provisional.

## Decision

Evaluar en Phase 1/2 una estrategia hibrida: reconstruccion HTML/CSS controlada para fidelidad visual y pruebas, usando `Dictamen.pdf` como referencia canonica, no como fuente normativa. Mantener abierta la opcion de overlays sobre PDF original si las pruebas visuales muestran mayor fidelidad con menor complejidad.

## Motivo

Los historicos extienden la plantilla con evidencias e imagenes. El reporte final necesita bloques dinamicos y visual regression tests.

## Consecuencias

- No disenar reporte alternativo.
- Crear pruebas de texto y visuales contra la plantilla.
- Documentar cualquier diferencia visual aceptada.
