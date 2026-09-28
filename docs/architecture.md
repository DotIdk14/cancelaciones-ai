# Arquitectura AI-Native

> [!WARNING]
> Documento histórico pre-consolidación. Describe un esquema de 7 tablas y un
> layout `packages/*` que ya no existen. La arquitectura vigente usa 3 tablas
> (`cases`, `evidence`, `audits`) y código en `api/` + `src/`. Ver `AGENTS.md`,
> `README.md` y `migrations/00000000000000_baseline.sql` como referencias
> actuales.

El sistema usa un monolito modular.

## Flujo

```text
Auditoria
  -> Evidencias
  -> Jobs de preparacion
  -> AuditRun
  -> CaseAnalyst
  -> AuditReviewer
  -> AuditResult
```

## Entidades durables

- `audits`: expediente.
- `evidences`: archivos originales y estado de preparacion.
- `jobs`: operaciones durables con retries acotados.
- `audit_runs`: corrida inmutable al llegar a estado terminal.
- `tool_executions`: auditoria de cada tool.
- `audit_results`: assessment final.
- `ai_call_log`: coste y latencia de llamadas IA.

## Estados terminales

`audit_runs` termina en exactamente uno de:

- `COMPLETED`
- `NEEDS_INPUT`
- `FAILED`

`tool_executions` termina en:

- `SUCCEEDED`
- `FAILED`

## Politica

El procedimiento V5 vive en `policy/`. La IA lo consulta mediante `searchPolicy` y `readPolicySection`. No hay reglas TypeScript derivadas del procedimiento.

## Proveedores

- OpenRouter: gateway de modelos.
- AssemblyAI: audio.

Ambos se usan mediante adapters centralizados en `src/server/openrouter.ts` y `src/server/assemblyai.ts`.
