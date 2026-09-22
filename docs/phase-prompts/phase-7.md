# Phase 7 — Dictamen oficial y revisión humana

## Precondiciones de entrada

No iniciar Phase 7 sin cerrar todas las condiciones de Phase 6:

- Fact Run real congelado y generado desde evidencia original.
- Engine Run nuevo con `policyCode` y `policyVersion` explícitos.
- Cobertura V5 revisada y sin gaps de regla implementada, incluida `5.7.e`.
- Reportes de fases faltantes restaurados o reconstruidos con marca de evidencia.
- `suggestedOutcome` separado de `decisionStatus` y sin silenciar `UNKNOWN`.

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
- plantilla canónica registrada y su hash;
- `audit_manual_comments` con
  `back_office_comment`, `helpdesk_comment`, `school_services_comment`,
  `finance_comment`, `additional_comment` como inputs operativos manuales.

Mapeo operativo requerido:

- `back_office_comment` → Comentarios BO
- `helpdesk_comment` → Comentarios HelpDesk
- `school_services_comment` → Comentarios SER
- `finance_comment` → Comentarios Finanzas
- `additional_comment` → sin asignación automática aún; Phase 7 decide si va a
  `NOTAS Y EVIDENCIAS PROPIAS`, `OBSERVACIONES FINALES` o se excluye.

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
