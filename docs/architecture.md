# Arquitectura vigente — Cancelaciones AI

El producto es una SPA React + Vite + TypeScript con backend en Vercel Functions
(`api/**`) y helpers server-side en `src/server/**`. InsForge provee Auth,
PostgreSQL y Storage; OpenRouter es el único proveedor de IA; AssemblyAI se usa
únicamente para transcripción de audio.

## Flujo productivo

```text
evidencias originales
  -> preparación técnica (hash, MIME, PDF/texto/imagen, transcripción audio)
  -> Audit Skill con Procedimiento V5 owner-supplied inyectado íntegro
  -> assessment estructurado validado por Zod y referencias de evidencia
  -> metadata técnica real de OpenRouter agregada por servidor
  -> audits.result_json terminal
```

No existe `CaseAnalyst` con tools en runtime, ni `AuditReviewer` separado, ni
policy/rules/facts engine. La trazabilidad se exige por schema y validación
semántica: los IDs citados por hechos, cronología, conflictos y conclusión deben
pertenecer al expediente auditado.

## Entidades durables

- `cases`: expediente y estado técnico (`DRAFT`, `READY`, `AUDITING`,
  `COMPLETED`, `ERROR`).
- `evidence`: metadatos de archivos, SHA-256, key privada de Storage y
  transcripción cuando aplique.
- `audits`: intentos de auditoría. Guarda `evidence_fingerprint`, estado técnico,
  modelo real, metadata de proveedor y `result_json` validado.

## Reauditoría e idempotencia

Cada auditoría se asocia a un fingerprint determinista del conjunto canónico de
evidencias. Un `COMPLETED` sólo se reutiliza si el fingerprint coincide. Si el
usuario agrega o borra evidencia, el caso vuelve a `READY`/`DRAFT` según
corresponda y puede auditarse de nuevo. La base impide dos `RUNNING` simultáneos
para el mismo `(case_id, evidence_fingerprint)`.

## Política

El procedimiento V5 vive en `policy/` y se serializa a
`src/skills/audit/policy-v5.generated.ts` con `npm run policy:generate`. No se
busca política en internet y no se convierte el procedimiento a SQL ni reglas
deterministas.
