# Phase 7 — Dictamen oficial y revisión humana

## Objetivo

Tomar un Fact Run congelado, una decisión de máquina inmutable, su trace y las
referencias de evidencia para producir el Dictamen oficial usando la plantilla
canónica `templates/Dictamen.pdf`. Phase 7 agrega revisión humana sin
sobrescribir la decisión de máquina.

## Entradas obligatorias

- auditoría autorizada;
- Fact Run congelado y sus fingerprints;
- `engine_run` con `policyCode`, `policyVersion`, `rulesFingerprint` y
  `factsFingerprint`;
- reglas evaluadas, faltantes, conflictos y trace;
- referencias a artifacts/evidencias originales, páginas, timestamps o celdas;
- plantilla canónica registrada y su hash.

Una auditoría sin versión normativa, facts congelados, trace completo o
provenance verificable no puede generar un dictamen final.

## Requisitos funcionales

1. Seleccionar y mostrar el resultado sugerido, estado, reglas determinantes,
   datos faltantes, conflictos y fundamento exacto.
2. Permitir revisión humana explícita, con usuario, fecha, motivo y outcome
   separado de `machineOutcome`.
3. Preservar siempre la decisión de máquina, sus fingerprints y el resultado de
   la corrida original.
4. Seleccionar sólo evidencia determinante y mantener enlaces a originales
   inmutables y sus SHA-256.
5. Generar un draft y, después de aprobación, el PDF final con la plantilla
   canónica; no sustituirla por HTML o un reporte alternativo.
6. Registrar versiones, hashes, actor y eventos de generación para reproducir
   el documento.

## Reglas de seguridad y política

La IA puede ayudar a transcribir o estructurar evidencia, pero no decide el
outcome. Históricos sirven para comparación y revisión, no como fuente
normativa. `UNKNOWN`, conflictos y fuentes faltantes deben mostrarse y nunca
silenciarse durante la aprobación.

## Fuera de alcance

No ampliar la cobertura normativa sin fuente OWNER. No inferir versiones por
fecha del caso. No modificar originales, facts congelados ni decisiones de
máquina. No introducir precedencias operativas sin aprobación versionada.

## Criterios de aceptación

- PDF visualmente fiel a `Dictamen.pdf`.
- Cada afirmación normativa enlaza regla, condición, hecho y evidencia.
- La revisión humana queda separada y auditable.
- Draft/final y sus hashes son recuperables.
- Tests de plantilla, provenance, autorización, idempotencia y no
  sobrescritura pasan.
