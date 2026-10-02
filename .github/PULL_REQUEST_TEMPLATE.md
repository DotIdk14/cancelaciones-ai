<!--
No borres esta plantilla. Rellena lo que aplique y borra lo que no.
Está en español porque la documentación y la UI del producto lo están.
-->

## Resumen

<!-- Qué cambia este PR y por qué, en 2-4 líneas. Objetivo, no implementación. -->

## Type of change

- [ ] Bug fix
- [ ] Feature
- [ ] Refactor sin cambio de comportamiento
- [ ] Documentación
- [ ] Infraestructura / CI

## Evidencia de validación

<!--
OBLIGATORIO. Pega el resultado REAL de los comandos que ejecutaste.
Prohibido escribir "debería pasar", "se supone que funciona" o "no lo probé
pero es un cambio menor". Si no lo ejecutaste, márcalo como NO EJECUTADO y
explica por qué.
-->

| Comando | Resultado real |
| --- | --- |
| `npm run typecheck` | OK / FALLA (pegar salida) / NO EJECUTADO |
| `npm test` | `N passed` de `M` / salida del fallo / NO EJECUTADO |
| `npm run build` | OK / FALLA (pegada corta) / NO EJECUTADO |

Comando exacto usado y salida relevante (corta, sin volcados completos):

```bash

```

## Impacto de seguridad

<!--
Marca SOLO lo que aplique a los archivos que tocaste en este PR.
Una tarea de CSS no necesita revisar authz: déjalo sin marcar.
-->

- [ ] **Tocó endpoints o autorización** (`api/**`, `src/server/**`): la
      autorización se valida **en el servidor**, no se confía en datos del
      cliente, y ningún role/permission depende del payload del navegador.
- [ ] **Hubo secretos o configuración** (`.env*`, tokens, keys, configs):
      se corrió `gitleaks detect --source . --redact` y no hay hallazgos sin
      justificar. Se reporta archivo y línea, nunca el valor completo.
- [ ] **Cambió un lockfile o `package.json`**: se corrió `osv-scanner` y se
      revisaron las CVEs nuevas; ningún bump automático sin verificar
      breaking changes.
- [ ] **Cambió `.github/workflows/**`**: se corrió `zizmor` y las actions
      quedan pineadas a SHA de commit con comentario `# vX.Y.Z`; `permissions`
      es el mínimo necesario.
- [ ] **Tocó `policy/**`**: se regeneró el procedimiento con
      `npm run policy:generate` y `policy-v5.generated.ts` va en este PR.
- [ ] **Sin PII en Git**: ninguna evidencia real, historial clínico ni dato
      personal entra en el diff (ver `NO_PII_IN_GIT` en AGENTS.md).

## Checklist del autor

- [ ] El diff es mínimo: no hay reformateo ni cambios no pedidos de paso.
- [ ] No toqué archivos fuera del alcance declarado del trabajo.
- [ ] Si la IA o el procedimiento V5 intervienen, cada conclusión importante
      enlaza evidencia y sección del procedimiento (`TRACE_EVERY_DECISION`).
- [ ] No se reintrodujeron capas de arquitectura eliminada (`NO_RULES_ENGINE`:
      sin policy engine, rules engine, fact run ni catálogos de reglas).
- [ ] Docs y strings de UI en español; términos técnicos en inglés solo si no
      tienen traducción directa.

## Notas para el revisor

<!-- Riesgos conocidos, lo que quedó sin verificar, decisiones discutibles. -->
