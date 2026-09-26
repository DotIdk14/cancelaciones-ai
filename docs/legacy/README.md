# docs/legacy — contenido histórico, NO normativo

Esta carpeta conserva material del diseño anterior del motor de auditoría.

## Advertencia

El contenido de esta carpeta:

- es **histórico**;
- **NO es normativo**;
- **NO debe utilizarse como fuente** del Rule Engine ni de ningún motor normativo;
- **puede contener errores**;
- **puede contradecir** `GDM_GAM_PRD_MLG_003`.

Se conserva **únicamente por trazabilidad**: para poder auditar por qué se tomó
cada decisión anterior y demostrar qué se descartó.

## La fuente normativa oficial es otra

La única fuente normativa es el procedimiento provisto por el owner:

```
normative/GDM_GAM_PRD_MLG_003  PROCEDIMIENTO DESERCIÓN DE ESTUDIANTES.docx.pdf
```

Nada en `docs/legacy/` sustituye, completa, matiza ni interpreta ese documento.

## Por qué se quarantinó

Durante la auditoría *clean slate* se demostró que el material de esta carpeta
contiene interpretación no normativa con defectos verificables. Ejemplos
documentados en `docs/reports/clean-slate-audit-report.md`:

- `rule-inventory.md` declaraba **15 llamadas** donde la fuente (5.2.a, pág. 3)
  establece **16**.
- `rule-inventory.md` y el motor legacy citaban 5.7.e en pág. 9 y 5.8.a en
  pág. 9, cuando la fuente las ubica en págs. 11 y 12.
- `v5-coverage.md` y el código declaraban cobertura implícita de la sección
  5.1, que en realidad no estaba implementada ni declarada como ausente.

Por eso esta carpeta se separa de `docs/` normativa y de `normative/`.

## Regla para el futuro

**Ningún loader, script, prompt, test o implementación puede consumir
automáticamente esta carpeta.** Si una V2 necesita recuperar algo de aquí,
debe re-derivarse desde `GDM_GAM_PRD_MLG_003` y Holmes el motivo en un ADR.

## Subcarpetas

| Carpeta | Contenido |
|---|---|
| `non-normative-policy-interpretations/` | Interpretaciones nuestras de la política (antes `docs/policy/`). **La más peligrosa: contiene errores verificables.** |
| `architecture/` | Diseños, ADRs, planes y specs del motor retirado. |
| `reports/` | Reportes de fases y auditorías históricas. |
| `prompts/` | Prompts de fases anteriores. |
| `working-notes/` | Notas de trabajo y diffs de revisión. |
